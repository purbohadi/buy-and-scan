/**
 * Push secrets from .env using wrangler secret put. Target Worker is chosen by ENV_MODE:
 *   development (default) → --env development (scan-and-parse-dev)
 *   production             → --env production (scan-and-parse-production)
 *
 * Always (when non-empty): AUTH_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * Optional AI keys (when non-empty): OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
 *
 * Usage: dotenv -e .env -- node scripts/push-worker-secrets.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

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

function wranglerEnvFlag(mode) {
  const m = String(mode ?? "development").toLowerCase().trim();
  if (m === "production" || m === "prod") return ["--env", "production"];
  if (m === "development" || m === "dev" || m === "") return ["--env", "development"];
  console.error(`Unknown ENV_MODE="${mode}". Use development or production.`);
  process.exit(1);
  return [];
}

const KEYS = [
  "AUTH_SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY"
];

if (!existsSync(envPath)) {
  console.error("Missing .env — copy .env.example and fill Google + session secrets.");
  process.exit(1);
}

const vars = parseDotEnv(readFileSync(envPath, "utf8"));
const envFlag = wranglerEnvFlag(vars.ENV_MODE);
const modeLabel = envFlag[1] === "production" ? "production" : "development";
console.log(`Pushing secrets to ${modeLabel} Worker…`);

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
  console.error(
    "No secrets pushed — set at least one of: AUTH_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY in .env"
  );
  process.exit(1);
}
console.log(`Done (${pushed} secrets).`);
