import type { ParsedReceipt } from "./types";

/**
 * True when the model likely returned an empty JSON shell (no line items, no total, no useful metadata).
 * In that case we should treat the step as failed and try the next provider in the chain.
 */
export function isTriviallyEmptyReceipt(r: ParsedReceipt): boolean {
  if (r.items.length > 0) {
    const onlyPlaceholders = r.items.every(
      (it) =>
        (!it.name || it.name === "Item" || it.name.trim() === "") &&
        it.lineTotal === 0 &&
        it.unitPrice === 0
    );
    if (!onlyPlaceholders) return false;
  }
  if (r.total !== 0) return false;
  if (r.vendor?.trim()) return false;
  if (r.description?.trim()) return false;
  if (r.category?.trim()) return false;
  if (r.receiptDatetime?.trim()) return false;
  if (r.location?.label?.trim()) return false;
  if (r.location?.latitude != null || r.location?.longitude != null) return false;
  return true;
}
