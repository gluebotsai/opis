import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the monorepo root `.env` into process.env.
 * Does not override variables already set (e.g. Docker Compose env_file).
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, "../..");

loadEnvFile(resolve(repoRoot, ".env"));

export const REPO_ROOT = repoRoot;
