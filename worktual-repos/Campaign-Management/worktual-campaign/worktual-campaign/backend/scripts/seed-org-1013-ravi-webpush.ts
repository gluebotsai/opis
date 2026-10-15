/**
 * One-off QA seed: org 1013 + ravi1234@gmail.com web push destination.
 * - CDP contact in org 1013
 * - website_contacts + push_endpoints (subscription copied from org 1012 row for same email)
 * - push_channel_settings web_push ready (VAPID from Accounts org 1012 when 1013 has none)
 *
 * Usage: npx tsx scripts/seed-org-1013-ravi-webpush.ts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/plugins/prisma.js";
import { ensureCampaignAccessForOrganization } from "../src/dao/entitlements.js";
import {
  createContactForIntegrationDao,
  findContactsByIdentityDao,
} from "../src/dao/contact.js";
import { upsertPushEndpointDao } from "../src/dao/push-endpoints.js";
import { toStableDbId } from "../src/helpers/id-schema.js";
import {
  mapWebPushCredentials,
  webPushSendReady,
} from "../src/services/accounts-campaign-channels.js";

const ORG = "1013";
const VAPID_SOURCE_ORG = "1012";
const EMAIL = "ravi1234@gmail.com";

async function fetchAccountsWebVapid(
  organizationId: string,
): Promise<Record<string, string> | null> {
  const base = String(process.env.ACCOUNTS_API_BASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.INTERNAL_SERVICE_KEY || "").trim();
  const token = String(process.env.PRODUCT_MCP_CONNECTORS_TOKEN || "").trim();
  if (!base) return null;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["x-internal-service-key"] = key;
  if (token) headers["x-product-mcp-token"] = token;

  const url = `${base}/api/v1/internal/campaign-channels/web-push/credentials?organization_id=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const payload = (await res.json()) as Record<string, unknown>;
  const wrapped = payload.credentials;
  const creds =
    wrapped && typeof wrapped === "object"
      ? (wrapped as Record<string, unknown>)
      : payload;
  const mapped = mapWebPushCredentials(creds);
  return webPushSendReady(mapped) ? mapped : null;
}

async function ensureLocalWebVapid(session: {
  organizationId: string;
  branchId: string;
  id: string;
}) {
  const existing = await prisma.pushChannelSettings.findUnique({
    where: {
      organizationId_channel: {
        organizationId: session.organizationId,
        channel: "web_push",
      },
    },
  });
  const current =
    existing?.settings && typeof existing.settings === "object"
      ? (existing.settings as Record<string, string>)
      : {};
  if (webPushSendReady(current)) return;

  const fromAccounts =
    (await fetchAccountsWebVapid(ORG)) ||
    (await fetchAccountsWebVapid(VAPID_SOURCE_ORG));
  if (!fromAccounts) {
    throw new Error(
      "No VAPID for org 1013 or 1012 from Accounts — configure Web Push in My Accounts for 1013 first.",
    );
  }

  const settings: Record<string, string> = {
    ...fromAccounts,
    site_origin:
      fromAccounts.site_origin ||
      String(process.env.NEXT_PUBLIC_APP_URL || "https://rebuild-campaign.worktual.com")
        .replace(/\/$/, "")
        .toLowerCase(),
  };
  const status = webPushSendReady(settings) ? "ready" : "in_progress";
  await prisma.pushChannelSettings.upsert({
    where: {
      organizationId_channel: {
        organizationId: session.organizationId,
        channel: "web_push",
      },
    },
    create: {
      organizationId: session.organizationId,
      channel: "web_push",
      settings: settings as Prisma.InputJsonValue,
      status,
    },
    update: {
      settings: settings as Prisma.InputJsonValue,
      status,
    },
  });
  await prisma.channelSendingProfile.upsert({
    where: {
      organizationId_channel: {
        organizationId: session.organizationId,
        channel: "web_push",
      },
    },
    create: {
      organizationId: session.organizationId,
      channel: "web_push",
      status: status === "ready" ? "ready" : "in_progress",
      checklist: {
        vapid_public_key: Boolean(settings.vapid_public_key),
        vapid_private_key: Boolean(settings.vapid_private_key),
        vapid_subject: Boolean(settings.vapid_subject),
        site_origin: Boolean(settings.site_origin?.startsWith("http")),
      },
    },
    update: {
      status: status === "ready" ? "ready" : "in_progress",
    },
  });
}

async function main() {
  const branchId = await ensureCampaignAccessForOrganization(ORG);
  const session = {
    id: "00000000-0000-4000-8000-000000000098",
    organizationId: ORG,
    branchId,
    email: "seed@local",
    name: "Seed",
    role: "admin" as const,
    initials: "SD",
    orgName: "QA Stripe Pay Ltd 1906",
  };

  await ensureLocalWebVapid(session);

  let matches = await findContactsByIdentityDao(session, { email: EMAIL });
  let contactId = matches[0]?.id;
  if (!contactId) {
    const created = await createContactForIntegrationDao(session, {
      firstName: "Ravi",
      lastName: "Test",
      email: EMAIL,
    });
    contactId = created.id;
  }

  const orgBig = toStableDbId(ORG);
  const org1012 = toStableDbId(VAPID_SOURCE_ORG);
  const template = await prisma.websiteContact.findFirst({
    where: {
      organizationId: org1012,
      email: EMAIL,
      subscribed: true,
      endpoint: { startsWith: "https://" },
    },
    orderBy: { subscribedAt: "desc" },
  });
  if (!template?.endpoint) {
    throw new Error(
      `No subscribed website_contacts row for ${EMAIL} in org ${VAPID_SOURCE_ORG}. Allow notifications on the site first.`,
    );
  }

  const authKeys =
    template.authKeys && typeof template.authKeys === "object"
      ? (template.authKeys as Record<string, unknown>)
      : null;
  if (!authKeys?.p256dh || !authKeys?.auth) {
    throw new Error("Template subscription missing p256dh/auth keys.");
  }

  const contactIdBig = toStableDbId(contactId);
  const endpoint = String(template.endpoint).trim();

  let websiteRow = await prisma.websiteContact.findFirst({
    where: { organizationId: orgBig, email: EMAIL, subscribed: true, endpoint },
  });
  if (!websiteRow) {
    websiteRow = await prisma.websiteContact.create({
      data: {
        organizationId: orgBig,
        visitorId: randomUUID(),
        email: EMAIL,
        firstName: "Ravi",
        lastName: "Test",
        origin: template.origin || "https://rebuild-campaign.worktual.com",
        path: "/",
        subscribed: true,
        subscribedAt: new Date(),
        endpoint,
        authKeys: authKeys as Prisma.InputJsonValue,
        platform: "browser",
        contactId: contactIdBig,
        visitCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  } else if (!websiteRow.contactId) {
    websiteRow = await prisma.websiteContact.update({
      where: { id: websiteRow.id },
      data: { contactId: contactIdBig },
    });
  }

  await upsertPushEndpointDao(session, {
    channel: "web",
    endpoint,
    contactId,
    platform: "browser",
    authKeys,
    label: "seed_org_1013_ravi",
    active: true,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        organization_id: ORG,
        email: EMAIL,
        contact_id: contactId,
        website_contact_id: String(websiteRow.id),
        endpoint_preview: `${endpoint.slice(0, 48)}…`,
        next: [
          "Launch a web-only campaign with this contact in audience (or filter email).",
          "Or POST /api/configuration/push/web_push/test-send with Bearer token for org 1013.",
        ],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
