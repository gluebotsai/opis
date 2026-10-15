import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(MODULE_DIR, "../../../..");
const DEFAULT_ROOT = resolve(MONOREPO_ROOT, "uploads", "internal-chat");

export function getInternalChatUploadRoot(): string {
  const configured =
    process.env.INTERNAL_CHAT_NFS_PATH?.trim() ||
    process.env.INTERNAL_CHAT_UPLOAD_ROOT?.trim();
  if (!configured) return DEFAULT_ROOT;
  return isAbsolute(configured) ? configured : resolve(MONOREPO_ROOT, configured);
}

export async function ensureInternalChatUploadRoot(): Promise<string> {
  const root = getInternalChatUploadRoot();
  await mkdir(root, { recursive: true });
  return root;
}

export function buildInternalChatStorageKey(
  organizationId: string,
  roomId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "file";
  return `${organizationId}/${roomId}/${randomUUID()}/${safeName}`;
}

export function resolveInternalChatFilePath(storageKey: string): string {
  const trimmed = storageKey.trim();
  if (!trimmed) {
    throw new Error("Internal chat storage key is empty");
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/^uploads\/internal-chat\/?/, "");
  return resolve(getInternalChatUploadRoot(), normalized);
}

export async function writeInternalChatFile(storageKey: string, buffer: Buffer): Promise<void> {
  const absolutePath = resolveInternalChatFilePath(storageKey);
  await mkdir(dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, absolutePath);
}

export async function readInternalChatFile(storageKey: string): Promise<Buffer> {
  return readFile(resolveInternalChatFilePath(storageKey));
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function guessInternalChatContentType(fileNameOrKey: string): string {
  const ext = fileNameOrKey.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "webm":
      return "audio/webm";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}
