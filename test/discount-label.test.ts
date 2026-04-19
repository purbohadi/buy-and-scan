import { normalizeDiscountItemName } from "../shared/discount-label";

describe("normalizeDiscountItemName", () => {
  it("keeps explicit discount wording", () => {
    expect(normalizeDiscountItemName("Diskon Transaksi", -13810, -13810)).toBe("Diskon Transaksi");
    expect(normalizeDiscountItemName("Discount", -100, -100)).toBe("Discount");
  });

  it("labels negative lines without discount words", () => {
    expect(normalizeDiscountItemName("x", -13810, -13810)).toBe("Discount");
    expect(normalizeDiscountItemName("", -500, -500)).toBe("Discount");
  });

  it("does not rename positive lines", () => {
    expect(normalizeDiscountItemName("Pen", 5000, 5000)).toBe("Pen");
  });
});
