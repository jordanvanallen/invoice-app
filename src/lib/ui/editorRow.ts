import type { LineItem, LineType } from '../types';
import { centsToInput } from './format';

/** A LineItem plus a stable client-side id so `{#each}` can key by identity
 *  (index keys attach input/combobox state to the wrong row after a delete).
 *  feeText/mileageText hold what the user is typing so the field never reformats
 *  mid-keystroke; cents stay the source of truth and are dropped at the DB layer. */
export interface EditorRow extends LineItem {
  uid: number;
  feeText: string;
  mileageText: string;
  approvalCollapsed: boolean;
}

let counter = 0;

export function newRow(type: LineType, feeCents: number, date: string): EditorRow {
  return {
    uid: ++counter, type, position: 0, inspectionNumber: '', clientId: null, clientName: '',
    locationId: null, location: '', date, vin8: '', mileageCents: 0,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '', feeCents,
    feeText: centsToInput(feeCents), mileageText: '', approvalCollapsed: false,
  };
}

export function toEditorRow(l: LineItem): EditorRow {
  return {
    ...l, uid: ++counter,
    feeText: centsToInput(l.feeCents), mileageText: l.mileageCents ? centsToInput(l.mileageCents) : '',
    approvalCollapsed: false,
  };
}
