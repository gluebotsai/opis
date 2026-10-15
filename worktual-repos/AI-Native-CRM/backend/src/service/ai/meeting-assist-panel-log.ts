/**
 * JSONL debug log for Meet Assist panel delivery (ingest → SSE → UI).
 * Files: backend/logs/meet-assist-panel-YYYY-MM-DD.log
 */
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");

function logPathForToday(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `meet-assist-panel-${day}.log`);
}

export function logMeetAssistPanel(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    });
    fs.appendFileSync(logPathForToday(), `${line}\n`, "utf8");
  } catch {
    /* never break request path */
  }
}
