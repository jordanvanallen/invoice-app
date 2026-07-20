<script lang="ts">
  import { tick } from 'svelte';
  import {
    calendarDateLabel,
    initialCalendarDate,
    moveCalendarDateByKey,
    moveCalendarMonth,
    parseIsoDate,
    toIsoDate,
  } from '$lib/ui/date';

  /**
   * A self-contained calendar picker that replaces <input type="date">.
   *
   * WebKitGTK (the Linux dev webview) ships a broken native date popup — the
   * calendar opens but often won't commit a pick or dismiss on outside-click.
   * WebView2 (the Windows target) is fine, but we render our own calendar so the
   * behaviour is identical everywhere and we control the look.
   *
   * Every instance is fully independent: click toggles its own calendar, picking
   * a day sets its own value and closes, clicking elsewhere or Escape closes.
   * No shared state, no chaining — so two pickers never interfere.
   *
   * value is an ISO date string ("YYYY-MM-DD") or '' when unset, bindable.
   */
  interface Props {
    value?: string;
    ariaLabel?: string;
    block?: boolean;
    fieldId?: string;
    required?: boolean;
    invalid?: boolean;
    errorId?: string;
    onChange?: () => void;
  }
  let {
    value = $bindable(''),
    ariaLabel = 'Date',
    block = false,
    fieldId = `dp-${Math.random().toString(36).slice(2)}`,
    required = false,
    invalid = false,
    errorId = '',
    onChange = () => {},
  }: Props = $props();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  let open = $state(false);
  let root = $state<HTMLElement>();
  let fieldEl = $state<HTMLButtonElement>();
  let dialogEl = $state<HTMLDivElement>();
  let popStyle = $state('');
  // First day of the month currently shown in the popover.
  let view = $state(new Date());
  let focusDate = $state(new Date());

  function label(iso: string): string {
    const d = parseIsoDate(iso);
    return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Pick a date';
  }

  const selected = $derived(parseIsoDate(value));
  const grid = $derived.by(() => {
    const y = view.getFullYear(), mo = view.getMonth();
    const lead = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  /** Anchor the popover to the field with fixed positioning so no clipping
   * ancestor (e.g. an invoice-row grid cell) can cut it off; flip above the
   * field when there isn't room below. */
  function place() {
    if (!fieldEl) return;
    const r = fieldEl.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-scale')) || 1;
    const w = 288 * scale, h = 348 * scale, gap = 4, m = 8;
    const left = Math.max(m, Math.min(r.left, window.innerWidth - w - m));
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - m) {
      const above = r.top - gap - h;
      top = above >= m ? above : Math.max(m, window.innerHeight - h - m);
    }
    popStyle = `top:${top}px;left:${left}px;`;
  }
  async function focusDay() {
    await tick();
    const target = document.getElementById(`${fieldId}-day-${toIsoDate(focusDate)}`) as HTMLButtonElement | null
      ?? root?.querySelector<HTMLButtonElement>('.day');
    target?.focus();
  }
  async function closeAndRestoreFocus() {
    open = false;
    await tick();
    fieldEl?.focus();
  }
  async function toggle() {
    if (open) { await closeAndRestoreFocus(); return; }
    const initial = initialCalendarDate(value);
    focusDate = initial;
    view = new Date(initial.getFullYear(), initial.getMonth(), 1);
    place();
    open = true;
    await focusDay();
  }
  async function pick(day: number) {
    value = toIsoDate(dateForDay(day));
    open = false;
    onChange();
    await tick();
    fieldEl?.focus();
  }

  // WebKitGTK can emit a duplicate "ghost" click after a popover closes mid-click
  // — a synthesized click with no preceding pointerdown that lands on whatever is
  // now under the pointer (often an adjacent date field) and spuriously reopens a
  // calendar. Only honour clicks that began with a real pointerdown on the target.
  let armed = false;
  function arm() { armed = true; }
  function guard(event: MouseEvent, action: () => void) {
    const keyboardActivation = event.detail === 0
      && event.clientX === 0
      && event.clientY === 0;
    if (keyboardActivation) {
      action();
      return;
    }
    if (!armed) return;
    armed = false;
    action();
  }
  function step(delta: number) {
    focusDate = moveCalendarMonth(focusDate, delta);
    view = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
  }

  async function onDayKeydown(event: KeyboardEvent, date: Date) {
    const next = moveCalendarDateByKey(date, event.key);
    if (!next) return;
    event.preventDefault();
    focusDate = next;
    view = new Date(next.getFullYear(), next.getMonth(), 1);
    await focusDay();
  }

  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !dialogEl) return;
    const focusable = dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      void closeAndRestoreFocus();
    }
  }

  function onDocPointer(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function dateForDay(day: number): Date {
    return new Date(view.getFullYear(), view.getMonth(), day);
  }
  function isSel(day: number): boolean {
    return !!selected && selected.getFullYear() === view.getFullYear()
      && selected.getMonth() === view.getMonth() && selected.getDate() === day;
  }
  function isFocused(day: number): boolean {
    return focusDate.getFullYear() === view.getFullYear()
      && focusDate.getMonth() === view.getMonth() && focusDate.getDate() === day;
  }
</script>

<svelte:window
  onmousedown={onDocPointer}
  onkeydown={onWindowKeydown}
  onresize={() => (open = false)}
  onscroll={() => (open = false)}
/>

<div class="dp" class:block bind:this={root}>
  <!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
  <button
    id={fieldId}
    type="button"
    class="field"
    onpointerdown={arm}
    onclick={(event) => guard(event, toggle)}
    bind:this={fieldEl}
    aria-label={`${ariaLabel}${required ? ' (required)' : ''}`}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-invalid={invalid}
    aria-describedby={errorId || undefined}
  >
    <span class:placeholder={!selected}>{label(value)}</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  </button>

  {#if open}
    <div class="pop" bind:this={dialogEl} onkeydown={onDialogKeydown}
      role="dialog" aria-modal="true" aria-label="Choose a date" tabindex="-1" style={popStyle}>
      <div class="nav">
        <button type="button" onclick={() => step(-1)} aria-label="Previous month">‹</button>
        <span class="cap">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
        <button type="button" onclick={() => step(1)} aria-label="Next month">›</button>
      </div>
      <div class="dow">{#each DOW as d}<span>{d}</span>{/each}</div>
      <div class="days" role="grid" aria-label={`${MONTHS[view.getMonth()]} ${view.getFullYear()}`}>
        {#each grid as week}
          <div class="week" role="row">
            {#each week as day}
              {#if day === null}
                <div role="gridcell"></div>
              {:else}
                <div role="gridcell" aria-selected={isSel(day)}>
                  <button
                    id={`${fieldId}-day-${toIsoDate(dateForDay(day))}`}
                    type="button"
                    class="day"
                    class:sel={isSel(day)}
                    aria-label={calendarDateLabel(dateForDay(day))}
                    tabindex={isFocused(day) ? 0 : -1}
                    onpointerdown={arm}
                    onclick={(event) => guard(event, () => pick(day))}
                    onkeydown={(event) => onDayKeydown(event, dateForDay(day))}
                  >{day}</button>
                </div>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .dp { position: relative; display: inline-block; }
  .dp.block { display: block; width: 100%; }
  /* In a grid cell (rows) fill the cell exactly; the min-width is only for inline use. */
  .dp.block .field { min-width: 0; }

  .field {
    display: inline-flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
    min-height: var(--input-h, 44px); width: 100%; min-width: 9.5rem;
    padding: 0 var(--sp-3); border: 1px solid var(--border-strong);
    background: var(--bg-surface); color: var(--text-primary);
    border-radius: var(--r-sm); font-size: var(--fs-base); cursor: pointer; text-align: left;
  }
  .field:hover { background: var(--accent-tint); }
  .field:focus-visible { outline: 2px solid var(--accent-fill); outline-offset: 1px; }
  .field > span { white-space: nowrap; }
  .field .placeholder { color: var(--text-muted); }
  .field svg { flex-shrink: 0; color: var(--text-secondary); }

  .pop {
    position: fixed; z-index: 60;
    width: calc(18rem * var(--fs-scale)); padding: var(--sp-3);
    background: var(--bg-surface); border: 1px solid var(--border-strong);
    border-radius: var(--r-md); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  }
  .nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-2); }
  .nav .cap { font-weight: 700; font-size: var(--fs-base); }
  .nav button {
    width: 36px; height: 36px; border: 1px solid var(--border); background: var(--bg-surface);
    color: var(--text-primary); border-radius: var(--r-sm); font-size: var(--fs-lg); line-height: 1; cursor: pointer;
  }
  .nav button:hover { background: var(--accent-tint); }

  .dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
  .days { display: flex; flex-direction: column; gap: 2px; }
  .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
  [role="gridcell"] { min-width: 0; }
  .dow { margin-bottom: 2px; }
  .dow span { text-align: center; font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); padding: 2px 0; }
  .day {
    aspect-ratio: 1; min-height: 36px; width: 100%; min-width: 0; border: 1px solid transparent; background: transparent;
    color: var(--text-primary); border-radius: var(--r-sm); font-size: var(--fs-base); cursor: pointer;
  }
  .day:hover { background: var(--accent-tint); }
  .day.sel { background: var(--accent-fill); color: var(--on-accent, #fff); border-color: var(--accent-fill); font-weight: 700; }
</style>
