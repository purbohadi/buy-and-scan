/**
 * When a line has negative amounts (typical store discount), use a clear label
 * unless the receipt already names it (Diskon, etc.).
 */
export function normalizeDiscountItemName(name: string, lineTotal: number, unitPrice: number): string {
  const n = name.trim();
  const isNegative = lineTotal < 0 || unitPrice < 0;
  if (!isNegative) return n || "Item";
  if (/discount|diskon|potongan|rebate|korting|hemat|promo/i.test(n)) return n || "Discount";
  return "Discount";
}
