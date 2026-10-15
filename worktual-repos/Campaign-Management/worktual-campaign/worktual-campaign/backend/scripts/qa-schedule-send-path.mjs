/**
 * Schedule path E2E (no HTTP login): create campaign with schedule_mode now|at,
 * plan email batches, run processDueEmailBatches for aravindh@.
 *
 * Run: node --import tsx scripts/qa-schedule-send-path.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { scheduleEmailCampaignBatchesDao } from "../src/dao/email-launch.ts";
import { batchScheduledForBase } from "../src/services/campaign-send-lifecycle.ts";
import { processDueEmailBatches } from "../src/services/email-send-worker.ts";

const prisma = new PrismaClient();
const EMAIL = "aravindhselvaraj6235@gmail.com";
const ORG = 1003n;
const BRANCH = 1002n;
const CONTACT = 1830917733048487n;
const TEMPLATE = 415650827137637114n;
const USER = 1027n;

const session = {
  id: String(USER),
  email: "marketing.b2b@worktual.com",
  name: "Marketing",
  role: "marketing",
  initials: "M",
  organizationId: String(ORG),
  branchId: String(BRANCH),
  orgName: "Worktual",
  mode: "b2b",
  industry: "generic-b2b",
  businessType: "B2B",
  industryType: null,
};

const log = {
  info: (o, m) =>
    console.log(
      "[worker]",
      m || "",
      typeof o === "object" ? JSON.stringify(o) : o,
    ),
  warn: (o, m) => console.warn("[worker]", m || "", o),
  error: (o, m) => console.error("[worker]", m || "", o),
};

async function runCase(label, scheduleMode, startsAt, localDate, localTime) {
  const now = Date.now();
  const name = `SchedFix ${label} ${new Date().toISOString().slice(11, 19)}`;
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: ORG,
      branchId: BRANCH,
      createdByUserId: USER,
      name,
      status: scheduleMode === "now" ? "live" : "scheduled",
      goal: "Permanent schedule path test",
      startsAt,
      timezone: "Asia/Kolkata",
      launchLocalDate: localDate,
      launchLocalTime: localTime,
      audienceCount: 1,
      launchPlan: {
        schedule_mode: scheduleMode,
        scheduled_at: startsAt.toISOString(),
        timezone: "Asia/Kolkata",
        launch_local_date: localDate,
        launch_local_time: localTime,
        launch_channels: ["email"],
        primary_channel: "email",
        orchestration_mode: "prefer_primary",
      },
      channels: {
        create: [
          {
            organizationId: ORG,
            channel: "email",
            templateId: TEMPLATE,
            plannedLaunchAt: startsAt.toISOString(),
            status: scheduleMode === "now" ? "ready" : "scheduled",
          },
        ],
      },
      audience: { create: [{ contactId: CONTACT }] },
    },
  });
  const base = batchScheduledForBase({
    startsAt: campaign.startsAt,
    launchPlan: campaign.launchPlan,
  });
  const planned = await scheduleEmailCampaignBatchesDao(
    session,
    String(campaign.id),
  );
  const batches = await prisma.campaignSendBatch.findMany({
    where: { campaignId: campaign.id, channel: "email" },
    select: { id: true, scheduledFor: true, status: true, size: true },
  });
  console.log(
    JSON.stringify(
      {
        label,
        email: EMAIL,
        campaignId: String(campaign.id),
        scheduleMode,
        startsAt: startsAt.toISOString(),
        batchScheduledForBase: base.toISOString(),
        planned,
        batches: batches.map((b) => ({
          id: String(b.id),
          scheduledFor: b.scheduledFor.toISOString(),
          status: b.status,
          size: b.size,
          deltaMs: b.scheduledFor.getTime() - now,
        })),
      },
      null,
      2,
    ),
  );
  return { campaignId: campaign.id };
}

async function main() {
  const now = Date.now();
  // 90s schedule so this script can wait and verify worker pickup.
  const inSoon = new Date(now + 90 * 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(inSoon);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const localDate = `${get("year")}-${get("month")}-${get("day")}`;
  const localTime = `${get("hour")}:${get("minute")}`;

  const immediate = await runCase(
    "now",
    "now",
    new Date(now),
    localDate,
    localTime,
  );
  const scheduled = await runCase("at", "at", inSoon, localDate, localTime);

  const due1 = await processDueEmailBatches(log);
  console.log("processDueEmailBatches_immediate", due1);
  // Live backend worker may already be claiming due batches; poll status.
  let immRecipients = [];
  for (let i = 0; i < 12; i++) {
    immRecipients = await prisma.campaignSendRecipient.findMany({
      where: { campaignId: immediate.campaignId },
      select: {
        email: true,
        status: true,
        attemptCount: true,
        skipFailReason: true,
      },
    });
    if (
      immRecipients.some((r) =>
        ["sent", "stub_sent", "failed", "skipped"].includes(r.status),
      )
    ) {
      break;
    }
    await processDueEmailBatches(log);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("immediate_recipients", immRecipients);

  const waitMs = Math.max(0, inSoon.getTime() - Date.now()) + 8000;
  console.log("waiting_ms_for_scheduled", waitMs);
  await new Promise((r) => setTimeout(r, waitMs));

  let schedRecipients = [];
  for (let i = 0; i < 12; i++) {
    await processDueEmailBatches(log);
    schedRecipients = await prisma.campaignSendRecipient.findMany({
      where: { campaignId: scheduled.campaignId },
      select: {
        email: true,
        status: true,
        attemptCount: true,
        skipFailReason: true,
      },
    });
    if (
      schedRecipients.some((r) =>
        ["sent", "stub_sent", "failed", "skipped"].includes(r.status),
      )
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("scheduled_recipients", schedRecipients);

  const terminal = new Set(["sent", "stub_sent", "failed", "skipped"]);
  const okImm = immRecipients.some((r) => terminal.has(r.status));
  const okSched = schedRecipients.some((r) => terminal.has(r.status));
  const deliveredImm = immRecipients.some((r) =>
    ["sent", "stub_sent"].includes(r.status),
  );
  const deliveredSched = schedRecipients.some((r) =>
    ["sent", "stub_sent"].includes(r.status),
  );
  console.log("RESULT", {
    okImm,
    okSched,
    deliveredImm,
    deliveredSched,
    immediateCampaignId: String(immediate.campaignId),
    scheduledCampaignId: String(scheduled.campaignId),
  });
  if (!okImm || !okSched || !deliveredImm || !deliveredSched) {
    console.error("FAIL schedule path delivery");
    process.exitCode = 1;
  } else {
    console.log("PASS schedule path: immediate + delayed both delivered");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
