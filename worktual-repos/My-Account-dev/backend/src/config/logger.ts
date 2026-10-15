import type { LoggerOptions } from "pino";
import type { AppEnv } from "./env.js";

export function loggerOptions(env: AppEnv): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: { service: "my-accounts-api", environment: env.NODE_ENV },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "*.password",
        "token",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, singleLine: true },
          },
        }
      : {}),
  };
}
