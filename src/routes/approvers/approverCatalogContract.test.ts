import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
}

describe('approver catalog UI contract', () => {
  test('catalog store exposes active approver loading and quick-add', () => {
    const store = readSource('src/lib/stores/catalog.ts');

    expect(store).toContain('export async function loadApprovers(): Promise<CatalogEntry[]>');
    expect(store).toContain("listEntries(await getDb(), 'approvers', { activeOnly: true })");
    expect(store).toContain('export async function addApprover(name: string): Promise<number>');
    expect(store).toContain("addEntry(await getDb(), 'approvers', name)");
  });

  test('catalog manager requires its noun and labels inputs and live status accessibly', () => {
    const manager = readSource('src/lib/components/CatalogManager.svelte');

    expect(manager).toMatch(/noun:\s*string/);
    expect(manager).toContain('aria-label={`Add ${noun}`}');
    expect(manager).toContain('aria-label={`Rename ${noun} ${e.name}`}');
    expect(manager).toContain('role="status" aria-live="polite"');
  });

  test('catalog manager reports noun-specific delete and deactivate outcomes', () => {
    const manager = readSource('src/lib/components/CatalogManager.svelte');

    expect(manager).toContain('Deleted ${noun}');
    expect(manager).toContain('This ${noun} is used on past invoices');
  });

  test('every catalog page supplies the required singular noun', () => {
    expect(readSource('src/routes/clients/+page.svelte')).toContain('noun="client"');
    expect(readSource('src/routes/locations/+page.svelte')).toContain('noun="location"');
    expect(readSource('src/routes/approvers/+page.svelte')).toContain('noun="approver"');
  });

  test('approvers page provides the requested catalog copy', () => {
    const page = readSource('src/routes/approvers/+page.svelte');

    expect(page).toContain('table="approvers"');
    expect(page).toContain('title="Approvers"');
    expect(page).toContain('helper="People who can approve mileage charges on invoices."');
    expect(page).toContain('addLabel="Add an approver (e.g. Jordan Lee)"');
    expect(page).toContain('examples="Jordan Lee, Casey Morgan"');
  });

  test('app navigation places Approvers immediately after Locations', () => {
    const shell = readSource('src/lib/components/AppShell.svelte');
    const locations = shell.indexOf("{ href: '/locations', label: 'Locations' }");
    const approvers = shell.indexOf("{ href: '/approvers', label: 'Approvers' }");
    const backups = shell.indexOf("{ href: '/backups', label: 'Backups' }");

    expect(locations).toBeGreaterThan(-1);
    expect(approvers).toBeGreaterThan(locations);
    expect(approvers).toBeLessThan(backups);
  });
});
