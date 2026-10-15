import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELATIVE_ROOT = "Ticketing/attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const LOCAL_STORAGE_ROOT = fileURLToPath(new URL("../../../../storage/", import.meta.url));

function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return cleaned || fallback;
}

export function ticketingAttachmentsRoot(): string {
  const configured = process.env.TICKETING_ATTACHMENTS_ROOT?.trim();
  return configured ? path.resolve(configured) : LOCAL_STORAGE_ROOT;
}

export async function storeTicketingAttachment(input: {
  organizationId: string;
  threadId: string;
  messageId: string;
  attachmentIndex: number;
  fileName: string;
  content: Buffer;
}): Promise<string | null> {
  const root = ticketingAttachmentsRoot();
  if (!root) return null;
  if (input.content.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  const relativePath = path.posix.join(
    RELATIVE_ROOT,
    safeSegment(input.organizationId, "organization"),
    safeSegment(input.threadId, "thread"),
    safeSegment(input.messageId, "message"),
    `${input.attachmentIndex + 1}-${safeSegment(path.basename(input.fileName), "attachment")}`,
  );
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Attachment path escapes configured storage root");
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, input.content, { flag: "wx" });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return relativePath;
}
