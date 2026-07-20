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

async function withRefreshedEntries(
  options: CommonOptions,
  note: string,
): Promise<CatalogActionResult> {
  try {
    return { entries: await options.refresh(), note };
  } catch (error) {
    return {
      entries: options.entries,
      note: failureMessage('refresh', `${options.noun} list`, error),
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

export async function runCatalogToggle(options: ToggleOptions): Promise<CatalogActionResult> {
  const action = options.entry.active ? 'deactivate' : 'activate';
  try {
    await options.setActive(options.entry.id, !options.entry.active);
  } catch (error) {
    return withRefreshedEntries(options, failureMessage(action, options.noun, error));
  }

  return withRefreshedEntries(options, '');
}

export async function runCatalogDelete(options: DeleteOptions): Promise<CatalogActionResult> {
  let note: string;
  try {
    const deleted = await options.remove(options.entry.id);
    if (!deleted) {
      await options.setActive(options.entry.id, false);
      note = `This ${options.noun} is used on past invoices, so "${options.entry.name}" can't be deleted — it was deactivated and is now hidden from new rows.`;
    } else if (options.table === 'approvers') {
      note = `Deleted ${options.noun} "${options.entry.name}". Draft mileage approvals that used this approver must be re-selected.`;
    } else {
      note = `Deleted ${options.noun} "${options.entry.name}".`;
    }
  } catch (error) {
    return withRefreshedEntries(options, failureMessage('delete', options.noun, error));
  }

  return withRefreshedEntries(options, note);
}
