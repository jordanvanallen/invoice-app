import { describe, expect, test } from 'vitest';
import type { CatalogEntry } from '$lib/db/catalog-repo';
import { runCatalogAdd, runCatalogDelete, runCatalogRename, runCatalogToggle } from './catalogManagerActions';

const jordan: CatalogEntry = { id: 7, name: 'Jordan Lee', active: true };

describe('CatalogManager actions', () => {
  test('successful add returns refreshed state and a noun-specific status', async () => {
    const added = { id: 8, name: 'Casey Morgan', active: true };
    let persistedName = '';

    const result = await runCatalogAdd({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      name: '  Casey Morgan  ',
      add: async (name) => { persistedName = name; },
      refresh: async () => [jordan, added],
    });

    expect(persistedName).toBe('Casey Morgan');
    expect(result).toEqual({
      entries: [jordan, added],
      note: 'Added approver "Casey Morgan".',
      added: true,
    });
  });

  test('successful duplicate add preserves the existing already-listed status', async () => {
    await expect(runCatalogAdd({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      name: 'jordan lee',
      add: async () => undefined,
      refresh: async () => [jordan],
    })).resolves.toEqual({
      entries: [jordan],
      note: '"Jordan Lee" is already in your list.',
      added: true,
    });
  });

  test('add failure preserves its existing message and input state', async () => {
    await expect(runCatalogAdd({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      name: 'Casey Morgan',
      add: async () => { throw new Error('database unavailable'); },
      refresh: async () => { throw new Error('refresh must not run'); },
    })).resolves.toEqual({
      entries: [jordan],
      note: 'database unavailable',
      added: false,
    });
  });

  test('blank rename restores persisted state and returns a noun-specific validation status', async () => {
    let renameCalled = false;
    let refreshCount = 0;

    const result = await runCatalogRename({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      id: jordan.id,
      name: '   ',
      rename: async () => { renameCalled = true; },
      refresh: async () => { refreshCount += 1; return [jordan]; },
    });

    expect(renameCalled).toBe(false);
    expect(refreshCount).toBe(1);
    expect(result).toEqual({
      entries: [jordan],
      note: 'Enter a name for this approver.',
    });
  });

  test('successful rename returns refreshed current-name state and status', async () => {
    const renamed = { ...jordan, name: 'Jordan Smith' };
    let persistedName = '';

    const result = await runCatalogRename({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      id: jordan.id,
      name: '  Jordan Smith  ',
      rename: async (_id, name) => { persistedName = name; },
      refresh: async () => [renamed],
    });

    expect(persistedName).toBe('Jordan Smith');
    expect(result).toEqual({
      entries: [renamed],
      note: 'Renamed approver to "Jordan Smith".',
    });
  });

  test('successful approver deletion warns that draft mileage approvals need re-selection', async () => {
    const result = await runCatalogDelete({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      remove: async () => true,
      setActive: async () => { throw new Error('setActive must not run'); },
      refresh: async () => [],
    });

    expect(result).toEqual({
      entries: [],
      note: 'Deleted approver "Jordan Lee". Draft mileage approvals that used this approver must be re-selected.',
    });
  });

  test('successful approver deletion preserves its warning when refresh fails', async () => {
    await expect(runCatalogDelete({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      remove: async () => true,
      setActive: async () => { throw new Error('setActive must not run'); },
      refresh: async () => { throw new Error('reload failed'); },
    })).resolves.toEqual({
      entries: [],
      note: 'Deleted approver "Jordan Lee". Draft mileage approvals that used this approver must be re-selected. Couldn\'t refresh the approver list: reload failed',
    });
  });

  test('generic catalog deletion does not show the mileage re-selection warning', async () => {
    const client = { id: 9, name: 'Globex Finance', active: true };

    const result = await runCatalogDelete({
      table: 'clients',
      noun: 'client',
      entries: [client],
      entry: client,
      remove: async () => true,
      setActive: async () => { throw new Error('setActive must not run'); },
      refresh: async () => [],
    });

    expect(result).toEqual({ entries: [], note: 'Deleted client "Globex Finance".' });
  });

  test('toggle failure returns a noun-specific error and refreshed state', async () => {
    let refreshCount = 0;

    const result = await runCatalogToggle({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      setActive: async () => { throw new Error('database unavailable'); },
      refresh: async () => { refreshCount += 1; return [jordan]; },
    });

    expect(refreshCount).toBe(1);
    expect(result).toEqual({
      entries: [jordan],
      note: "Couldn't deactivate this approver: database unavailable",
    });
  });

  test('successful activation and deactivation return named polite statuses', async () => {
    const inactive = { ...jordan, active: false };
    await expect(runCatalogToggle({
      table: 'approvers',
      noun: 'approver',
      entries: [inactive],
      entry: inactive,
      setActive: async () => undefined,
      refresh: async () => [jordan],
    })).resolves.toEqual({ entries: [jordan], note: 'Activated approver "Jordan Lee".' });

    await expect(runCatalogToggle({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      setActive: async () => undefined,
      refresh: async () => [inactive],
    })).resolves.toEqual({ entries: [inactive], note: 'Deactivated approver "Jordan Lee".' });
  });

  test('delete failure returns a noun-specific error and refreshed state', async () => {
    let refreshCount = 0;

    const result = await runCatalogDelete({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      remove: async () => { throw new Error('database unavailable'); },
      setActive: async () => undefined,
      refresh: async () => { refreshCount += 1; return [jordan]; },
    });

    expect(refreshCount).toBe(1);
    expect(result).toEqual({
      entries: [jordan],
      note: "Couldn't delete this approver: database unavailable",
    });
  });

  test('failed fallback deactivation reports the deactivation stage and refreshes state', async () => {
    let refreshCount = 0;

    const result = await runCatalogDelete({
      table: 'approvers',
      noun: 'approver',
      entries: [jordan],
      entry: jordan,
      remove: async () => false,
      setActive: async () => { throw new Error('database unavailable'); },
      refresh: async () => { refreshCount += 1; return [jordan]; },
    });

    expect(refreshCount).toBe(1);
    expect(result).toEqual({
      entries: [jordan],
      note: "Couldn't deactivate this approver: database unavailable",
    });
  });
});
