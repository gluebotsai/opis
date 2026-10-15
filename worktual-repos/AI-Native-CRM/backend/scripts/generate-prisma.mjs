import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

execSync("npx prisma generate --schema=../prisma/schema.prisma", {
  cwd: backendRoot,
  stdio: "inherit",
  env: process.env,
});

const srcClient = path.join(repoRoot, "node_modules/@prisma/client");
const srcEngine = path.join(repoRoot, "node_modules/.prisma");
const destClient = path.join(backendRoot, "node_modules/@prisma/client");
const destEngine = path.join(backendRoot, "node_modules/.prisma");

fs.rmSync(destClient, { recursive: true, force: true });
fs.rmSync(destEngine, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destClient), { recursive: true });
fs.cpSync(srcClient, destClient, { recursive: true });
fs.cpSync(srcEngine, destEngine, { recursive: true });
console.log("Synced Prisma client into backend/node_modules");
