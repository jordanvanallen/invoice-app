import { getDb } from '../db';
import { listEntries, addEntry, type CatalogEntry } from '../db/catalog-repo';

export async function loadClients(): Promise<CatalogEntry[]> {
  return listEntries(await getDb(), 'clients', { activeOnly: true });
}
export async function loadLocations(): Promise<CatalogEntry[]> {
  return listEntries(await getDb(), 'locations', { activeOnly: true });
}
export async function addClient(name: string): Promise<number> {
  return addEntry(await getDb(), 'clients', name);
}
export async function addLocation(name: string): Promise<number> {
  return addEntry(await getDb(), 'locations', name);
}
