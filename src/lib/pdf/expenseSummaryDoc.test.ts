import { describe, expect, test } from 'vitest';
import { buildExpenseSummaryDoc, type ExpenseSummaryInput } from './expenseSummaryDoc';

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((value) => collectText(value, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text' && (typeof value === 'string' || typeof value === 'number')) out.push(String(value));
      else collectText(value, out);
    }
  }
  return out;
}

export const expenseSummaryInput: ExpenseSummaryInput = {
  rangeLabel: 'July 1, 2026 – July 31, 2026',
  preparedOn: '2026-07-21',
  businessName: 'Jane Tester',
  reports: [{
    id: 1,
    reportNumber: '4-2026',
    reportDate: '2026-07-15',
    totalCents: 7_500,
    status: 'finalized',
  }],
  items: [{
    reportId: 1,
    reportNumber: '4-2026',
    reportDate: '2026-07-15',
    itemId: 10,
    itemDate: '2026-06-30',
    position: 0,
    description: 'Fuel',
    amountCents: 7_500,
  }],
};

describe('expense summary document', () => {
  test('shows the frozen range, distinct report count, total, and item detail', () => {
    const text = collectText(buildExpenseSummaryDoc(expenseSummaryInput));

    expect(text).toEqual(expect.arrayContaining([
      'Expense Summary',
      'July 1, 2026 – July 31, 2026',
      'Reports',
      '1',
      'Total expenses',
      '$75.00',
      'Jun 30, 2026',
      'Fuel',
      '4-2026',
    ]));
  });

  test('counts reports rather than item rows', () => {
    const text = collectText(buildExpenseSummaryDoc({
      ...expenseSummaryInput,
      items: [
        expenseSummaryInput.items[0],
        { ...expenseSummaryInput.items[0], itemId: 11, position: 1, description: 'Parking' },
      ],
    }));

    const reportsIndex = text.indexOf('Reports');
    expect(text[reportsIndex + 1]).toBe('1');
  });
});
