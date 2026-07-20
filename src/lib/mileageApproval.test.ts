import { expect, test } from 'vitest';
import { hasCompleteMileageApproval, mileageApprovalText } from './mileageApproval';
import type { LineItem, LineType } from './types';
import { newRow, toEditorRow } from './ui/editorRow';

function line(type: LineType = 'completed', over: Partial<LineItem> = {}): LineItem {
  return {
    type, position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-07-18', vin8: 'XY12AB99', mileageCents: 1800,
    mileageApproverId: 7, mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-07-18', feeCents: 3800,
    ...over,
  };
}

test('formats only complete non-zero mileage approvals', () => {
  expect(mileageApprovalText({
    mileageCents: 1800,
    mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-07-18',
  })).toBe('Mileage approved by Jordan Lee on Jul 18, 2026');
  expect(mileageApprovalText({ mileageCents: 0 })).toBeNull();
  expect(mileageApprovalText({ mileageCents: 1800 })).toBeNull();
  expect(mileageApprovalText({
    mileageCents: 1800,
    mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-02-30',
  })).toBeNull();
});

test('requires a linked saved approver for a complete mileage approval', () => {
  expect(hasCompleteMileageApproval(line())).toBe(true);
  expect(hasCompleteMileageApproval(line('noshow'))).toBe(true);
  expect(hasCompleteMileageApproval(line('completed', { mileageApproverId: null }))).toBe(false);
  expect(hasCompleteMileageApproval(line('completed', { mileageApproverName: '  ' }))).toBe(false);
  expect(hasCompleteMileageApproval(line('completed', {
    mileageApprovalDate: '2026-02-30',
  }))).toBe(false);
  expect(hasCompleteMileageApproval(line('completed', { mileageCents: 0 }))).toBe(false);
});

test('keeps legacy evidence text ID-tolerant while an unlinked draft remains incomplete', () => {
  const unlinked = line('completed', { mileageApproverId: null });

  expect(mileageApprovalText(unlinked)).toBe(
    'Mileage approved by Jordan Lee on Jul 18, 2026',
  );
  expect(hasCompleteMileageApproval(unlinked)).toBe(false);
});

test('collapses only loaded complete approvals while new rows remain expanded', () => {
  expect(toEditorRow(line('completed')).approvalCollapsed).toBe(true);
  expect(toEditorRow(line('noshow')).approvalCollapsed).toBe(true);
  expect(toEditorRow(line('completed', { mileageApproverId: null })).approvalCollapsed).toBe(false);
  expect(newRow('completed', 3800, '2026-07-18').approvalCollapsed).toBe(false);
  expect(newRow('noshow', 2500, '2026-07-18').approvalCollapsed).toBe(false);
});
