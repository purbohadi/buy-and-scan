import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractJsonObject, normalizeParsed } from "../worker/receipt-shared";
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
