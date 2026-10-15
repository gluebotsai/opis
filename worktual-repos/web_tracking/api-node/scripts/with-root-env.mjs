#!/usr/bin/env node
/** Load repo-root .env and run a command with a resolved DATABASE_URL. */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "..");

config({ path: resolve(repoRoot, ".env") });

function resolveDatabaseUrl() {
  const user = process.env.DB_USER ?? "analytics_user";
  const password = process.env.DB_PASSWORD ?? "";
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "web_analytics";
  const schema = process.env.DB_SCHEMA;
  const schemaSuffix = schema ? `?schema=${encodeURIComponent(schema)}` : "";

  if (process.env.DB_HOST || process.env.DB_PASSWORD) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}${schemaSuffix}`;
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}${schemaSuffix}`;
}

process.env.DATABASE_URL = resolveDatabaseUrl();

function isPostgresReadOnly() {
  const value = process.env.POSTGRES_READ_ONLY ?? "true";
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: with-root-env.mjs <command> [args...]");
  process.exit(1);
}

const joined = [command, ...args].join(" ");
if (isPostgresReadOnly() && /\b(migrate|db push)\b/.test(joined)) {
  console.error(
    "Blocked: POSTGRES_READ_ONLY=true — do not run prisma migrate or db push against the live auth database.",
  );
  process.exit(1);
}

const result = spawnSync(command, args, {
  cwd: apiRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
