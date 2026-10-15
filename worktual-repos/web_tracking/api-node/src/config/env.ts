import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

function resolveDatabaseUrl(): string {
  const user = process.env.DB_USER ?? "analytics_user";
  const password = process.env.DB_PASSWORD ?? "";
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "web_analytics";
  const schema = process.env.DB_SCHEMA;
  const schemaSuffix = schema ? `?schema=${encodeURIComponent(schema)}` : "";

  // Prefer discrete DB_* vars so passwords with @, :, etc. are not misparsed in URLs.
  if (process.env.DB_HOST || process.env.DB_PASSWORD) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}${schemaSuffix}`;
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}${schemaSuffix}`;
}

function resolveAuthSource(): "my_accounts" | "legacy_admin" {
  const raw = process.env.AUTH_SOURCE?.trim().toLowerCase();
  if (raw === "legacy_admin" || raw === "my_accounts") {
    return raw;
  }
  const dbName = process.env.DB_NAME ?? "";
  const schema = process.env.DB_SCHEMA ?? "";
  if (dbName.includes("worktual_bigint") || schema === "accounts") {
    return "my_accounts";
  }
  return "legacy_admin";
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(7861),
  SERVICE_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default(resolveDatabaseUrl()),
  AUTH_SOURCE: z.enum(["my_accounts", "legacy_admin"]).default(resolveAuthSource()),
  POSTGRES_READ_ONLY: z
    .enum(["true", "false", "1", "0", "yes", "no", "on", "off"])
    .default("true"),
  CLICKHOUSE_HOST: z.string().default("localhost"),
  CLICKHOUSE_PORT: z.coerce.number().default(8123),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  CLICKHOUSE_DATABASE: z.string().default("web_tracking"),
  API_SECRET_KEY: z.string().min(1).default("dev-secret-key"),
  JWT_ALGORITHM: z.string().default("HS256"),
  JWT_EXPIRE_MINUTES: z.coerce.number().default(480),
  CORS_ORIGINS: z.string().default("http://localhost:7862"),
  REDIS_URL: z.string().optional(),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().default(120),
  LIVE_PRESENCE_TTL_SECONDS: z.coerce.number().default(300),
  INGEST_PUBLIC_URL: z.string().optional(),
  SDK_PUBLIC_URL: z.string().optional(),
  /** Full script src URL; overrides SDK_PUBLIC_URL + /webtracking.min.js in admin snippet */
  SDK_SCRIPT_URL: z.string().optional(),
  INGEST_PORT: z.coerce.number().default(7860),
  SDK_PORT: z.coerce.number().default(7864),
  INSIGHTS_INTERNAL_KEY: z.string().optional(),
  AI_CHAT_INSIGHTS_URL: z.string().default("http://127.0.0.1:7863/insights/generate"),
  INSIGHTS_CACHE_TTL_SECONDS: z.coerce.number().default(600),
  /** My Accounts mint auth for POST /api/auth/onboarding/redirect (header: x-internal-service-key) */
  INTERNAL_SERVICE_KEY: z.string().optional(),
  /** Dashboard origin for onboarding redirect_url (e.g. https://qatracking.worktual.com) */
  DASHBOARD_PUBLIC_URL: z.string().optional(),
  ONBOARDING_CODE_TTL_SECONDS: z.coerce.number().default(600),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

export function corsOrigins(): string[] {
  return env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
}
