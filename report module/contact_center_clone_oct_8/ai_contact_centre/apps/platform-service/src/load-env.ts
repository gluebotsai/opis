import "@ai-contact-center/config/load-root-env";

if (!process.env.API_V1_PUBLIC_BASE?.trim() && process.env.PLATFORM_API_V1_PUBLIC_BASE?.trim()) {
  process.env.API_V1_PUBLIC_BASE = process.env.PLATFORM_API_V1_PUBLIC_BASE.trim();
}

const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL?.trim();
if (platformDatabaseUrl) {
  process.env.DATABASE_URL = platformDatabaseUrl;
}
