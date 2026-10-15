import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pino, { type Logger } from "pino";

export interface LogContext {
  service: string;
  trace_id?: string;
  tenant_id?: string;
}

export function createLogger(context: LogContext): Logger {
  const isDev = process.env.NODE_ENV !== "production";
  const level = process.env.LOG_LEVEL ?? "info";
  const logFile = process.env.LOG_FILE;

  const baseOptions = {
    level,
    base: {
      service: context.service,
      ...(context.trace_id ? { trace_id: context.trace_id } : {}),
      ...(context.tenant_id ? { tenant_id: context.tenant_id } : {}),
    },
  };

  if (!logFile) {
    return pino({
      ...baseOptions,
      ...(isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
            },
          }
        : {}),
    });
  }

  mkdirSync(dirname(logFile), { recursive: true });

  const streams: pino.StreamEntry[] = [
    {
      level: level as pino.Level,
      stream: isDev
        ? pino.transport({
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          })
        : process.stdout,
    },
    {
      level: level as pino.Level,
      stream: pino.destination({ dest: logFile, mkdir: true, sync: false }),
    },
  ];

  return pino(baseOptions, pino.multistream(streams));
}

export function createTraceId(): string {
  return randomUUID();
}

export {
  createEmailProcessLog,
  EmailProcessLog,
  type EmailProcessLogInput,
} from "./email-process-log.js";

export const TRACE_HEADER = "x-trace-id";
export const TENANT_HEADER = "x-tenant-id";
