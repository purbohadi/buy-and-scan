/// <reference types="@cloudflare/workers-types" />

import { sha256Hex } from "./hash";
import { appendReceiptToSheet } from "./google-sheet";
import { parseReceiptWithAi } from "./receipt-ai";
import type { ParseResponse, ParsedReceipt, SubmitBody, SubmitResponse } from "./types";

export interface Env {
  AI: Ai;
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_APPS_SCRIPT_URL?: string;
  GOOGLE_APPS_SCRIPT_SECRET?: string;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {})
    }
  });
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

async function readBodyImage(request: Request): Promise<{ bytes: Uint8Array; mime: string }> {
  const ct = request.headers.get("Content-Type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("image");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const blob = file as Blob;
      const ab = await blob.arrayBuffer();
      return { bytes: new Uint8Array(ab), mime: blob.type || "image/jpeg" };
    }
    throw new Error('Expected multipart field "image"');
  }
  const body = (await request.json()) as { imageBase64?: string; imageMime?: string };
  if (!body.imageBase64) throw new Error("imageBase64 required");
  const mime = body.imageMime ?? "image/jpeg";
  const raw = atob(body.imageBase64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

async function duplicateStats(db: D1Database, contentHash: string): Promise<{ duplicateCount: number; totalReceipts: number }> {
  const dup = await db
    .prepare("SELECT COUNT(*) AS c FROM receipts WHERE content_hash = ?")
    .bind(contentHash)
    .first<{ c: number }>();
  const tot = await db.prepare("SELECT COUNT(*) AS c FROM receipts").first<{ c: number }>();
  return {
    duplicateCount: dup?.c ?? 0,
    totalReceipts: tot?.c ?? 0
  };
}

function publicImageUrl(request: Request, key: string): string {
  const u = new URL(request.url);
  return `${u.origin}/api/receipt-image/${encodeURIComponent(key)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/receipt-image/")) {
      const key = decodeURIComponent(url.pathname.replace("/api/receipt-image/", ""));
      if (!key || key.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const obj = await env.RECEIPTS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
      headers.set("Content-Type", type);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const tot = await env.DB.prepare("SELECT COUNT(*) AS c FROM receipts").first<{ c: number }>();
      return json({ totalReceipts: tot?.c ?? 0 });
    }

    if (url.pathname === "/api/parse" && request.method === "POST") {
      try {
        const { bytes, mime } = await readBodyImage(request);
        const contentHash = await sha256Hex(bytes);
        const { duplicateCount, totalReceipts } = await duplicateStats(env.DB, contentHash);
        const draft = await parseReceiptWithAi(env.AI, bytes, mime);
        const body: ParseResponse = {
          draft,
          contentHash,
          duplicate: duplicateCount > 0,
          duplicateCount,
          totalReceipts
        };
        return json(body);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Parse failed";
        return json({ error: message }, { status: 400 });
      }
    }

    if (url.pathname === "/api/submit" && request.method === "POST") {
      try {
        const body = (await request.json()) as SubmitBody;
        if (!body.contentHash || !body.imageBase64 || !body.receipt) {
          return json({ error: "contentHash, imageBase64, and receipt are required" }, { status: 400 });
        }

        const raw = atob(body.imageBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

        const hash = await sha256Hex(bytes);
        if (hash !== body.contentHash) {
          return json({ error: "contentHash does not match image bytes" }, { status: 400 });
        }

        const { duplicateCount, totalReceipts } = await duplicateStats(env.DB, hash);
        if (duplicateCount > 0 && !body.confirmDuplicate) {
          const res: SubmitResponse = {
            ok: false,
            id: "",
            imageUrl: "",
            totalReceipts,
            duplicateBlocked: true,
            duplicateCount
          };
          return json(res, { status: 409 });
        }

        const id = crypto.randomUUID();
        const mime = body.imageMime ?? "image/jpeg";
        const ext = extFromMime(mime);
        const key = `receipts/${id}.${ext}`;
        await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: mime } });

        const imageUrl = publicImageUrl(request, key);
        const createdAt = new Date().toISOString();
        const receipt = body.receipt as ParsedReceipt;

        await env.DB
          .prepare(
            `INSERT INTO receipts (
              id, created_at, receipt_datetime, vendor, category, description, currency, total,
              items_json, location_json, image_r2_key, image_public_url, content_hash, raw_ai_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            createdAt,
            receipt.receiptDatetime ?? null,
            receipt.vendor ?? null,
            receipt.category ?? null,
            receipt.description ?? null,
            receipt.currency,
            receipt.total,
            JSON.stringify(receipt.items),
            receipt.location ? JSON.stringify(receipt.location) : null,
            key,
            imageUrl,
            hash,
            null
          )
          .run();

        const newTotal = totalReceipts + 1;

        const sheetResult = await appendReceiptToSheet({
          appsScriptUrl: env.GOOGLE_APPS_SCRIPT_URL,
          appsScriptSecret: env.GOOGLE_APPS_SCRIPT_SECRET,
          rowNumber: newTotal,
          id,
          createdAtIso: createdAt,
          receipt,
          imagePublicUrl: imageUrl
        });

        const res: SubmitResponse = {
          ok: true,
          id,
          imageUrl,
          totalReceipts: newTotal,
          sheetsAppended: sheetResult.ok,
          sheetsError: sheetResult.ok ? undefined : sheetResult.error
        };
        return json(res);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Submit failed";
        return json({ error: message }, { status: 400 });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
