import { onDestroy } from 'svelte';
import { afterNavigate, beforeNavigate, goto, onNavigate } from '$app/navigation';
import { navigating } from '$app/state';
import { createDraftLeaveGuard, type DraftLeaveGuardOptions, type LeaveNavigation } from './leaveGuard';

// How long to wait for SvelteKit's undo of a cancelled back/forward step before replaying.
const ROLLBACK_WAIT_MS = 1000;

const browserNavigation: LeaveNavigation = {
  goto: (url, { replaceState }) => goto(url, { replaceState }),
  go: (delta) => history.go(delta),
  assign: (href) => location.assign(href),
  currentHref: () => location.href,
  nextPopState: () => new Promise<void>((resolve) => {
    const done = () => {
      removeEventListener('popstate', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ROLLBACK_WAIT_MS);
    addEventListener('popstate', done);
  }),
  isNavigating: () => navigating.type !== null,
};

/**
 * Call during component setup: the editor only unmounts once its visible draft is saved.
 * See `createDraftLeaveGuard` for the policy.
 */
export function guardDraftNavigation(options: Omit<DraftLeaveGuardOptions, 'navigation'>): void {
  const guard = createDraftLeaveGuard({ ...options, navigation: browserNavigation });
  beforeNavigate((navigation) => guard.beforeNavigate(navigation));
  onNavigate(() => guard.flushBeforeUnmount());
  afterNavigate(() => guard.afterNavigate());
  onDestroy(() => guard.dispose());
}
