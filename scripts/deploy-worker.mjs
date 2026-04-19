/**
 * Deploy Worker. Target from ENV_MODE (set by dotenv -e .env or shell):
 *   development (default) → --env development (Worker scan-and-parse-dev)
 *   production             → --env production (Worker scan-and-parse-production)
 *
 * Top-level wrangler name is scan-and-parse (Cloudflare project consistency).
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function wranglerEnvFlag(mode) {
  const m = String(mode ?? "development").toLowerCase().trim();
  if (m === "production" || m === "prod") return ["--env", "production"];
  if (m === "development" || m === "dev" || m === "") return ["--env", "development"];
  console.error(`Unknown ENV_MODE="${mode}". Use development or production.`);
  process.exit(1);
  return [];
}

const mode = process.env.ENV_MODE || "development";
const extra = wranglerEnvFlag(mode);
const label =
  extra[1] === "production"
    ? "production (scan-and-parse-production)"
    : "development (scan-and-parse-dev)";
console.log(`Deploying: ${label} (ENV_MODE=${mode})`);

const r = spawnSync("npx", ["wrangler", "deploy", ...extra], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env }
});

process.exit(r.status ?? 1);
