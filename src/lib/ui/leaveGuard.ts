import type { AutosaveController } from './autosave';

export const UNSAVED_LEAVE_MESSAGE =
  "Your latest changes couldn't be saved, so you're still on this page. They're still here, and saving keeps retrying. Try again once it says Saved.";

/** The parts of SvelteKit's `BeforeNavigate` the guard reads. */
export interface LeaveAttempt {
  type: 'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate';
  willUnload: boolean;
  from: { url: URL } | null;
  to: { url: URL } | null;
  delta?: number;
  /** Settles when the router finishes this navigation; rejects if it's cancelled or overtaken. */
  complete: Promise<void>;
  cancel(): void;
}

/** Browser navigation the guard uses to replay a navigation it held back. */
export interface LeaveNavigation {
  goto(url: URL, options: { replaceState: boolean }): Promise<unknown>;
  go(delta: number): void;
  assign(href: string): void;
  currentHref(): string;
  /** Resolves on the next popstate (or after a short safety timeout). */
  nextPopState(): Promise<void>;
  /** True while the router is loading a navigation. */
  isNavigating(): boolean;
}

export interface DraftLeaveGuardOptions {
  autosave: () => AutosaveController | null;
  /** True while an editable draft is open; nothing needs protecting otherwise. */
  isEditing: () => boolean;
  /** Why the visible draft can't be saved yet (shown to the user), or ''. */
  unsavableReason?: () => string;
  /** Shows why leaving was held back; '' clears it. */
  onBlocked: (message: string) => void;
  /** Locks every draft control (true) while the next page loads, or unlocks them (false). */
  onLeaving: (leaving: boolean) => void;
  navigation: LeaveNavigation;
}

export interface DraftLeaveGuard {
  beforeNavigate(navigation: LeaveAttempt): void;
  /** For `afterNavigate`: the router finished and this editor is still on screen. */
  afterNavigate(): void;
  /** For `onNavigate`: saves anything that changed without the user after leaving was allowed. Never rejects. */
  flushBeforeUnmount(): Promise<void>;
  dispose(): void;
}

interface HeldNavigation {
  url: URL;
  willUnload: boolean;
  delta?: number;
}

// Each pass saves everything typed so far; more passes only happen if the user keeps typing.
const MAX_SAVE_PASSES = 3;

/**
 * Keeps an editor on screen until its visible draft is saved. A navigation away from
 * unsaved edits is cancelled, the draft is flushed, and only a successful save replays
 * the navigation; a failed save leaves the editor (and its retry) in place. Once a saved
 * editor is allowed to leave, it's locked until the router replaces it, so nothing typed
 * while the next page loads can be lost with it.
 */
export function createDraftLeaveGuard({
  autosave,
  isEditing,
  unsavableReason = () => '',
  onBlocked,
  onLeaving,
  navigation,
}: DraftLeaveGuardOptions): DraftLeaveGuard {
  let held: HeldNavigation | null = null;
  let saving = false;
  let disposed = false;
  // Counts navigation attempts so a replay never lands on top of a newer one.
  let attempts = 0;
  // SvelteKit undoes a cancelled back/forward step with history.go(-delta); nothing is
  // replayed until that lands, or the router would treat the replay as stale.
  let rollback: Promise<void> | null = null;
  let leaving = false;
  // Counts locks so an older navigation settling late can't unlock a newer one.
  let locks = 0;

  function hasUnsavedDraft(): boolean {
    return !disposed && isEditing() && (autosave()?.hasUnsavedChanges() ?? false);
  }

  function setLeaving(next: boolean) {
    if (disposed || leaving === next) return;
    leaving = next;
    onLeaving(next);
  }

  /** Locks the editor until the router replaces it or settles with it still mounted. */
  function lockWhileLeaving(complete: Promise<void>) {
    const lock = ++locks;
    setLeaving(true);
    complete.catch(() => {
      // Dropped. While the router is busy, a newer navigation it never asked the guard
      // about has taken over; that one unmounts this editor or ends in afterNavigate.
      if (lock === locks && !navigation.isNavigating()) setLeaving(false);
    });
  }

  /** '' once the visible draft is stored, otherwise why it isn't. */
  async function saveVisibleDraft(): Promise<string> {
    for (let pass = 0; pass < MAX_SAVE_PASSES; pass += 1) {
      if (!hasUnsavedDraft()) return '';
      const reason = unsavableReason();
      if (reason) return reason;
      try {
        await autosave()?.flush();
      } catch {
        return UNSAVED_LEAVE_MESSAGE;
      }
    }
    return hasUnsavedDraft() ? UNSAVED_LEAVE_MESSAGE : '';
  }

  async function replay(target: HeldNavigation) {
    const ticket = attempts;
    const pendingRollback = rollback;
    if (pendingRollback) await pendingRollback;
    if (rollback === pendingRollback) rollback = null;
    // The user navigated again meanwhile; that attempt is held or went through on its own.
    if (disposed || attempts !== ticket) return;
    if (target.delta !== undefined) navigation.go(target.delta);
    else if (target.willUnload) navigation.assign(target.url.href);
    else await navigation.goto(target.url, { replaceState: target.url.href === navigation.currentHref() });
  }

  async function saveThenLeave() {
    if (saving) return; // The running save replays the latest held navigation.
    saving = true;
    let problem: string;
    try {
      problem = await saveVisibleDraft();
    } finally {
      saving = false;
    }
    if (disposed) return;
    const target = held;
    held = null;
    onBlocked(problem);
    if (problem || !target) return;
    // The replay goes back through beforeNavigate, which lets it pass now that it's saved.
    await replay(target).catch(() => {});
  }

  return {
    beforeNavigate(attempt) {
      if (disposed || attempt.type === 'enter') return;
      attempts += 1;
      const to = attempt.to;
      // Same page: the editor stays mounted and keeps autosaving.
      if (to && !attempt.willUnload && to.url.pathname === attempt.from?.url.pathname) return;
      if (!hasUnsavedDraft()) {
        // The router loads the next page before unmounting this one.
        if (to && !attempt.willUnload && isEditing()) lockWhileLeaving(attempt.complete);
        return;
      }

      attempt.cancel();
      if (attempt.type === 'leave' || !to) {
        // Reload/close/typed URL: cancel() makes the browser ask; save meanwhile in case they stay.
        if (!unsavableReason()) void autosave()?.flush().catch(() => {});
        return;
      }
      if (attempt.type === 'popstate') rollback = navigation.nextPopState();
      held = {
        url: to.url,
        willUnload: attempt.willUnload,
        delta: attempt.type === 'popstate' ? attempt.delta : undefined,
      };
      void saveThenLeave();
    },

    afterNavigate() {
      // The router is done and this editor survived (same route, or a newer link back here).
      locks += 1;
      setLeaving(false);
    },

    async flushBeforeUnmount() {
      if (!hasUnsavedDraft() || unsavableReason()) return;
      try {
        await autosave()?.flush();
      } catch {
        // Rejecting here would wedge SvelteKit's router; beforeNavigate already held
        // every navigation that had unsaved edits when it started, and locked the editor.
      }
    },

    dispose() {
      disposed = true;
      held = null;
    },
  };
}
