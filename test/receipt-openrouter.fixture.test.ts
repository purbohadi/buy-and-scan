/**
 * Optional integration test: reads `test/fixtures/receipt-toko-gading-murni.jpg`
 * (add your receipt photo with that name) and calls OpenRouter vision.
 *
 * Run with: OPENROUTER_API_KEY=... npm test -- test/receipt-openrouter.fixture.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseReceiptWithExternalProvider } from "../worker/receipt-openai";
import { normalizeParsed } from "../worker/receipt-shared";
import type { ParsedReceipt } from "../worker/types";

const FIXTURE_JPG = join(process.cwd(), "test", "fixtures", "receipt-toko-gading-murni.jpg");
const EXPECTED_JSON = join(process.cwd(), "test", "fixtures", "receipt-toko-gading-murni-expected.json");

function loadExpected(): ParsedReceipt {
  const raw = readFileSync(EXPECTED_JSON, "utf8");
  return normalizeParsed(JSON.parse(raw) as Record<string, unknown>);
}

describe("OpenRouter vision (receipt fixture image)", () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const hasImage = existsSync(FIXTURE_JPG);
  const run = hasImage && apiKey ? it : it.skip;

  run(
    "parses receipt-toko-gading-murni.jpg (add file + OPENROUTER_API_KEY) into structured receipt",
    async () => {
      const bytes = new Uint8Array(readFileSync(FIXTURE_JPG));
      const expected = loadExpected();

      const draft = await parseReceiptWithExternalProvider(
        {
          OPENROUTER_API_KEY: apiKey!,
          OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
          RECEIPT_VISION_MODEL: process.env.RECEIPT_VISION_MODEL
        },
        bytes,
        "image/jpeg",
        "openrouter"
      );

      expect(draft.currency.toUpperCase()).toMatch(/IDR|RP/);
      expect(draft.items.length).toBeGreaterThanOrEqual(3);
      expect(draft.total).toBeGreaterThan(100000);
      expect(draft.total).toBeLessThan(200000);

      const byName = (n: string) => draft.items.find((i) => i.name.toUpperCase().includes(n.toUpperCase()));
      expect(byName("MEJA") ?? byName("BELAJAR")).toBeDefined();
      expect(byName("SHARPENER") ?? byName("V-TEC")).toBeDefined();

      expect(Math.abs(draft.total - expected.total)).toBeLessThan(500);
    },
    60_000
  );
});
