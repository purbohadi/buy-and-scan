/// <reference types="@cloudflare/workers-types" />

type EnvWithAssets = { ASSETS: Fetcher };

/**
 * Privacy / terms: always return 200 + text/html for both /privacy and /privacy.html
 * (Google OAuth verification often fails if the policy URL redirects only).
 */
export async function tryServeLegalPage(
  env: EnvWithAssets,
  request: Request,
  pathname: string
): Promise<Response | null> {
  let assetPath: string | null = null;
  let canonicalPath: string | null = null;

  if (pathname === "/privacy" || pathname === "/privacy.html") {
    assetPath = "/privacy.html";
    canonicalPath = "/privacy";
  } else if (pathname === "/terms" || pathname === "/terms.html") {
    assetPath = "/terms.html";
    canonicalPath = "/terms";
  }
  if (!assetPath || !canonicalPath) return null;

  const assetUrl = new URL(assetPath, request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!res.ok) return null;

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=600");
  headers.set("Link", `<${new URL(canonicalPath, request.url).toString()}>; rel="canonical"`);
  return new Response(res.body, { status: 200, headers });
}
