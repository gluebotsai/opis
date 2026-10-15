import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * Both `src/config` and compiled `dist/config` are two levels below the
 * backend package root, so these paths are stable in development and builds.
 */
export const backendRoot = process.env.BACKEND_ROOT
  ? path.resolve(process.env.BACKEND_ROOT)
  : path.resolve(moduleDirectory, "../..");

export const workspaceRoot = path.resolve(backendRoot, "..");
export const databaseRoot = path.join(backendRoot, "database");
export const assetsRoot = path.join(backendRoot, "assets");
export const logsRoot = path.join(backendRoot, "logs");
export const dataRoot = path.join(backendRoot, "data");

export function resolveBackendPath(...segments: string[]): string {
  return path.join(backendRoot, ...segments);
}
