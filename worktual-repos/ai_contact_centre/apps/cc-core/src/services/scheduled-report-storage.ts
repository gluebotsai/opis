import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_ROOT = resolve(process.cwd(), "uploads", "scheduled-reports");

/** Relative to {@link getScheduledReportsRoot}; mount NFS at the root path later without code changes. */
export function buildScheduledReportPdfStorageKey(
  organizationId: string,
  scheduleId: string,
  runId: string,
): string {
  return `${organizationId}/${scheduleId}/${runId}.pdf`;
}

export function getScheduledReportsRoot(): string {
  const configured = process.env.SCHEDULED_REPORTS_ROOT?.trim();
  if (!configured) return DEFAULT_ROOT;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function resolveScheduledReportPdfPath(storageKey: string): string {
  const trimmed = storageKey.trim();
  if (!trimmed) {
    throw new Error("Scheduled report pdf_path is empty");
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/^uploads\/scheduled-reports\/?/, "");
  return resolve(getScheduledReportsRoot(), normalized);
}

export async function writeScheduledReportPdf(storageKey: string, buffer: Buffer): Promise<void> {
  const absolutePath = resolveScheduledReportPdfPath(storageKey);
  await mkdir(dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, absolutePath);
}

export async function readScheduledReportPdf(storageKey: string): Promise<Buffer> {
  return readFile(resolveScheduledReportPdfPath(storageKey));
}
