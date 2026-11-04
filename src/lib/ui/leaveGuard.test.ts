import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAutosaveController } from './autosave';
import {
  UNSAVED_LEAVE_MESSAGE,
  createDraftLeaveGuard,
  type LeaveAttempt,
  type LeaveNavigation,
} from './leaveGuard';

const FROM = 'http://app.test/mileage-reports';

/** A real autosave controller over an in-memory "database" whose writes can fail or wait. */
function draft() {
  const db = {
    value: 'saved',
    savedJson: 'saved',
    failing: false,
    saves: [] as string[],
    gate: null as Promise<void> | null,
  };
  const autosave = createAutosaveController({
    read: () => db.value,
    serialize: (value) => value,
    isSaved: (json) => json === db.savedJson,
    markSaved: (json) => { db.savedJson = json; },
    save: async (value) => {
      db.saves.push(value);
      if (db.gate) await db.gate;
      if (db.failing) throw new Error('QA injected SQLite write failure');
    },
    setState: () => {},
    delayMs: 1500,
    retryDelayMs: 5,
  });
  return { db, autosave };
}

function fakeNavigation() {
  const calls: string[] = [];
  let popStateWaiters: Array<() => void> = [];
  const router = { navigating: false };
  const navigation: LeaveNavigation = {
    goto: async (url, { replaceState }) => {
      calls.push(`goto ${url.pathname}${replaceState ? ' (replace)' : ''}`);
    },
    go: (delta) => { calls.push(`go ${delta}`); },
    assign: (href) => { calls.push(`assign ${href}`); },
    currentHref: () => FROM,
    nextPopState: () => new Promise<void>((resolve) => { popStateWaiters.push(resolve); }),
    isNavigating: () => router.navigating,
  };
  return {
    navigation,
    calls,
    router,
    popState() {
      const waiters = popStateWaiters;
      popStateWaiters = [];
      waiters.forEach((resolve) => resolve());
    },
  };
}

/** A navigation's `complete` promise that the test settles itself. */
function completion() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function attempt(
  type: LeaveAttempt['type'],
  to: string | null,
  extra: Partial<LeaveAttempt> = {},
): LeaveAttempt & { cancel: ReturnType<typeof vi.fn> } {
  return {
    type,
    willUnload: type === 'leave',
    from: { url: new URL(FROM) },
    to: to === null ? null : { url: new URL(to, FROM) },
    complete: new Promise<void>(() => {}),
    cancel: vi.fn(),
    ...extra,
  } as LeaveAttempt & { cancel: ReturnType<typeof vi.fn> };
}

function settle(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup({ editing = true, unsavable = '' } = {}) {
  const { db, autosave } = draft();
  const nav = fakeNavigation();
  const messages: string[] = [];
  const leaving: boolean[] = [];
  const state = { editing, unsavable };
  const guard = createDraftLeaveGuard({
    autosave: () => autosave,
    isEditing: () => state.editing,
    unsavableReason: () => state.unsavable,
    onBlocked: (message) => { messages.push(message); },
    onLeaving: (value) => { leaving.push(value); },
    navigation: nav.navigation,
  });
  return { db, autosave, nav, messages, leaving, state, guard };
}

describe('createDraftLeaveGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('lets navigation through when the visible draft is already saved', async () => {
    const { db, nav, guard, autosave } = setup();
    const link = attempt('link', '/');

    guard.beforeNavigate(link);
    await settle();

    expect(link.cancel).not.toHaveBeenCalled();
    expect(db.saves).toEqual([]);
    expect(nav.calls).toEqual([]);
    autosave.dispose();
  });

  test('lets navigation through when no editable draft is open', async () => {
    const { db, guard, state, autosave } = setup({ editing: false });
    db.value = 'edited';
    const link = attempt('link', '/');

    guard.beforeNavigate(link);
    await settle();

    expect(state.editing).toBe(false);
    expect(link.cancel).not.toHaveBeenCalled();
    expect(db.saves).toEqual([]);
    autosave.dispose();
  });

  test('holds a link away from unsaved edits, saves them, then replays it exactly once', async () => {
    const { db, nav, guard, messages, autosave } = setup();
    db.value = 'QA UNSAVED MUST SURVIVE';
    const link = attempt('link', '/');

    guard.beforeNavigate(link);
    expect(link.cancel).toHaveBeenCalledOnce();
    expect(nav.calls).toEqual([]);
    await settle();

    expect(db.saves).toEqual(['QA UNSAVED MUST SURVIVE']);
    expect(db.savedJson).toBe('QA UNSAVED MUST SURVIVE');
    expect(nav.calls).toEqual(['goto /']);
    expect(messages.at(-1)).toBe('');

    // The replayed navigation passes straight through now that the draft is stored.
    const replay = attempt('goto', '/');
    guard.beforeNavigate(replay);
    expect(replay.cancel).not.toHaveBeenCalled();
    autosave.dispose();
  });

  test('keeps the editor and its edits when the save fails, with retries still running', async () => {
    const { db, nav, guard, messages, autosave } = setup();
    db.failing = true;
    db.value = 'QA UNSAVED MUST SURVIVE';
    const link = attempt('link', '/');

    guard.beforeNavigate(link);
    await settle();

    expect(link.cancel).toHaveBeenCalledOnce();
    expect(nav.calls).toEqual([]);
    expect(messages.at(-1)).toBe(UNSAVED_LEAVE_MESSAGE);
    expect(db.value).toBe('QA UNSAVED MUST SURVIVE');
    expect(autosave.hasUnsavedChanges()).toBe(true);

    // The background retry recovers once the database accepts writes again...
    db.failing = false;
    await settle(30);
    expect(db.savedJson).toBe('QA UNSAVED MUST SURVIVE');

    // ...after which the user can leave normally.
    const again = attempt('link', '/');
    guard.beforeNavigate(again);
    expect(again.cancel).not.toHaveBeenCalled();
    autosave.dispose();
  });

  test('saves first and then leaves when the user retries the link after a failure', async () => {
    const { db, nav, guard, messages, autosave } = setup();
    db.failing = true;
    db.value = 'edited';
    guard.beforeNavigate(attempt('link', '/'));
    await settle();
    expect(messages.at(-1)).toBe(UNSAVED_LEAVE_MESSAGE);

    db.failing = false;
    const retry = attempt('link', '/');
    guard.beforeNavigate(retry);
    expect(retry.cancel).toHaveBeenCalledOnce();
    await settle();

    expect(db.savedJson).toBe('edited');
    expect(nav.calls).toEqual(['goto /']);
    expect(messages.at(-1)).toBe('');
    autosave.dispose();
  });

  test('collapses repeated clicks during a save into one replay of the latest target', async () => {
    const { db, nav, guard, autosave } = setup();
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    db.value = 'edited';
    const clicks = [attempt('link', '/history'), attempt('link', '/history'), attempt('link', '/')];

    clicks.forEach((click) => guard.beforeNavigate(click));
    await settle();
    expect(clicks.every((click) => click.cancel.mock.calls.length === 1)).toBe(true);
    expect(nav.calls).toEqual([]);

    db.gate = null;
    release();
    await settle();

    expect(db.saves).toEqual(['edited']);
    expect(nav.calls).toEqual(['goto /']);
    autosave.dispose();
  });

  test('saves edits typed while the held save is running before it leaves', async () => {
    const { db, nav, guard, autosave } = setup();
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    db.value = 'first edit';

    guard.beforeNavigate(attempt('link', '/'));
    await settle();
    db.value = 'typed during the save';
    autosave.notifyChanged();
    db.gate = null;
    release();
    await settle();

    expect(db.saves).toEqual(['first edit', 'typed during the save']);
    expect(db.savedJson).toBe('typed during the save');
    expect(nav.calls).toEqual(['goto /']);
    autosave.dispose();
  });

  test('stays put with the reason when the draft cannot be saved yet', async () => {
    const { db, nav, guard, messages, state, autosave } = setup({ unsavable: 'Fix the invoice number first.' });
    db.value = 'edited';
    const link = attempt('link', '/history');

    guard.beforeNavigate(link);
    await settle();

    expect(link.cancel).toHaveBeenCalledOnce();
    expect(db.saves).toEqual([]);
    expect(nav.calls).toEqual([]);
    expect(messages.at(-1)).toBe('Fix the invoice number first.');

    state.unsavable = '';
    guard.beforeNavigate(attempt('link', '/history'));
    await settle();
    expect(nav.calls).toEqual(['goto /history']);
    autosave.dispose();
  });

  test('waits for the router to undo a held back/forward step before replaying it', async () => {
    const { db, nav, guard, autosave } = setup();
    db.value = 'edited';
    const back = attempt('popstate', '/', { delta: -1 });

    guard.beforeNavigate(back);
    expect(back.cancel).toHaveBeenCalledOnce();
    await settle();
    expect(db.savedJson).toBe('edited');
    expect(nav.calls).toEqual([]);

    nav.popState();
    await settle();

    expect(nav.calls).toEqual(['go -1']);
    autosave.dispose();
  });

  test('does not replay a back/forward step whose save failed', async () => {
    const { db, nav, guard, messages, autosave } = setup();
    db.failing = true;
    db.value = 'edited';

    guard.beforeNavigate(attempt('popstate', '/', { delta: -2 }));
    nav.popState();
    await settle();

    expect(nav.calls).toEqual([]);
    expect(messages.at(-1)).toBe(UNSAVED_LEAVE_MESSAGE);
    autosave.dispose();
  });

  test('lets a pending back/forward rollback land before replaying a newer link', async () => {
    const { db, nav, guard, autosave } = setup();
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    db.value = 'edited';

    guard.beforeNavigate(attempt('popstate', '/', { delta: -1 }));
    guard.beforeNavigate(attempt('link', '/expenses'));
    db.gate = null;
    release();
    await settle();
    expect(nav.calls).toEqual([]);

    nav.popState();
    await settle();
    expect(nav.calls).toEqual(['goto /expenses']);
    autosave.dispose();
  });

  test('drops a held back/forward replay when the user navigates again before it lands', async () => {
    const { db, nav, guard, autosave } = setup();
    db.value = 'edited';

    guard.beforeNavigate(attempt('popstate', '/', { delta: -1 }));
    await settle();
    expect(db.savedJson).toBe('edited');

    // The draft is saved now, so this click goes straight through on its own.
    const click = attempt('link', '/expenses');
    guard.beforeNavigate(click);
    expect(click.cancel).not.toHaveBeenCalled();
    nav.popState();
    await settle();

    expect(nav.calls).toEqual([]);
    autosave.dispose();
  });

  test('asks the browser to confirm a full unload and saves meanwhile', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { db, nav, guard, autosave } = setup();
      db.failing = true;
      db.value = 'edited';
      const unload = attempt('leave', null);

      guard.beforeNavigate(unload);
      await settle();

      expect(unload.cancel).toHaveBeenCalledOnce();
      expect(db.saves).toEqual(['edited']);
      expect(nav.calls).toEqual([]);
      autosave.dispose();
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('does not prompt on a full unload when everything is saved', () => {
    const { guard, autosave } = setup();
    const unload = attempt('leave', null);

    guard.beforeNavigate(unload);

    expect(unload.cancel).not.toHaveBeenCalled();
    autosave.dispose();
  });

  test('replays an external link as a full navigation once saved', async () => {
    const { db, nav, guard, autosave } = setup();
    db.value = 'edited';

    guard.beforeNavigate(attempt('link', 'https://example.com/help', { willUnload: true }));
    await settle();

    expect(nav.calls).toEqual(['assign https://example.com/help']);
    autosave.dispose();
  });

  test('ignores navigation that keeps the same page mounted', () => {
    const { db, guard, autosave } = setup();
    db.value = 'edited';
    const samePage = attempt('link', '/mileage-reports');

    guard.beforeNavigate(samePage);

    expect(samePage.cancel).not.toHaveBeenCalled();
    autosave.dispose();
  });

  test('never replays after the editor is destroyed', async () => {
    const { db, nav, guard, autosave } = setup();
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    db.value = 'edited';

    guard.beforeNavigate(attempt('link', '/'));
    await settle();
    guard.dispose();
    db.gate = null;
    release();
    await settle();

    expect(nav.calls).toEqual([]);
    autosave.dispose();
  });

  test('saves late edits before unmounting and never rejects into the router', async () => {
    const { db, guard, autosave } = setup();
    db.value = 'typed after leaving was allowed';
    await expect(guard.flushBeforeUnmount()).resolves.toBeUndefined();
    expect(db.savedJson).toBe('typed after leaving was allowed');

    db.failing = true;
    db.value = 'another late edit';
    await expect(guard.flushBeforeUnmount()).resolves.toBeUndefined();
    autosave.dispose();
  });

  test('does not touch the database before unmount when nothing changed', async () => {
    const { db, guard, autosave } = setup();

    await guard.flushBeforeUnmount();

    expect(db.saves).toEqual([]);
    autosave.dispose();
  });
});

describe('locking the editor while an allowed navigation loads', () => {
  test('locks a saved editor in the same call that lets it leave, before the next page loads', () => {
    const { guard, leaving, autosave } = setup();
    const link = attempt('link', '/mileage-history');

    guard.beforeNavigate(link);

    expect(link.cancel).not.toHaveBeenCalled();
    expect(leaving).toEqual([true]);
    autosave.dispose();
  });

  test('keeps a held editor editable while it saves, then locks it for the replayed navigation', async () => {
    const { db, nav, guard, leaving, autosave } = setup();
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => { release = resolve; });
    db.value = 'edited';

    guard.beforeNavigate(attempt('link', '/clients'));
    await settle();
    expect(leaving).toEqual([]);

    db.gate = null;
    release();
    await settle();
    expect(nav.calls).toEqual(['goto /clients']);
    expect(leaving).toEqual([]);

    // The replay is a new navigation of a saved draft, so it locks like any other.
    guard.beforeNavigate(attempt('goto', '/clients'));
    expect(leaving).toEqual([true]);
    autosave.dispose();
  });

  test('never locks an editor whose save failed, so its edits and retry stay usable', async () => {
    const { db, guard, leaving, messages, autosave } = setup();
    db.failing = true;
    db.value = 'edited';

    guard.beforeNavigate(attempt('link', '/'));
    await settle();

    expect(messages.at(-1)).toBe(UNSAVED_LEAVE_MESSAGE);
    expect(leaving).toEqual([]);
    autosave.dispose();
  });

  test('locks on back/forward as well', () => {
    const { guard, leaving, autosave } = setup();

    guard.beforeNavigate(attempt('popstate', '/', { delta: -1 }));

    expect(leaving).toEqual([true]);
    autosave.dispose();
  });

  test('unlocks when the navigation is dropped and the router is idle', async () => {
    const { guard, leaving, autosave } = setup();
    const done = completion();

    guard.beforeNavigate(attempt('link', '/', { complete: done.promise }));
    done.reject(new Error('navigation cancelled'));
    await settle();

    expect(leaving).toEqual([true, false]);
    autosave.dispose();
  });

  test('stays locked while a newer navigation that skipped beforeNavigate loads', async () => {
    const { nav, guard, leaving, autosave } = setup();
    const done = completion();

    guard.beforeNavigate(attempt('link', '/mileage-history', { complete: done.promise }));
    // SvelteKit took a newer link mid-load without asking the guard, which drops this one.
    nav.router.navigating = true;
    done.reject(new Error('navigation aborted'));
    await settle();
    expect(leaving).toEqual([true]);

    // That newer navigation ended on this same editor.
    nav.router.navigating = false;
    guard.afterNavigate();
    expect(leaving).toEqual([true, false]);
    autosave.dispose();
  });

  test('unlocks when the router finishes with this editor still mounted', () => {
    const { guard, leaving, autosave } = setup();

    guard.beforeNavigate(attempt('link', '/clients'));
    guard.afterNavigate();

    expect(leaving).toEqual([true, false]);
    autosave.dispose();
  });

  test('an older navigation settling late never unlocks a newer lock', async () => {
    const { guard, leaving, autosave } = setup();
    const older = completion();

    guard.beforeNavigate(attempt('link', '/clients', { complete: older.promise }));
    guard.afterNavigate();
    guard.beforeNavigate(attempt('link', '/mileage-history'));
    older.reject(new Error('navigation aborted'));
    await settle();

    expect(leaving).toEqual([true, false, true]);
    autosave.dispose();
  });

  test('does not lock for same-page links, full unloads, or when nothing is editable', () => {
    const editing = setup();
    editing.guard.beforeNavigate(attempt('link', '/mileage-reports'));
    editing.guard.beforeNavigate(attempt('leave', null));
    editing.guard.beforeNavigate(attempt('link', 'https://example.com/help', { willUnload: true }));
    expect(editing.leaving).toEqual([]);
    editing.autosave.dispose();

    const idle = setup({ editing: false });
    idle.guard.beforeNavigate(attempt('link', '/'));
    expect(idle.leaving).toEqual([]);
    idle.autosave.dispose();
  });

  test('stops reporting once the editor is destroyed', async () => {
    const { guard, leaving, autosave } = setup();
    const done = completion();

    guard.beforeNavigate(attempt('link', '/', { complete: done.promise }));
    guard.dispose();
    done.reject(new Error('navigation cancelled'));
    await settle();
    guard.afterNavigate();

    expect(leaving).toEqual([true]);
    autosave.dispose();
  });
});
