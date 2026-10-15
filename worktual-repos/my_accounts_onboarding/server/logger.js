import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.APP_LOG_DIR || path.join(__dirname, "..", "logs");

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFilePath(channel) {
  return path.join(LOG_DIR, `${channel}.log`);
}

function writeLogLine(channel, entry) {
  try {
    ensureLogDir();
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      channel,
      ...entry,
    })}\n`;
    fs.appendFileSync(logFilePath(channel), line, "utf8");
  } catch (error) {
    console.error(
      `[logger] Could not write ${channel} log:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export function logPayment(action, details = {}) {
  const entry = { action, ...details };
  writeLogLine("payments", entry);
  console.log(`[payments] ${action}`, details.quotationId || details.message || "");
}

export function logPaymentError(action, error, details = {}) {
  const message = error instanceof Error ? error.message : String(error);
  logPayment(action, {
    ...details,
    level: "error",
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
