/**
 * Run an invoice-detail action that leaves the page when it succeeds. A refusal returns
 * its reason ('' on success) without navigating, so the invoice, its snapshot and the
 * page controls stay exactly as they were for the user to read and act on.
 */
export async function runThenLeave(
  action: () => Promise<void>,
  leave: () => Promise<void>,
): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  await leave();
  return '';
}
