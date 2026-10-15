/**
 * One-shot QA: create email campaign for aravindh, send via local processBatch
 * with v2 wt token (30-char, exact CDP contact id).
 *
 * Creates the batch with scheduledFor far in the future so shared-DB remote
 * workers cannot steal it, then claims locally.
 *
 * Run: node --import tsx scripts/qa-wt-launch-aravindh.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  buildWebTrackingUtmLandingUrl,
  buildWebTrackingToken,
  parseWebTrackingToken,
  TOKEN_LEN,
} from "../src/helpers/web-tracking-link.ts";
import { processBatch } from "../src/services/email-send-worker.ts";
import { env } from "../src/config/env.ts";

const prisma = new PrismaClient();
const EMAIL = "aravindhselvaraj6235@gmail.com";
const ORG = 1003n;
const BRANCH = 1002n;
const CONTACT = 1830917733048487n;
const TEMPLATE = 415650827137637114n;

const log = {
  info: (o, m) =>
    console.log(
      "[info]",
      m || "",
      typeof o === "object"
        ? JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v))
        : o,
    ),
  warn: (o, m) =>
    console.warn(
      "[warn]",
      m || "",
      typeof o === "object"
        ? JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v))
        : o,
    ),
  error: (o, m) =>
    console.error(
      "[error]",
      m || "",
      typeof o === "object"
        ? JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v))
        : o,
    ),
};

function j(x) {
  return JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

async function main() {
  const secret = env.webTracking.hmacSecret;
  const landing = env.webTracking.landingUrl;
  const apiBase = env.apiPublicUrl.replace(/\/$/, "");
  console.log("api_public_url", apiBase);
  console.log("secret_set", Boolean(secret), "landing", landing);
  console.log("contact_exact_cdp_id", CONTACT.toString());

  const name = `WT QA ExactCid ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: ORG,
      branchId: BRANCH,
      createdByUserId: 1027n,
      name,
      status: "scheduled",
      goal: "Verify v2 wt= encodes exact CDP contact id (local send)",
      channels: {
        create: [{ organizationId: ORG, channel: "email", templateId: TEMPLATE }],
      },
      audience: {
        create: [{ contactId: CONTACT }],
      },
      launchPlan: {
        channels: ["email"],
        send_planned_at: null,
      },
    },
  });
  console.log("created_campaign", campaign.id.toString(), name);

  // Park far in the future so remote workers never see this as due.
  const parkedFor = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const batch = await prisma.campaignSendBatch.create({
    data: {
      organizationId: ORG,
      campaignId: campaign.id,
      seq: 0,
      scheduledFor: parkedFor,
      status: "queued",
      size: 1,
      channel: "email",
      recipients: {
        create: [
          {
            organizationId: ORG,
            campaignId: campaign.id,
            contactId: CONTACT,
            email: EMAIL,
            destination: EMAIL,
            status: "pending",
            attemptCount: 0,
          },
        ],
      },
    },
  });
  console.log(
    "batch_parked",
    batch.id.toString(),
    "until",
    parkedFor.toISOString(),
  );

  const expected = buildWebTrackingUtmLandingUrl(
    { organizationId: ORG, campaignId: campaign.id, contactId: CONTACT },
    landing,
    secret,
    { campaignName: name, utmMedium: "email" },
  );
  const token = buildWebTrackingToken(
    { organizationId: ORG, campaignId: campaign.id, contactId: CONTACT },
    secret,
  );
  console.log("expected_landing", expected);
  console.log("expected_token", token);
  console.log("expected_token_len", token.length, "want", TOKEN_LEN);
  const decodedPre = parseWebTrackingToken(token, secret);
  console.log("decoded_pre_send", {
    org: decodedPre.organizationId.toString(),
    campaign: decodedPre.campaignId.toString(),
    contact: decodedPre.contactId.toString(),
    version: decodedPre.tokenVersion,
  });
  if (decodedPre.contactId !== CONTACT) {
    throw new Error(
      `FAIL: token contact ${decodedPre.contactId} != CDP ${CONTACT}`,
    );
  }
  if (token.length !== TOKEN_LEN) {
    throw new Error(`FAIL: token length ${token.length} != ${TOKEN_LEN}`);
  }

  // Make due and claim locally before any remote tick can see it.
  await prisma.campaignSendBatch.update({
    where: { id: batch.id },
    data: { scheduledFor: new Date(Date.now() - 1000) },
  });
  console.log("claiming_locally_now", batch.id.toString());
  await processBatch(batch.id, log);

  const recs = await prisma.campaignSendRecipient.findMany({
    where: { campaignId: campaign.id },
  });
  console.log("recipients_after", j(recs));

  const recip = recs.find(
    (r) => (r.email || "").toLowerCase() === EMAIL.toLowerCase(),
  );
  if (!recip) {
    throw new Error("Recipient not found after send");
  }
  if (recip.status !== "sent") {
    throw new Error(
      `FAIL: recipient status=${recip.status} reason=${recip.skipFailReason}`,
    );
  }
  if (!expected) {
    throw new Error("Expected landing URL is null — check HMAC secret / landing");
  }

  const batchAfter = await prisma.campaignSendBatch.findUnique({
    where: { id: batch.id },
  });
  console.log("batch_status_after", batchAfter?.status);

  const href = `${apiBase}/api/campaigns/track/click/${recip.id}?u=${encodeURIComponent(expected)}`;
  console.log("VERIFY_BUTTON_HREF", href);
  console.log("VERIFY_HAS_WT", /wt%3D|wt=/.test(href));

  const clickBase =
    apiBase.startsWith("http://192.168.") || apiBase.startsWith("http://127.")
      ? "http://127.0.0.1:3001"
      : apiBase;
  const res = await fetch(
    `${clickBase}/api/campaigns/track/click/${recip.id}?u=${encodeURIComponent(expected)}`,
    { redirect: "manual" },
  );
  const loc = res.headers.get("location") || "";
  console.log("click_status", res.status);
  console.log("click_location", loc);
  if (!/[?&]wt=/.test(loc)) {
    throw new Error("FAIL: landing redirect missing wt=");
  }
  const wtFromLoc = new URL(loc).searchParams.get("wt") || "";
  const decodedLoc = parseWebTrackingToken(wtFromLoc, secret);
  console.log("decoded_from_click_redirect", {
    org: decodedLoc.organizationId.toString(),
    campaign: decodedLoc.campaignId.toString(),
    contact: decodedLoc.contactId.toString(),
    version: decodedLoc.tokenVersion,
    token_len: wtFromLoc.length,
  });
  if (decodedLoc.contactId !== CONTACT) {
    throw new Error(
      `FAIL: redirect wt contact ${decodedLoc.contactId} != CDP ${CONTACT}`,
    );
  }
  if (wtFromLoc.length !== TOKEN_LEN) {
    throw new Error(`FAIL: redirect wt length ${wtFromLoc.length} != ${TOKEN_LEN}`);
  }
  console.log("EXACT_CONTACT_OK", true);
  console.log("recipient_status", recip.status);
  console.log(
    "GMAIL_CHECK",
    "New email CTA wt= is 30 chars and decodes to exact CDP 1830917733048487",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
