/** Shared money parsing / sanitization for Worker and web app (D1, Sheets, review UI). */

/** ISO 4217 currencies with no minor unit (store as whole numbers). */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  "IDR"
]);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(String(currency ?? "").toUpperCase().slice(0, 8));
}

export type MoneyItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type MoneyReceipt = {
  vendor?: string;
  receiptDatetime?: string;
  currency: string;
  total: number;
  category?: string;
  description?: string;
  items: MoneyItem[];
  location?: { latitude?: number; longitude?: number; label?: string };
};

/**
 * Turn API / form / model values into a finite number (strip thousands separators, Rp, etc.).
 */
export function coerceMoneyScalar(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s) return 0;
  const parsed = parseMoneyString(s);
  if (parsed != null) return parsed;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parse IDR-style amounts: Rp124,290 / Rp124.290 / 138.100 → number. */
export function parseMoneyString(raw: string): number | null {
  let s = raw.replace(/Rp/gi, "").replace(/\s/g, "").trim();
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    const n = Math.round(Number(cleaned.replace(/[.,]/g, "")));
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  }
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decSep = Math.max(lastComma, lastDot);
  if (decSep === -1) {
    const n = Math.round(Number(cleaned));
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  }
  const intPart = cleaned.slice(0, decSep).replace(/[.,]/g, "");
  const fracPart = cleaned.slice(decSep + 1).replace(/\D/g, "");
  const n = Number(`${intPart}.${fracPart || "0"}`);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return neg ? -rounded : rounded;
}

/** Store-safe amount for D1 / Sheets (integer for IDR/JPY, 2 decimals otherwise). */
export function sanitizeMoneyAmount(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  if (isZeroDecimalCurrency(currency)) return Math.round(amount);
  return Math.round(amount * 100) / 100;
}

export function sanitizeReceiptItemMoney(
  it: { name: string; quantity: unknown; unitPrice: unknown; lineTotal: unknown },
  currency: string
): MoneyItem {
  const quantity = Math.max(1, Math.round(coerceMoneyScalar(it.quantity) || 0) || 1);
  let unitPrice = sanitizeMoneyAmount(coerceMoneyScalar(it.unitPrice), currency);
  let lineTotal = sanitizeMoneyAmount(coerceMoneyScalar(it.lineTotal), currency);
  if (lineTotal === 0 && unitPrice > 0 && quantity > 0) {
    lineTotal = sanitizeMoneyAmount(unitPrice * quantity, currency);
  }
  if (unitPrice === 0 && lineTotal > 0 && quantity > 0) {
    unitPrice = sanitizeMoneyAmount(lineTotal / quantity, currency);
  }
  return { name: String(it.name ?? "Item"), quantity, unitPrice, lineTotal };
}

export function sanitizeReceiptMoney(receipt: MoneyReceipt): MoneyReceipt {
  const currency = String(receipt.currency ?? "JPY").toUpperCase().slice(0, 8);
  const items = receipt.items.map((it) => sanitizeReceiptItemMoney(it, currency));
  let total = sanitizeMoneyAmount(coerceMoneyScalar(receipt.total), currency);
  const sumLines = items.reduce((s, it) => s + it.lineTotal, 0);
  if (total === 0 && sumLines > 0) total = sanitizeMoneyAmount(sumLines, currency);
  return { ...receipt, currency, items, total };
}

/** Human-readable amount for review UI. */
export function formatMoneyDisplay(amount: number, currency: string): string {
  const c = String(currency ?? "USD").toUpperCase().slice(0, 8);
  const n = sanitizeMoneyAmount(amount, c);
  if (isZeroDecimalCurrency(c)) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
