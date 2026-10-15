/**
 * On-disk storage for proposal corpus PDFs / requirement docs.
 * Default: ./data/proposal-corpus/{orgId}/…
 */

import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function localCorpusFallback(): string {
  return path.resolve(process.cwd(), "data", "proposal-corpus");
}

function canCreateDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Docker images use /app/... — that path is not writable on a host checkout.
 */
export function corpusStorageRoot(): string {
  const fallback = localCorpusFallback();
  const raw = (process.env.CORPUS_STORAGE_DIR || "").trim();
  const resolved = raw ? path.resolve(raw) : fallback;
  if (canCreateDir(resolved)) return resolved;
  if (resolved !== fallback && canCreateDir(fallback)) {
    console.warn(
      `[proposal-corpus] CORPUS_STORAGE_DIR is not writable (${resolved}); using ${fallback}`,
    );
    return fallback;
  }
  return fallback;
}

export function orgCorpusDir(organizationId: string | bigint): string {
  return path.join(corpusStorageRoot(), String(organizationId));
}

export type StoredCorpusFile = {
  storagePath: string;
  absolutePath: string;
  sha256: string;
  byteLength: number;
};

export async function storeCorpusFile(input: {
  organizationId: string | bigint;
  batchId: string;
  itemId: string;
  filename: string;
  buffer: Buffer;
}): Promise<StoredCorpusFile> {
  if (input.buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("File must be 8 MB or smaller.");
  }
  const ext = path.extname(input.filename || "").toLowerCase() || ".bin";
  const dir = path.join(orgCorpusDir(input.organizationId), input.batchId);
  await mkdir(dir, { recursive: true });
  const safeName = `${input.itemId}${ext}`;
  const absolutePath = path.join(dir, safeName);
  await writeFile(absolutePath, input.buffer);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storagePath = path.relative(corpusStorageRoot(), absolutePath);
  return {
    storagePath,
    absolutePath,
    sha256,
    byteLength: input.buffer.byteLength,
  };
}

export async function readCorpusFile(
  storagePath: string,
): Promise<Buffer> {
  const absolute = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(corpusStorageRoot(), storagePath);
  return readFile(absolute);
}

export async function removeCorpusBatchDir(input: {
  organizationId: string | bigint;
  batchId: string;
}): Promise<void> {
  const dir = path.join(
    orgCorpusDir(input.organizationId),
    input.batchId,
  );
  await rm(dir, { recursive: true, force: true });
}

export function resolveCorpusAbsolutePath(storagePath: string): string {
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.join(corpusStorageRoot(), storagePath);
}

export async function corpusFileExists(storagePath: string): Promise<boolean> {
  if (!storagePath || storagePath === "pending") return false;
  try {
    await access(resolveCorpusAbsolutePath(storagePath));
    return true;
  } catch {
    return false;
  }
}

export { MAX_FILE_BYTES as CORPUS_MAX_FILE_BYTES };
