import type { LineItem } from './types';
import { formatIsoDate, isValidIsoDate } from './validation';

export function hasCompleteMileageApproval(line: Partial<LineItem>): boolean {
  return (line.mileageCents ?? 0) > 0
    && line.mileageApproverId != null
    && !!line.mileageApproverName?.trim()
    && isValidIsoDate(line.mileageApprovalDate ?? '');
}

export function mileageApprovalText(line: Partial<LineItem>): string | null {
  if ((line.mileageCents ?? 0) <= 0) return null;
  const name = line.mileageApproverName?.trim() ?? '';
  const date = line.mileageApprovalDate ?? '';
  if (!name || !isValidIsoDate(date)) return null;
  return `Mileage approved by ${name} on ${formatIsoDate(date)}`;
}
