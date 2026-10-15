/**
 * run: npx tsx --tsconfig tsconfig.json src/service/meeting-service/config.test.ts
 */
import {
  meetingServicePublicUrl,
  notetakerProvider,
} from "./config";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const prev = {
  MEETING_SERVICE_PUBLIC_URL: process.env.MEETING_SERVICE_PUBLIC_URL,
  MEETING_SERVICE_ADDON_PUBLIC_URL: process.env.MEETING_SERVICE_ADDON_PUBLIC_URL,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  NOTETAKER_PROVIDER: process.env.NOTETAKER_PROVIDER,
  MEETING_SERVICE_URL: process.env.MEETING_SERVICE_URL,
  CRM_SERVICE_JWT_SECRET: process.env.CRM_SERVICE_JWT_SECRET,
};

process.env.MEETING_SERVICE_PUBLIC_URL = "https://rebuild-crm.worktual.com/";
process.env.MEETING_SERVICE_ADDON_PUBLIC_URL = "";
assert(
  meetingServicePublicUrl() === "https://rebuild-crm.worktual.com",
  "public URL should strip trailing slash",
);

process.env.MEETING_SERVICE_PUBLIC_URL = "";
process.env.FRONTEND_ORIGIN = "https://rebuild-crm.worktual.com/";
assert(
  meetingServicePublicUrl() === "https://rebuild-crm.worktual.com",
  "falls back to FRONTEND_ORIGIN",
);

process.env.NOTETAKER_PROVIDER = "vexa";
process.env.MEETING_SERVICE_URL = "http://meeting-service:8030";
process.env.CRM_SERVICE_JWT_SECRET = "secret";
assert(notetakerProvider() === "vexa", "vexa when meeting-service is configured");

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

restore("MEETING_SERVICE_PUBLIC_URL", prev.MEETING_SERVICE_PUBLIC_URL);
restore(
  "MEETING_SERVICE_ADDON_PUBLIC_URL",
  prev.MEETING_SERVICE_ADDON_PUBLIC_URL,
);
restore("FRONTEND_ORIGIN", prev.FRONTEND_ORIGIN);
restore("NOTETAKER_PROVIDER", prev.NOTETAKER_PROVIDER);
restore("MEETING_SERVICE_URL", prev.MEETING_SERVICE_URL);
restore("CRM_SERVICE_JWT_SECRET", prev.CRM_SERVICE_JWT_SECRET);

console.log("meeting-service config tests passed");
