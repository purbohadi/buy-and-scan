import { isTriviallyEmptyReceipt } from "../worker/receipt-quality";

describe("isTriviallyEmptyReceipt", () => {
  it("detects default shell from {}", () => {
    expect(
      isTriviallyEmptyReceipt({
        currency: "JPY",
        total: 0,
        items: []
      })
    ).toBe(true);
  });

  it("false when there are real items", () => {
    expect(
      isTriviallyEmptyReceipt({
        currency: "IDR",
        total: 0,
        items: [{ name: "Pen", quantity: 1, unitPrice: 1000, lineTotal: 1000 }]
      })
    ).toBe(false);
  });

  it("false when vendor set", () => {
    expect(
      isTriviallyEmptyReceipt({
        vendor: "ACME",
        currency: "JPY",
        total: 0,
        items: []
      })
    ).toBe(false);
  });
});
