/**
 * Manual user-path E2E: create session → WhatsApp template → audience → launch → Meta submit.
 * Uses Booxoo org user + contact 919346765884 (same as UI testing).
 *
 *   cd backend && npx tsx scripts/e2e-manual-whatsapp-launch.ts
 */
import { prisma } from "../src/plugins/prisma.js";
import { getSessionUserById } from "../src/dao/auth.js";
import {
  createTemplatesBatchDao,
  syncWhatsAppSubmitPayload,
} from "../src/dao/channel-template.js";
import { saveCampaignFromSessionDao } from "../src/dao/campaign.js";
import { scheduleWhatsAppCampaignBatchesDao } from "../src/dao/whatsapp-launch.js";
import { listContactPhonesByIdsDao } from "../src/dao/contact.js";
import { socialGetTemplateApprovalStatus } from "../src/services/social-whatsapp.js";
import {
  getOrCreateAgentSessionDao,
  replaceAudienceRefsDao,
} from "../src/dao/agent-session.js";

const BOOXOO_USER_ID = "1054";
const CONTACT_ID = "1833390130995107";
const TARGET_PHONE_SUFFIX = "919346765884";

const WA_BODY =
  "Hi {{first_name}}, your Worktual update is ready for review. " +
  "Open the link below to see details and follow up with your team when you have a moment today.";

async function main() {
  const sessionUser = await getSessionUserById(BOOXOO_USER_ID);
  if (!sessionUser) {
    console.error("FAIL: could not load session user", BOOXOO_USER_ID);
    process.exit(1);
  }
  console.log("user", sessionUser.id, "org", sessionUser.organizationId);

  const phones = await listContactPhonesByIdsDao(sessionUser, [CONTACT_ID]);
  const phone = phones[0]?.phone || "";
  if (!phone.replace(/\D/g, "").includes(TARGET_PHONE_SUFFIX)) {
    console.error("FAIL: contact phone mismatch", phones);
    process.exit(1);
  }
  console.log("contact", CONTACT_ID, "phone", phone);

  const sessionId = String(Date.now());
  await getOrCreateAgentSessionDao(sessionUser, sessionId, "create_campaign");
  await replaceAudienceRefsDao(sessionUser, sessionId, [CONTACT_ID]);

  const tplName = `wa_manual_e2e_${Date.now().toString().slice(-8)}`;
  let fields = syncWhatsAppSubmitPayload({
    name: tplName,
    language: "en",
    category: "UTILITY",
    header_format: "NONE",
    header: "",
    body: WA_BODY,
    footer: "Worktual",
    buttons: [
      { type: "QUICK_REPLY", text: "Help" },
      {
        type: "URL",
        text: "Open",
        url: "https://app.worktual.com",
      },
    ],
  });

  const batch = await createTemplatesBatchDao(sessionUser, sessionId, [
    {
      channel: "whatsapp",
      fields,
      how_it_works: "WhatsApp E2E manual test",
    },
  ]);
  const templateId =
    batch.templates[0]?.template_id || (batch.templates[0] as { id?: string })?.id;
  if (!templateId) {
    console.error("FAIL: no template created", batch);
    process.exit(1);
  }
  console.log("template", templateId, "name", tplName);

  const startsAt = new Date().toISOString();
  const saved = await saveCampaignFromSessionDao(sessionUser, sessionId, {
    name: `Manual WA E2E ${tplName}`,
    goal: "E2E WhatsApp manual launch test",
    objective: "Submit Meta template and queue send for one contact",
    status: "scheduled",
    contact_ids: [CONTACT_ID],
    channels: [
      {
        channel: "whatsapp",
        template_id: templateId,
        how_it_works: "WhatsApp",
        status: "scheduled",
        planned_launch_at: startsAt,
      },
    ],
    launch_plan: {
      schedule_mode: "now",
      launch_channels: ["whatsapp"],
      primary_channel: "whatsapp",
      scheduled_at: startsAt,
      timezone: "Asia/Kolkata",
      timing_label: "Now",
    },
    starts_at: startsAt,
    timezone: "Asia/Kolkata",
    audience_count: 1,
  });
  const campaignId = saved.id;
  console.log("campaign", campaignId, "status", saved.status);

  let plan: Awaited<ReturnType<typeof scheduleWhatsAppCampaignBatchesDao>>;
  try {
    plan = await scheduleWhatsAppCampaignBatchesDao(sessionUser, campaignId);
  } catch (err) {
    console.error("FAIL: scheduleWhatsApp", err);
    process.exit(1);
  }

  const wa = (plan as { whatsapp?: Record<string, unknown> }).whatsapp;
  const cfg = wa?.channel_config_id;
  const metaStatus = String(wa?.status || "").toLowerCase();
  console.log("\n--- launch result ---");
  console.log(JSON.stringify(plan, null, 2));

  if (cfg !== "1063") {
    console.warn("WARN: expected channel_config_id 1063, got", cfg);
  }

  let liveStatus = "";
  if (tplName) {
    try {
      const poll = await socialGetTemplateApprovalStatus({
        channelConfigId: String(cfg || "1063"),
        templateName: tplName,
        language: "en",
      });
      liveStatus = String(poll.templates?.[0]?.status || "");
      console.log("\n--- Meta approval-status ---");
      console.log(poll.templates?.[0]);
    } catch (e) {
      console.warn("approval-status poll failed", e);
    }
  }

  const batches = await prisma.campaignSendBatch.findMany({
    where: { campaignId, channel: "whatsapp" },
    include: { recipients: true },
  });

  const okSubmit =
    Boolean(wa?.provider_template_id) ||
    metaStatus === "pending" ||
    metaStatus === "approved" ||
    liveStatus === "PENDING" ||
    liveStatus === "APPROVED";
  const okBatch =
    batches.length > 0 &&
    batches.some((b) =>
      b.recipients.some((r) =>
        String(r.destination || "").includes(TARGET_PHONE_SUFFIX),
      ),
    );
  const rejected =
    metaStatus === "rejected" || liveStatus === "REJECTED";

  console.log("\n=== VERDICT ===");
  console.log("Meta submit reached:", okSubmit ? "YES" : "NO");
  console.log("WhatsApp batch for 919346765884:", okBatch ? "YES" : "NO");
  console.log("Template Meta status:", liveStatus || metaStatus || "unknown");
  if (rejected) {
    console.log(
      "NOTE: REJECTED = Meta content/format — config/submit path still worked.",
    );
  }
  if (okSubmit && okBatch && !rejected) {
    console.log("OVERALL: SUCCESS (pending/approved + batch queued)");
    process.exit(0);
  }
  if (okSubmit && okBatch && rejected) {
    console.log("OVERALL: PARTIAL — submit + batch OK; Meta rejected template copy");
    process.exit(0);
  }
  console.log("OVERALL: FAIL");
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
