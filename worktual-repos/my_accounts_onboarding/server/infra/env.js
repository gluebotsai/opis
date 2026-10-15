function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

export function isProduction() {
  return env("NODE_ENV") === "production";
}

export function getAppUrl() {
  return env("APP_URL") || "http://localhost:5173";
}

export function shouldRunMigrationsOnBoot() {
  if (env("SKIP_MIGRATE_ON_BOOT") === "true") {
    return false;
  }
  return true;
}

export function isRedisConfigured() {
  return Boolean(env("REDIS_URL"));
}

export function getRedisUrl() {
  return env("REDIS_URL");
}

export { env };
