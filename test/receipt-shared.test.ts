import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractJsonObject,
  normalizeParsed,
  parseMoneyToNumber,
  parseReceiptFromMarkdownStyle,
  parseReceiptModelText,
  repairJsonText,
  tryParseReceiptJsonObject
} from "../worker/receipt-shared";
import type { ParsedReceipt } from "../worker/types";

function loadExpected(): ParsedReceipt {
  const raw = readFileSync(
    join(process.cwd(), "test", "fixtures", "receipt-toko-gading-murni-expected.json"),
    "utf8"
  );
  return normalizeParsed(JSON.parse(raw) as Record<string, unknown>);
}

describe("extractJsonObject", () => {
  it("extracts JSON when a string value contains a closing brace", () => {
    const wrapped = `Here is the data:\n{"description": "Price } still inside string", "total": 1, "currency": "IDR", "items": []}\nThanks.`;
    const json = extractJsonObject(wrapped);
    expect(json).not.toBeNull();
    const o = JSON.parse(json!) as Record<string, unknown>;
    expect(o.description).toBe("Price } still inside string");
    expect(o.total).toBe(1);
  });

  it("extracts from markdown fence", () => {
    const text = '```json\n{"currency":"JPY","total":100,"items":[]}\n```';
    expect(extractJsonObject(text)).toBe('{"currency":"JPY","total":100,"items":[]}');
  });
});

describe("parseMoneyToNumber", () => {
  it("parses Indonesian-style Rp with dot thousands", () => {
    expect(parseMoneyToNumber("Rp124.290")).toBe(124290);
    expect(parseMoneyToNumber("Rp 138.100")).toBe(138100);
  });
});

describe("parseReceiptFromMarkdownStyle", () => {
  it("extracts vendor, total, and item names from Workers-style markdown", () => {
    const text = `**Receipt Data Extraction** **Vendor:** Toko Gading Murni Putra **Receipt Date:** 04 Oct 2025, 11.26 **Currency:** IDR (Indonesian Rupiah) **Total:** Rp124,290 (tax-included total) **Category:** Shopping **Description:** Various household items **Items:** * **Meja Belajar Kotak S** * **V-TEC Sharpener**`;
    const r = parseReceiptFromMarkdownStyle(text);
    expect(r).not.toBeNull();
    expect(r!.vendor).toContain("Gading Murni");
    expect(r!.total).toBe(124290);
    expect(r!.currency).toBe("IDR");
    expect(r!.items.length).toBeGreaterThanOrEqual(1);
    expect(r!.items.some((i) => /Meja Belajar/i.test(i.name))).toBe(true);
  });

  it("parses bullet + bold label format and plain numeric total", () => {
    const text = `**Receipt Details** * **Vendor**: Toko Gading Murni Putra * **Receipt Date and Time**: 04 Oct 2025, 11.26 * **Currency**: IDR * **Total**: 124290 * **Category**: Shopping * **Description**: Office supplies * **Location**: Jl. Raya Kendangsari Industri No. 10 - Surabaya * **Items**`;
    const r = parseReceiptFromMarkdownStyle(text);
    expect(r).not.toBeNull();
    expect(r!.vendor).toContain("Gading Murni");
    expect(r!.total).toBe(124290);
    expect(r!.description).toContain("Office supplies");
    expect(r!.location?.label).toContain("Surabaya");
  });
});

describe("repairJsonText / tryParseReceiptJsonObject", () => {
  it("strips trailing commas before parse", () => {
    const raw = '{"a":1,"b":2,}';
    const repaired = repairJsonText(raw);
    expect(tryParseReceiptJsonObject(repaired)).toEqual({ a: 1, b: 2 });
  });
});

describe("parseReceiptModelText", () => {
  it("uses JSON when present", () => {
    const r = parseReceiptModelText('{"currency":"IDR","total":100,"items":[]}');
    expect(r.total).toBe(100);
    expect(r.currency).toBe("IDR");
  });

  it("falls back to markdown when no JSON", () => {
    const text =
      "**Vendor:** ACME **Total:** Rp1.000 **Currency:** IDR **Items:** * **Pen**";
    const r = parseReceiptModelText(text);
    expect(r.vendor).toContain("ACME");
    expect(r.total).toBe(1000);
  });
});

describe("normalizeParsed (Toko Gading Murni receipt expected shape)", () => {
  it("matches fixture totals and line items", () => {
    const expected = loadExpected();
    expect(expected.currency).toBe("IDR");
    expect(expected.total).toBe(124290);
    expect(expected.items).toHaveLength(5);
    expect(expected.items[0].lineTotal).toBe(88000);
    expect(expected.items[0].quantity).toBe(2);
    expect(expected.items[0].unitPrice).toBe(44000);
    expect(expected.vendor).toContain("Gading Murni");
    expect(expected.location?.label).toContain("Surabaya");
  });
});
