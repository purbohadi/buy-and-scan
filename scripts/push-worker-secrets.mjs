/**
 * Push AUTH_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET from .env
 * to the Worker using wrangler secret put (non-interactive stdin).
 *
 * Usage:
 *   dotenv -e .env -- node scripts/push-worker-secrets.mjs           → default Worker (dev: scan-and-parse-dev)
 *   dotenv -e .env -- node scripts/push-worker-secrets.mjs --env production
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

const envIdx = process.argv.indexOf("--env");
const envFlag = envIdx !== -1 && process.argv[envIdx + 1] ? ["--env", process.argv[envIdx + 1]] : [];

function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const KEYS = ["AUTH_SESSION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

if (!existsSync(envPath)) {
  console.error("Missing .env — copy .env.example and fill Google + session secrets.");
  process.exit(1);
}

const vars = parseDotEnv(readFileSync(envPath, "utf8"));
let pushed = 0;

for (const key of KEYS) {
  const val = vars[key];
  if (!val || !String(val).trim()) {
    console.warn(`Skip ${key} (empty in .env)`);
    continue;
  }
  const r = spawnSync("npx", ["wrangler", "secret", "put", key, ...envFlag], {
    cwd: root,
    input: val,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env }
  });
  if (r.status !== 0) {
    console.error(`wrangler secret put ${key} failed with exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
  console.log(`Set secret: ${key}`);
  pushed++;
}

if (pushed === 0) {
  console.error("No secrets pushed — fill AUTH_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env");
  process.exit(1);
}
console.log(`Done (${pushed} secrets).`);
