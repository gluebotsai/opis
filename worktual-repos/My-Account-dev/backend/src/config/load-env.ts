import dotenv from "dotenv";

import { resolveBackendPath } from "./runtime-paths.js";

dotenv.config({ path: resolveBackendPath(".env") });

// Smoke scripts use synthetic GSTINs; skip remote registry checks unless explicitly enabled.
const entryScript = String(process.argv[1] || "");
if (entryScript.includes("smoke-test") && process.env.SKIP_GSTIN_REMOTE_CHECK == null) {
  process.env.SKIP_GSTIN_REMOTE_CHECK = "true";
}