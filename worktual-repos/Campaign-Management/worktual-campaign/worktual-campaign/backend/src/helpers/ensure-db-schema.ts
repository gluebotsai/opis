/**
 * Verify Prisma client + DB schema are aligned for Template Gallery (fields column).
 * Runs migrate deploy in dev when enabled; fails fast with a clear message otherwise.
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../plugins/prisma.js";

let checked = false;

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function isDbUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("P1001") ||
    msg.includes("Can't reach database server") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function ensureDbSchemaReady(log?: {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}): Promise<void> {
  if (checked) return;
  checked = true;

  const autoMigrate =
    process.env.RUN_DB_MIGRATE === "1" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.GALLERY_AUTO_MIGRATE !== "false");

  if (autoMigrate) {
    try {
      // migrate only — do NOT prisma generate here: it rewrites
      // node_modules/.prisma and makes tsx watch restart in a loop.
      execSync("npx prisma migrate deploy", {
        cwd: backendRoot,
        stdio: "pipe",
        env: process.env,
      });
      log?.info({}, "Database migrations applied");
    } catch (err) {
      log?.warn({ err }, "Auto migrate skipped or failed — continuing");
    }
  }

  const attempts = 5;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await prisma.$queryRaw`
        SELECT fields FROM campaign_library_templates LIMIT 0
      `;
      log?.info(
        {},
        "Template Gallery schema OK (campaign_library_templates.fields)",
      );
      return;
    } catch (err) {
      lastErr = err;
      if (isDbUnreachable(err) && i < attempts) {
        const waitMs = 500 * i;
        log?.warn(
          { attempt: i, waitMs },
          "Database unreachable during schema check — retrying",
        );
        await sleep(waitMs);
        continue;
      }
      break;
    }
  }

  if (isDbUnreachable(lastErr)) {
    const message =
      "Cannot reach the campaign database (Postgres). " +
      "Check VPN/network and DATABASE_URL, then restart the backend.";
    log?.error({ err: lastErr }, message);
    throw new Error(message);
  }

  const message =
    "Template Gallery requires campaign_library_templates.fields. " +
    "Run: cd backend && npm run db:deploy && npm run db:generate";
  log?.error({ err: lastErr }, message);
  throw new Error(message);
}
