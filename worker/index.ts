/// <reference types="@cloudflare/workers-types" />

import { appendReceiptToSheet } from "./google-sheet";
import { sha256Hex } from "./hash";
import {
  buildGoogleAuthorizeUrl,
  createPkce,
  decodeIdToken,
  exchangeCodeForTokens
} from "./oauth-google";
import { parseReceiptWithAi } from "./receipt-ai";
import {
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
  getSessionFromRequest,
  type SessionUser
} from "./session";
import type { ParseResponse, ParsedReceipt, SubmitBody, SubmitResponse } from "./types";

export interface Env {
  AI: Ai;
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  AUTH_SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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

function redirect(location: string, setCookie?: string): Response {
  const h = new Headers();
  h.set("Location", location);
  if (setCookie) h.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers: h });
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

async function requireUser(request: Request, env: Env): Promise<SessionUser | Response> {
  const secret = env.AUTH_SESSION_SECRET;
  if (!secret) {
    return json({ error: "Server auth is not configured" }, { status: 503 });
  }
  const user = await getSessionFromRequest(request, secret);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return user;
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

async function duplicateStats(
  db: D1Database,
  userId: string,
  contentHash: string
): Promise<{ duplicateCount: number; totalReceipts: number }> {
  const dup = await db
    .prepare("SELECT COUNT(*) AS c FROM receipts WHERE user_id = ? AND content_hash = ?")
    .bind(userId, contentHash)
    .first<{ c: number }>();
  const tot = await db.prepare("SELECT COUNT(*) AS c FROM receipts WHERE user_id = ?").bind(userId).first<{ c: number }>();
  return {
    duplicateCount: dup?.c ?? 0,
    totalReceipts: tot?.c ?? 0
  };
}

function publicImageUrl(request: Request, key: string): string {
  const u = new URL(request.url);
  return `${u.origin}/api/receipt-image/${encodeURIComponent(key)}`;
}

async function pruneOAuthStates(db: D1Database): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  await db.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(cutoff).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const secure = isSecureRequest(request);

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const secret = env.AUTH_SESSION_SECRET;
      const oauthReady = Boolean(secret && env.GOOGLE_CLIENT_ID);
      if (!secret) return json({ user: null, authConfigured: false });
      const user = await getSessionFromRequest(request, secret);
      return json({ user, authConfigured: oauthReady });
    }

    if (url.pathname === "/api/auth/login" && request.method === "GET") {
      const clientId = env.GOOGLE_CLIENT_ID;
      const secret = env.AUTH_SESSION_SECRET;
      if (!clientId || !secret) {
        return json({ error: "Google OAuth is not configured on the server" }, { status: 503 });
      }
      await pruneOAuthStates(env.DB);
      const state = crypto.randomUUID();
      const { verifier, challenge } = await createPkce();
      await env.DB
        .prepare("INSERT INTO oauth_states (state, code_verifier, created_at) VALUES (?, ?, ?)")
        .bind(state, verifier, Math.floor(Date.now() / 1000))
        .run();
      const redirectUri = `${url.origin}/api/auth/callback`;
      const location = buildGoogleAuthorizeUrl({
        clientId,
        redirectUri,
        state,
        codeChallenge: challenge
      });
      return redirect(location);
    }

    if (url.pathname === "/api/auth/callback" && request.method === "GET") {
      const clientId = env.GOOGLE_CLIENT_ID;
      const clientSecret = env.GOOGLE_CLIENT_SECRET;
      const authSecret = env.AUTH_SESSION_SECRET;
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      const base = `${url.origin}/`;
      if (err) return redirect(`${base}?auth=error&reason=${encodeURIComponent(err)}`);
      if (!code || !state || !clientId || !clientSecret || !authSecret) {
        return redirect(`${base}?auth=error&reason=${encodeURIComponent("missing_params")}`);
      }
      const row = await env.DB.prepare("SELECT code_verifier FROM oauth_states WHERE state = ?").bind(state).first<{
        code_verifier: string;
      }>();
      await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
      if (!row?.code_verifier) {
        return redirect(`${base}?auth=error&reason=${encodeURIComponent("invalid_state")}`);
      }
      try {
        const redirectUri = `${url.origin}/api/auth/callback`;
        const { id_token } = await exchangeCodeForTokens({
          clientId,
          clientSecret,
          code,
          redirectUri,
          codeVerifier: row.code_verifier
        });
        const user = decodeIdToken(id_token, clientId);
        const cookie = await buildSetSessionCookieHeader(authSecret, user, secure);
        return redirect(base, cookie);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "oauth_failed";
        return redirect(`${base}?auth=error&reason=${encodeURIComponent(msg.slice(0, 120))}`);
      }
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const h = new Headers();
      h.set("Set-Cookie", buildClearSessionCookieHeader(secure));
      return json({ ok: true }, { headers: h });
    }

    if (url.pathname.startsWith("/api/receipt-image/")) {
      const key = decodeURIComponent(url.pathname.replace("/api/receipt-image/", ""));
      if (!key || key.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const auth = await requireUser(request, env);
      if (auth instanceof Response) return auth;
      const rec = await env.DB
        .prepare("SELECT image_r2_key FROM receipts WHERE image_r2_key = ? AND user_id = ? LIMIT 1")
        .bind(key, auth.sub)
        .first<{ image_r2_key: string }>();
      if (!rec) return new Response("Not found", { status: 404 });
      const obj = await env.RECEIPTS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
      headers.set("Content-Type", type);
      headers.set("Cache-Control", "private, max-age=3600");
      return new Response(obj.body, { headers });
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const auth = await requireUser(request, env);
      if (auth instanceof Response) return auth;
      const tot = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM receipts WHERE user_id = ?")
        .bind(auth.sub)
        .first<{ c: number }>();
      return json({ totalReceipts: tot?.c ?? 0 });
    }

    if (url.pathname === "/api/parse" && request.method === "POST") {
      const auth = await requireUser(request, env);
      if (auth instanceof Response) return auth;
      try {
        const { bytes, mime } = await readBodyImage(request);
        const contentHash = await sha256Hex(bytes);
        const { duplicateCount, totalReceipts } = await duplicateStats(env.DB, auth.sub, contentHash);
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
      const auth = await requireUser(request, env);
      if (auth instanceof Response) return auth;
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

        const { duplicateCount, totalReceipts } = await duplicateStats(env.DB, auth.sub, hash);
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
        const key = `receipts/${auth.sub}/${id}.${ext}`;
        await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: mime } });

        const imageUrl = publicImageUrl(request, key);
        const createdAt = new Date().toISOString();
        const receipt = body.receipt as ParsedReceipt;

        await env.DB
          .prepare(
            `INSERT INTO receipts (
              id, user_id, created_at, receipt_datetime, vendor, category, description, currency, total,
              items_json, location_json, image_r2_key, image_public_url, content_hash, raw_ai_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            auth.sub,
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
