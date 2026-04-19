/** Encrypt/decrypt refresh tokens at rest using AUTH_SESSION_SECRET (AES-256-GCM). */

async function deriveKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < combined.length; i += chunk) {
    binary += String.fromCharCode(...combined.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function decryptToken(secret: string, payload: string): Promise<string | null> {
  try {
    const key = await deriveKey(secret);
    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    if (raw.length < 13) return null;
    const iv = raw.subarray(0, 12);
    const data = raw.subarray(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
