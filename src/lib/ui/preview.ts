export type PreviewPreparation<T> = {
  sortRows: () => void;
  buildSnapshot: () => T;
};

export function prepareInvoicePreview<T>({
  sortRows,
  buildSnapshot,
}: PreviewPreparation<T>): T {
  sortRows();
  return buildSnapshot();
}
