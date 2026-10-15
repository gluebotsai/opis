import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value: any) => value === "true");

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    DATABASE_SSL: booleanFromString,
    REDIS_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default("my-accounts-api"),
    JWT_AUDIENCE: z.string().default("my-accounts"),
    TRUST_PROXY: booleanFromString,
    SWAGGER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value: any) => value === "true"),
    SOCKET_IO_PATH: z.string().default("/socket.io"),
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map(
        (issue: any) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  return result.data;
}
