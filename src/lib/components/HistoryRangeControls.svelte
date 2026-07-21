<script lang="ts">
  import DatePicker from './DatePicker.svelte';
  import {
    historyPresets,
    resolveHistoryRange,
    type ClosedDateRange,
  } from '$lib/history/history';

  interface Props {
    start?: string;
    end?: string;
    exportLabel: string;
    busyLabel?: string;
    onExport: () => void | Promise<void>;
  }

  let {
    start = $bindable(''),
    end = $bindable(''),
    exportLabel,
    busyLabel = '',
    onExport,
  }: Props = $props();

  const presets = historyPresets(new Date());
  const resolution = $derived(resolveHistoryRange(start, end));
  const errorId = 'history-range-error';

  function selected(range: ClosedDateRange): boolean {
    return start === range.start && end === range.end;
  }

  function choose(range: ClosedDateRange | null): void {
    start = range?.start ?? '';
    end = range?.end ?? '';
  }
</script>

<fieldset class="history-toolbar">
  <legend>Filter and export by date</legend>

  <div class="history-presets" aria-label="Date range presets">
    <button
      type="button"
      aria-pressed={resolution.kind === 'all'}
      onclick={() => choose(null)}
    >All time</button>
    <button
      type="button"
      aria-pressed={selected(presets.thisYear)}
      onclick={() => choose(presets.thisYear)}
    >This year</button>
    <button
      type="button"
      aria-pressed={selected(presets.lastYear)}
      onclick={() => choose(presets.lastYear)}
    >Last year</button>
    <button
      type="button"
      aria-pressed={selected(presets.thisQuarter)}
      onclick={() => choose(presets.thisQuarter)}
    >This quarter</button>
  </div>

  <div class="history-date-field">
    <label for="history-range-start">From</label>
    <DatePicker
      fieldId="history-range-start"
      ariaLabel="From date"
      bind:value={start}
      invalid={resolution.kind === 'invalid'}
      errorId={errorId}
    />
  </div>

  <div class="history-date-field">
    <label for="history-range-end">To</label>
    <DatePicker
      fieldId="history-range-end"
      ariaLabel="To date"
      bind:value={end}
      invalid={resolution.kind === 'invalid'}
      errorId={errorId}
    />
  </div>

  <button
    type="button"
    class="history-export history-export-primary"
    disabled={resolution.kind === 'invalid' || !!busyLabel}
    onclick={onExport}
  >{busyLabel || exportLabel}</button>

  {#if resolution.kind === 'invalid'}
    <p id={errorId} class="history-range-error" role="alert">{resolution.error}</p>
  {/if}
</fieldset>
