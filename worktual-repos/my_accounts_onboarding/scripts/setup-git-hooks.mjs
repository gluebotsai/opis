import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = path.join(projectRoot, ".githooks");
const hookFile = path.join(hooksDir, "post-commit");

if (!fs.existsSync(hookFile)) {
  console.error("Missing .githooks/post-commit");
  process.exit(1);
}

fs.chmodSync(hookFile, 0o755);

execSync("git config core.hooksPath .githooks", { cwd: projectRoot, stdio: "inherit" });
console.log("Git hooks installed: core.hooksPath=.githooks");
