const COOKIE = "sp_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

export type SessionUser = {
  sub: string;
  email: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = 4 - (s.length % 4);
  const b64 = (pad === 4 ? s : s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret: string, user: SessionUser, nowSec: number): Promise<string> {
  const exp = nowSec + MAX_AGE_SEC;
  const payload = JSON.stringify({ sub: user.sub, email: user.email, exp });
  const msg = base64UrlEncode(new TextEncoder().encode(payload));
  const sigBytes = await hmacSha256(secret, msg);
  const sig = base64UrlEncode(sigBytes);
  return `${msg}.${sig}`;
}

export async function verifySession(secret: string, token: string, nowSec: number): Promise<SessionUser | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const msg = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = base64UrlEncode(await hmacSha256(secret, msg));
  if (!timingSafeEqual(sig, expected)) return null;
  let payload: { sub?: string; email?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(msg))) as typeof payload;
  } catch {
    return null;
  }
  if (!payload.sub || typeof payload.exp !== "number" || payload.exp < nowSec) return null;
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=").trim());
  }
  return out;
}

export async function getSessionFromRequest(request: Request, secret: string | undefined): Promise<SessionUser | null> {
  if (!secret) return null;
  const raw = parseCookies(request.headers.get("Cookie"))[COOKIE];
  if (!raw) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  return verifySession(secret, raw, nowSec);
}

export async function buildSetSessionCookieHeader(secret: string, user: SessionUser, secure: boolean): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const value = await signSession(secret, user, nowSec);
  const flags = [`Path=/`, `Max-Age=${MAX_AGE_SEC}`, "HttpOnly", "SameSite=Lax"];
  if (secure) flags.push("Secure");
  return `${COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

export function buildClearSessionCookieHeader(secure: boolean): string {
  const flags = ["Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (secure) flags.push("Secure");
  return `${COOKIE}=; ${flags.join("; ")}`;
}
