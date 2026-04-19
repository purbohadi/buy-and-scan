/// <reference types="@cloudflare/workers-types" />

type EnvWithAssets = { ASSETS: Fetcher };

/**
 * Clean URLs for OAuth / Google crawlers: /privacy and /terms (no .html).
 * Redirects /privacy.html and /terms.html to canonical paths.
 */
export async function tryServeLegalPage(
  env: EnvWithAssets,
  request: Request,
  pathname: string
): Promise<Response | null> {
  if (pathname === "/privacy.html") {
    return Response.redirect(new URL("/privacy", request.url).toString(), 308);
  }
  if (pathname === "/terms.html") {
    return Response.redirect(new URL("/terms", request.url).toString(), 308);
  }

  let assetPath: string | null = null;
  let canonical: string | null = null;
  if (pathname === "/privacy") {
    assetPath = "/privacy.html";
    canonical = "/privacy";
  } else if (pathname === "/terms") {
    assetPath = "/terms.html";
    canonical = "/terms";
  }
  if (!assetPath || !canonical) return null;

  const assetUrl = new URL(assetPath, request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!res.ok) return null;

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=600");
  headers.set("Link", `<${new URL(canonical, request.url).toString()}>; rel="canonical"`);
  return new Response(res.body, { status: 200, headers });
}
