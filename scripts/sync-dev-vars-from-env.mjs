/**
 * Reads root .env and writes .dev.vars with only Worker-relevant keys
 * (excludes CLOUDFLARE_* so API tokens are not injected into the local Worker).
 * Run before wrangler dev if you use a single .env file.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const outPath = join(root, ".dev.vars");

if (!existsSync(envPath)) {
  console.error("Missing .env — create from .env.example");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
const lines = raw.split(/\r?\n/);
const skip = (key) => key.startsWith("CLOUDFLARE_");

const out = [];
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith("#")) {
    out.push(line);
    continue;
  }
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  if (skip(key)) continue;
  out.push(line);
}

writeFileSync(outPath, out.filter((l, i, a) => !(l.trim() === "" && (a[i - 1]?.trim() === "" || i === 0))).join("\n").replace(/\n{3,}/g, "\n\n") + "\n", "utf8");
console.log("Wrote .dev.vars from .env (excluded CLOUDFLARE_*)");
