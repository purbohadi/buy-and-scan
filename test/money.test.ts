import {
  coerceMoneyScalar,
  parseMoneyString,
  sanitizeMoneyAmount,
  sanitizeReceiptMoney
} from "../shared/money";

describe("sanitizeMoneyAmount", () => {
  it("rounds IDR to whole rupiah", () => {
    expect(sanitizeMoneyAmount(124290.7, "IDR")).toBe(124291);
    expect(sanitizeMoneyAmount(100, "JPY")).toBe(100);
  });

  it("keeps two decimals for USD", () => {
    expect(sanitizeMoneyAmount(10.999, "USD")).toBe(11);
    expect(sanitizeMoneyAmount(10.994, "USD")).toBe(10.99);
  });
});

describe("coerceMoneyScalar", () => {
  it("parses formatted strings", () => {
    expect(coerceMoneyScalar("Rp124.290")).toBe(124290);
    expect(coerceMoneyScalar("10.5")).toBe(10.5);
  });
});

describe("sanitizeReceiptMoney", () => {
  it("normalizes line totals from unit x qty for IDR", () => {
    const r = sanitizeReceiptMoney({
      currency: "IDR",
      total: 0,
      items: [{ name: "A", quantity: 2, unitPrice: 44000, lineTotal: 0 }]
    });
    expect(r.items[0].lineTotal).toBe(88000);
    expect(r.total).toBe(88000);
  });
});

describe("parseMoneyString", () => {
  it("matches legacy parseMoneyToNumber cases", () => {
    expect(parseMoneyString("Rp124.290")).toBe(124290);
    expect(parseMoneyString("Rp 138.100")).toBe(138100);
  });
});
