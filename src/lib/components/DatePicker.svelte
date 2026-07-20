<script lang="ts">
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
  let popStyle = $state('');
  // First day of the month currently shown in the popover.
  let view = $state(new Date());

  /** Parse an ISO date as a LOCAL date (avoids the UTC off-by-one of new Date(iso)). */
  function parse(iso: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function label(iso: string): string {
    const d = parse(iso);
    return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Pick a date';
  }

  const selected = $derived(parse(value));
  const grid = $derived.by(() => {
    const y = view.getFullYear(), mo = view.getMonth();
    const lead = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    return cells;
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
  function toggle() {
    if (open) { open = false; return; }
    view = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date();
    place();
    open = true;
  }
  function pick(day: number) {
    value = toIso(new Date(view.getFullYear(), view.getMonth(), day));
    open = false;
    onChange();
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
  function step(delta: number) { view = new Date(view.getFullYear(), view.getMonth() + delta, 1); }

  function onDocPointer(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function isSel(day: number): boolean {
    return !!selected && selected.getFullYear() === view.getFullYear()
      && selected.getMonth() === view.getMonth() && selected.getDate() === day;
  }
</script>

<svelte:window
  onmousedown={onDocPointer}
  onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
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
    <div class="pop" role="dialog" aria-label="Choose a date" style={popStyle}>
      <div class="nav">
        <button type="button" onclick={() => step(-1)} aria-label="Previous month">‹</button>
        <span class="cap">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
        <button type="button" onclick={() => step(1)} aria-label="Next month">›</button>
      </div>
      <div class="dow">{#each DOW as d}<span>{d}</span>{/each}</div>
      <div class="days">
        {#each grid as day}
          {#if day === null}
            <span></span>
          {:else}
            <button type="button" class="day" class:sel={isSel(day)}
              onpointerdown={arm} onclick={(event) => guard(event, () => pick(day))}>{day}</button>
          {/if}
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

  .dow, .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
  .dow { margin-bottom: 2px; }
  .dow span { text-align: center; font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); padding: 2px 0; }
  .day {
    aspect-ratio: 1; min-height: 36px; min-width: 0; border: 1px solid transparent; background: transparent;
    color: var(--text-primary); border-radius: var(--r-sm); font-size: var(--fs-base); cursor: pointer;
  }
  .day:hover { background: var(--accent-tint); }
  .day.sel { background: var(--accent-fill); color: var(--on-accent, #fff); border-color: var(--accent-fill); font-weight: 700; }
</style>
