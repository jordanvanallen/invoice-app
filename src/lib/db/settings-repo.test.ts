import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { getSettings, saveSettings } from './settings-repo';
import type { Settings } from '../types';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

describe('settings repo', () => {
  test('getSettings returns seeded defaults', async () => {
    const db = await freshDb();
    const s = await getSettings(db);
    expect(s.taxRateBp).toBe(1300);
    expect(s.defaultCompletedFeeCents).toBe(3800);
    expect(s.defaultNoshowFeeCents).toBe(2500);
    expect(s.registered).toBe(true);
    expect(s.inspectorName).toBe('');
  });

  test('saveSettings round-trips all fields', async () => {
    const db = await freshDb();
    const next: Settings = {
      inspectorName: 'Jane Tester',
      inspectorAddress: '123 Test Street, Sampleton, ON A1A 1A1',
      inspectorNumber: '00000',
      gstHstRegistrationNumber: '123456789RT0001',
      billToName: 'Example Client Inc.',
      billToAddress: '100 Example Ave Suite 1, Sample City, QC A1A 1A1',
      registered: true,
      taxRateBp: 1300,
      defaultCompletedFeeCents: 3800,
      defaultNoshowFeeCents: 2500,
      paymentEmail: 'billing@example.com',
      footerNotes: 'Email the completed form to billing@example.com',
      logoDataUrl: "",
    };
    await saveSettings(db, next);
    expect(await getSettings(db)).toEqual(next);
  });
});
