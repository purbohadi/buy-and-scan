import type { SessionUser } from "./session";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToString(s: string): string {
  const pad = 4 - (s.length % 4);
  const b64 = (pad === 4 ? s : s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafeString(32);
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge };
}

/** Scopes for Sign-In + Drive (per-file) + Sheets API (user-owned spreadsheet). */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

export function buildGoogleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** If true, use prompt=consent to obtain a new refresh_token (Drive/Sheets link). */
  forceConsent: boolean;
}): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", params.clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", params.forceConsent ? "consent" : "select_account");
  return u.toString();
}

export function decodeIdToken(idToken: string, expectedAud: string): SessionUser {
  const parts = idToken.split(".");
  if (parts.length < 2) throw new Error("Invalid id_token");
  const payloadJson = base64UrlDecodeToString(parts[1]);
  const payload = JSON.parse(payloadJson) as {
    sub?: string;
    email?: string;
    aud?: string | string[];
    iss?: string;
    exp?: number;
  };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp != null && payload.exp < now - 60) {
    throw new Error("id_token expired");
  }
  const iss = payload.iss ?? "";
  if (!iss.includes("accounts.google.com") && !iss.includes("https://accounts.google.com")) {
    throw new Error("Invalid id_token issuer");
  }
  const aud = payload.aud;
  const audOk =
    aud === expectedAud || (Array.isArray(aud) && aud.includes(expectedAud));
  if (!audOk) throw new Error("Invalid id_token audience");
  if (!payload.sub) throw new Error("Missing sub in id_token");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
}
