import type { CatalogEntry, CatalogTable } from '$lib/db/catalog-repo';

interface CommonOptions {
  table: CatalogTable;
  noun: string;
  entries: CatalogEntry[];
  refresh: () => Promise<CatalogEntry[]>;
}

export interface CatalogActionResult {
  entries: CatalogEntry[];
  note: string;
}

interface RenameOptions extends CommonOptions {
  id: number;
  name: string;
  rename: (id: number, name: string) => Promise<void>;
}

interface AddOptions extends CommonOptions {
  name: string;
  add: (name: string) => Promise<void>;
}

export interface CatalogAddResult extends CatalogActionResult {
  added: boolean;
}

interface ToggleOptions extends CommonOptions {
  entry: CatalogEntry;
  setActive: (id: number, active: boolean) => Promise<void>;
}

interface DeleteOptions extends CommonOptions {
  entry: CatalogEntry;
  remove: (id: number) => Promise<boolean>;
  setActive: (id: number, active: boolean) => Promise<void>;
}

function failureMessage(action: string, noun: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  return `Couldn't ${action} this ${noun}${detail ? `: ${detail}` : '.'}`;
}

function refreshFailureMessage(noun: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  return `Couldn't refresh the ${noun} list${detail ? `: ${detail}` : '.'}`;
}

function appendStatus(note: string, next: string): string {
  if (!note) return next;
  return `${note}${/[.!?]$/.test(note) ? '' : '.'} ${next}`;
}

async function withRefreshedEntries(
  options: CommonOptions,
  note: string,
  fallbackEntries: CatalogEntry[] = options.entries,
): Promise<CatalogActionResult> {
  try {
    return { entries: await options.refresh(), note };
  } catch (error) {
    return {
      entries: fallbackEntries,
      note: appendStatus(note, refreshFailureMessage(options.noun, error)),
    };
  }
}

export async function runCatalogRename(options: RenameOptions): Promise<CatalogActionResult> {
  const name = options.name.trim();
  if (!name) {
    return withRefreshedEntries(options, `Enter a name for this ${options.noun}.`);
  }

  try {
    await options.rename(options.id, name);
  } catch (error) {
    return withRefreshedEntries(options, failureMessage('rename', options.noun, error));
  }

  return withRefreshedEntries(options, `Renamed ${options.noun} to "${name}".`);
}

export async function runCatalogAdd(options: AddOptions): Promise<CatalogAddResult> {
  const name = options.name.trim();
  const existing = options.table === 'clients' || options.table === 'approvers'
    ? options.entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
    : undefined;

  try {
    await options.add(name);
  } catch (error) {
    return {
      entries: options.entries,
      note: error instanceof Error ? error.message : String(error),
      added: false,
    };
  }

  const result = await withRefreshedEntries(
    options,
    existing ? `"${existing.name}" is already in your list.` : `Added ${options.noun} "${name}".`,
  );
  return { ...result, added: true };
}

export async function runCatalogToggle(options: ToggleOptions): Promise<CatalogActionResult> {
  const action = options.entry.active ? 'deactivate' : 'activate';
  try {
    await options.setActive(options.entry.id, !options.entry.active);
  } catch (error) {
    return withRefreshedEntries(options, failureMessage(action, options.noun, error));
  }

  const completed = options.entry.active ? 'Deactivated' : 'Activated';
  return withRefreshedEntries(options, `${completed} ${options.noun} "${options.entry.name}".`);
}

export async function runCatalogDelete(options: DeleteOptions): Promise<CatalogActionResult> {
  let deleted: boolean;
  try {
    deleted = await options.remove(options.entry.id);
  } catch (error) {
    return withRefreshedEntries(options, failureMessage('delete', options.noun, error));
  }

  if (!deleted) {
    try {
      await options.setActive(options.entry.id, false);
    } catch (error) {
      return withRefreshedEntries(options, failureMessage('deactivate', options.noun, error));
    }

    return withRefreshedEntries(
      options,
      `This ${options.noun} is used on past invoices, so "${options.entry.name}" can't be deleted — it was deactivated and is now hidden from new rows.`,
    );
  }

  const note = options.table === 'approvers'
    ? `Deleted ${options.noun} "${options.entry.name}". Draft mileage approvals that used this approver must be re-selected.`
    : `Deleted ${options.noun} "${options.entry.name}".`;
  return withRefreshedEntries(
    options,
    note,
    options.entries.filter((entry) => entry.id !== options.entry.id),
  );
}
