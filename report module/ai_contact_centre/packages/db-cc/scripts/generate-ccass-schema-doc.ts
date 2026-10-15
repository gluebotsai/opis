/**
 * @deprecated Use generate-schema-docs.ts (writes docs/ccaas/CONTACT_CENTER_SCHEMA.md).
 * Kept for backward compatibility.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(import.meta.dirname, "generate-schema-docs.ts");
const result = spawnSync("npx", ["tsx", script], { stdio: "inherit", cwd: repoRoot });
process.exit(result.status ?? 1);
