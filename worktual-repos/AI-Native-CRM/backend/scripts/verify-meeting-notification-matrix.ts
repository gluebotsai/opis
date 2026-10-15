/**
 * One-shot verification for meeting prep / capture / notification matrix.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/verify-meeting-notification-matrix.ts
 */
import { execSync } from "node:child_process";
import { prisma } from "../src/dao/db/prisma.js";
import { listMeetingEscalationRecipients } from "../src/service/account/user-directory.js";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox.js";
import { buildMeetingBriefContext } from "../src/service/ai/meeting-brief.js";
import { triggerPostMeetingAgentsForActivity } from "../src/service/ai/lead-lifecycle-transcripts.js";

const ORG = process.env.SMOKE_ORG_ID || "1000";
type Row = { area: string; check: string; ok: boolean; detail: string };
const rows: Row[] = [];

function record(area: string, check: string, ok: boolean, detail: string) {
  rows.push({ area, check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${area}] ${check} — ${detail}`);
}

async function main() {
  console.log("\n=== Meeting notification matrix verification ===\n");

  const unitTests = [
    "src/service/ai/meeting-reminder-recipient.test.ts",
    "src/service/ai/lead-lifecycle-transcripts.test.ts",
    "src/dao/notifications/notify-admins.test.ts",
    "src/service/account/user-directory.test.ts",
    "src/service/ai/post-meeting-process.test.ts",
    "src/service/email/notification-email-html.test.ts",
  ];
  for (const file of unitTests) {
    try {
      execSync(`npx tsx --tsconfig tsconfig.json ${file}`, {
        cwd: process.cwd(),
        stdio: "pipe",
      });
      record("unit", file, true, "ok");
    } catch (e) {
      record("unit", file, false, e instanceof Error ? e.message : "failed");
    }
  }

  record(
    "code",
    "triggerPostMeetingAgentsForActivity exported",
    typeof triggerPostMeetingAgentsForActivity === "function",
    typeof triggerPostMeetingAgentsForActivity,
  );

  const esc = await listMeetingEscalationRecipients(ORG);
  record(
    "routing",
    "MOM/escalation recipients (sales_manager ∪ admin)",
    esc.recipients.length > 0,
    `${esc.recipients.length} users via ${esc.via}`,
  );

  const bot = await resolveCrmBotMailbox(ORG);
  const botAddress = bot?.accountEmail || bot?.senderEmail;
  const botReady = Boolean(
    botAddress?.includes("@") &&
      bot?.oauthConnectionId &&
      !bot?.needsReauth,
  );
  record(
    "mail",
    "CRM bot mailbox (internal MOM / notify email)",
    Boolean(botAddress),
    botReady
      ? `${botAddress} (${bot?.oauthProvider ?? "oauth"})`
      : botAddress
        ? `${botAddress} — OAuth missing or needs re-auth`
        : "not configured",
  );

  const recent = await prisma.contactActivity.findFirst({
    where: {
      type: "meeting",
      transcriptText: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
      transcriptSource: true,
      momSentAt: true,
    },
  });

  if (recent) {
    const ctx = await buildMeetingBriefContext(
      recent.id,
      String(recent.organizationId),
    );
    record(
      "meeting_brief",
      "buildMeetingBriefContext for latest captured meeting",
      Boolean(ctx?.ownerUserId || ctx?.contactName),
      ctx
        ? `owner=${ctx.ownerUserId ?? "none"} contact=${ctx.contactName}`
        : "null",
    );

    const audits = await prisma.$queryRawUnsafe<
      Array<{ agent: string; outcome: string | null; created_at: Date }>
    >(
      `
      SELECT meta->>'agent' AS agent, meta->>'outcome' AS outcome, created_at
      FROM crm.audit_logs
      WHERE entity_id = $1
        AND meta->>'agent' IN ('meeting_mom','post_meeting_process','meeting_brief','meeting_reminder')
      ORDER BY created_at DESC
      LIMIT 5
      `,
      recent.id,
    );
    record(
      "audit",
      "recent meeting agent audit trail",
      audits.length > 0,
      audits.map((a) => `${a.agent}:${a.outcome}`).join(", ") || "none",
    );
    record(
      "mom",
      "momSentAt on latest captured meeting",
      Boolean(recent.momSentAt),
      recent.momSentAt?.toISOString() ?? "not sent",
    );
  } else {
    record("data", "latest captured meeting", false, "no meeting with transcript in DB");
  }

  const aiHealth = await fetch(
    `${process.env.AI_SERVICE_URL || "http://127.0.0.1:8000"}/health`,
  ).then((r) => r.ok).catch(() => false);
  record("ai-service", "health", aiHealth, aiHealth ? "200" : "unreachable");

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n=== ${rows.length - failed}/${rows.length} checks passed ===\n`);
  if (failed) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
