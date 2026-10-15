/**
 * Send Worktual-themed meeting email samples to a mailbox (default: lucifer).
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/send-meeting-email-sample.ts
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/send-meeting-email-sample.ts --only extras
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/send-meeting-email-sample.ts --to other@example.com
 *
 * --only core   → brief 1h, participant 1h, invitation, starting-soon (first batch)
 * --only extras → MOM, internal MOM, booking brief, 24h variants, reschedule, guest-added
 * --only all    → everything (default)
 */
import { prisma } from "../src/dao/db/prisma.js";
import { buildMeetingBriefContext } from "../src/service/ai/meeting-brief";
import {
  analyzeMeetingMom,
} from "../src/service/ai/meeting-mom";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "../src/service/ai/ai-service-client";
import { sendCrmBotEmail } from "../src/service/email/send-crm-bot-email";
import { resolveOrgBrand } from "../src/lib/org-brand";
import {
  buildMeetingConfirmationEmailHtml,
  buildMeetingReminderEmailHtml,
} from "../src/service/calendar/meeting-mail-html";
import { buildMeetingParticipantAddedEmail } from "../src/service/calendar/meeting-mail";

const DEFAULT_TO = "lucifer543666@gmail.com";
const DEFAULT_ACTIVITY = "cmts6faaj00001abpsrrzjxyk";

const SAMPLE_TRANSCRIPT = `
Sales Rep: Thanks for joining today. We walked through Worktual CRM and how it connects to your Zendesk workflow.
Customer: We need multilingual student support and a clear integration path before we expand to three campuses.
Sales Rep: Understood. I'll share a scoped evaluation plan and propose remote demo slots for next week.
Customer: Please include our IT lead Vijay and send a written summary of today's discussion.
Sales Rep: Agreed — you'll receive minutes of meeting with action items and follow-up dates within two business days.
`.trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function sendMail(
  orgId: string,
  to: string,
  label: string,
  subject: string,
  body: string,
) {
  const sent = await sendCrmBotEmail({
    organizationId: orgId,
    to,
    subject: `[SAMPLE · ${label}] ${subject}`.slice(0, 180),
    body,
  });
  console.log(`${label}:`, sent.ok ? "sent" : sent);
}

async function sendBrief(
  orgId: string,
  to: string,
  label: string,
  args: {
    activityId: string;
    contactId: string;
    audience: "owner" | "participant";
    reminderWindow?: "24h" | "1h";
    context: Awaited<ReturnType<typeof buildMeetingBriefContext>>;
    organizerName: string;
  },
) {
  if (!args.context) return;
  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
    reason?: string | null;
  }>(
    "meeting-brief-email",
    {
      activityId: args.activityId,
      contactId: args.contactId,
      organizationId: orgId,
      audience: args.audience,
      reminderWindow: args.reminderWindow,
      context: args.context,
      participantFirstName: "Lucifer",
      organizerName: args.organizerName,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );
  if (agent?.ok && agent.subject && agent.body) {
    await sendMail(orgId, to, label, agent.subject, agent.body);
  } else {
    console.log(`${label}: skipped —`, agent?.reason || "agent failed");
  }
}

async function main() {
  const to = arg("--to") || DEFAULT_TO;
  const activityId = arg("--activity") || DEFAULT_ACTIVITY;
  const only = arg("--only") || "all";
  const runCore = only === "all" || only === "core";
  const runExtras = only === "all" || only === "extras";

  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
    },
  });
  if (!activity) {
    console.error("Meeting activity not found:", activityId);
    process.exit(1);
  }

  const orgId = String(activity.organizationId);
  const ctx = await buildMeetingBriefContext(activityId, orgId);
  if (!ctx) {
    console.error("Could not build meeting brief context");
    process.exit(1);
  }

  const brand = await resolveOrgBrand(orgId);
  const organizerName = ctx.ownerName || "Worktual Team";
  const organizerEmail = ctx.ownerEmail || to;
  const topic = ctx.topic || activity.subject.replace(/^Meeting:\s*/i, "").trim() || "Meeting";
  const whenLabel = ctx.whenLabel || "Upcoming";
  const meetLink = ctx.meetingLink;
  const contactName = ctx.contactName || "Contact";
  const companyName = ctx.companyName;

  console.log("Sending to:", to, "| mode:", only);
  console.log("Activity:", activityId, "| Org:", orgId, "| Logo:", brand.logoUrl);

  if (runCore) {
    await sendBrief(orgId, to, "Owner brief · 1h", {
      activityId,
      contactId: activity.contactId,
      audience: "owner",
      reminderWindow: "1h",
      context: ctx,
      organizerName,
    });
    await sendBrief(orgId, to, "Participant · 1h", {
      activityId,
      contactId: activity.contactId,
      audience: "participant",
      reminderWindow: "1h",
      context: ctx,
      organizerName,
    });
    await sendMail(
      orgId,
      to,
      "Invitation",
      `${topic} — ${whenLabel}`,
      buildMeetingConfirmationEmailHtml({
        contactFirstName: "Lucifer",
        organizerName,
        organizerEmail,
        topic,
        whenLabel,
        meetLink,
        guestEmails: [to],
        logoUrl: brand.logoUrl,
        sellerName: brand.sellerName,
      }),
    );
    await sendMail(
      orgId,
      to,
      "Starting soon",
      topic,
      buildMeetingReminderEmailHtml({
        contactFirstName: "Lucifer",
        organizerName,
        topic,
        whenLabel,
        meetLink,
        window: "1h",
        logoUrl: brand.logoUrl,
        sellerName: brand.sellerName,
      }),
    );
  }

  if (runExtras) {
    await sendBrief(orgId, to, "Owner brief · booking", {
      activityId,
      contactId: activity.contactId,
      audience: "owner",
      context: ctx,
      organizerName,
    });
    await sendBrief(orgId, to, "Owner brief · 24h", {
      activityId,
      contactId: activity.contactId,
      audience: "owner",
      reminderWindow: "24h",
      context: ctx,
      organizerName,
    });
    await sendBrief(orgId, to, "Participant · 24h", {
      activityId,
      contactId: activity.contactId,
      audience: "participant",
      reminderWindow: "24h",
      context: ctx,
      organizerName,
    });
    await sendMail(
      orgId,
      to,
      "Rescheduled",
      `Updated: ${topic}`,
      buildMeetingConfirmationEmailHtml({
        contactFirstName: "Lucifer",
        organizerName,
        organizerEmail,
        topic,
        whenLabel,
        meetLink,
        guestEmails: [to],
        rescheduled: true,
        previousWhenLabel: "Previous slot (sample)",
        logoUrl: brand.logoUrl,
        sellerName: brand.sellerName,
      }),
    );
    await sendMail(
      orgId,
      to,
      "Reminder · 24h",
      topic,
      buildMeetingReminderEmailHtml({
        contactFirstName: "Lucifer",
        organizerName,
        topic,
        whenLabel,
        meetLink,
        window: "24h",
        logoUrl: brand.logoUrl,
        sellerName: brand.sellerName,
      }),
    );

    const guestAdded = buildMeetingParticipantAddedEmail({
      organizerName,
      organizerEmail,
      topic,
      whenLabel,
      meetLink,
      guestEmails: [to],
    });
    await sendMail(orgId, to, "Guest added · plain text", guestAdded.subject, guestAdded.body);

    const momAnalysis = await analyzeMeetingMom({
      transcript: SAMPLE_TRANSCRIPT,
      contactName,
      topic,
      companyName,
      whenLabel,
      ownerName: organizerName,
      sellerName: brand.sellerName,
      orgLogoUrl: brand.logoUrl,
      meetLink,
      contactHref: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:5173"}/contact/${activity.contactId}`,
      activityId,
      contactId: activity.contactId,
      organizationId: orgId,
    });

    if (momAnalysis.customerEmail) {
      await sendMail(
        orgId,
        to,
        "MOM · customer HTML",
        momAnalysis.customerEmail.subject,
        momAnalysis.customerEmail.body,
      );
    } else {
      console.log("MOM · customer HTML: skipped — agent returned no customer email");
    }

    if (momAnalysis.internalEmail) {
      await sendMail(
        orgId,
        to,
        "MOM · internal HTML",
        momAnalysis.internalEmail.subject,
        momAnalysis.internalEmail.body,
      );
    } else {
      console.log("MOM · internal HTML: skipped — agent returned no internal email");
    }
  }

  console.log("\nDone — check inbox at", to);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
