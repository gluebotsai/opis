/**
 * Verify agent_step_events are correctly recorded for the 7 newly-instrumented
 * agents: lead_summary, sales_assignment, meeting_brief, meeting_reminder,
 * meeting_miss_escalation, meeting_mom, post_meeting_process.
 *
 * Uses only the internal-secret-authenticated path (ai-service -> backend
 * internal routes) — the same path production TS callers use via
 * callAiServiceAgent(...). No user login / session / accounts DB touched.
 * Contact/activity ids are synthetic (agent_step_events.contact_id has no FK
 * constraint), so nothing real is read or written outside agent_step_events.
 *
 * Run: npx tsx --env-file=../.env --env-file=../.env.local scripts/verify-agent-step-tracing.ts
 */
import { randomBytes } from "node:crypto";
import { getPrismaClient } from "../src/dao/db/prisma.ts";

const AI = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const SECRET = process.env.ENRICH_INTERNAL_SECRET || "2b179c0d739539750168566ca295a7df";
// Local demo org id already used by prisma/seed.ts — not tied to any real tenant data.
const ORG_ID = "1000";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function sfx() {
  return randomBytes(6).toString("hex");
}
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function callAi(agent: string, body: Record<string, unknown>) {
  const res = await fetch(`${AI}/ai/v1/agents/${agent}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }
  return { status: res.status, json };
}

async function stepsForContactAgent(agent: string, contactId: string) {
  return getPrismaClient().$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT job_id, step, status, error_reason FROM agent_step_events WHERE agent=$1 AND contact_id=$2 ORDER BY started_at ASC`,
    agent,
    contactId,
  );
}

async function main() {
  console.log("\n=== Agent step-tracing verification (7 new agents) ===\n");
  console.log(`ai-service=${AI} org=${ORG_ID} (synthetic ids only, no real data touched)\n`);

  const s = sfx();
  // Synthetic ids — no row exists in contact_profiles / contact_activities.
  // agent_step_events.contact_id has no FK constraint (plain TEXT + index),
  // so this exercises the exact same persistence path real runs use without
  // touching any real customer or account data.
  const contactId = `test_contact_${s}`;
  const activityId = `test_activity_${s}`;
  console.log(`synthetic contactId=${contactId} activityId=${activityId}\n`);

  // ── 1. lead_summary ──────────────────────────────────────────
  {
    const r = await callAi("summarize-lead", { contactId, organizationId: ORG_ID, force: true });
    const steps = await stepsForContactAgent("lead_summary", contactId);
    record(
      "lead_summary: agent_step_events recorded",
      steps.length >= 1,
      `http=${r.status} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  // ── 2. sales_assignment ──────────────────────────────────────
  {
    const r = await callAi("assign-sales", {
      organizationId: ORG_ID,
      contactId,
      country: "United Kingdom",
      city: "London",
    });
    const steps = await stepsForContactAgent("sales_assignment", contactId);
    record(
      "sales_assignment: agent_step_events recorded (load_candidates/resolve)",
      steps.length >= 2,
      `http=${r.status} status=${r.json.status} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  // ── 3. meeting_brief (booking) ────────────────────────────────
  {
    const r = await callAi("meeting-brief-email", {
      activityId,
      contactId,
      organizationId: ORG_ID,
      audience: "owner",
      context: {
        contactName: "Synthetic Test Contact",
        companyName: "Synthetic Test Co",
        topic: "Discovery call",
        whenLabel: "tomorrow 3pm",
        ownerName: "Rep",
      },
    });
    const steps = await stepsForContactAgent("meeting_brief", contactId);
    record(
      "meeting_brief: agent_step_events recorded (normalize/compose)",
      steps.length >= 2,
      `http=${r.status} ok=${r.json.ok} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  // ── 4. meeting_reminder (same file, dynamic agent name) ────────
  {
    const r = await callAi("meeting-brief-email", {
      activityId,
      contactId,
      organizationId: ORG_ID,
      audience: "owner",
      reminderWindow: "24h",
      context: {
        contactName: "Synthetic Test Contact",
        companyName: "Synthetic Test Co",
        topic: "Discovery call",
        whenLabel: "in ~24 hours",
        ownerName: "Rep",
      },
    });
    const reminderSteps = await stepsForContactAgent("meeting_reminder", contactId);
    const briefSteps = await stepsForContactAgent("meeting_brief", contactId);
    record(
      "meeting_reminder: dynamic agent name emits under meeting_reminder (separate from meeting_brief)",
      reminderSteps.length >= 2,
      `http=${r.status} reminderSteps=${reminderSteps.length} briefStepsUnchanged=${briefSteps.length}`,
    );
  }

  // ── 5. meeting_miss_escalation ─────────────────────────────────
  {
    const r = await callAi("meeting-miss-escalation", {
      organizationId: ORG_ID,
      activityId,
      context: {
        contactId,
        contactName: "Synthetic Test Contact",
        companyName: "Synthetic Test Co",
        topic: "Discovery call",
        whenLabel: "yesterday 3pm",
        captureStatus: "missing",
        leadScore: 55,
      },
    });
    const steps = await stepsForContactAgent("meeting_miss_escalation", contactId);
    record(
      "meeting_miss_escalation: agent_step_events recorded + contact_id populated from context.contactId",
      steps.length >= 2,
      `http=${r.status} ok=${r.json.ok} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  // ── 6. meeting_mom ──────────────────────────────────────────────
  {
    const transcript =
      "Rep: Thanks for joining. Lead: Happy to be here, we're evaluating CRMs for our sales team of 20 reps. " +
      "Rep: Great, what's your timeline? Lead: We'd like to decide within a month, budget is approved at director level. " +
      "Rep: I'll send a proposal by Friday. Lead: Sounds good, let's follow up next week.";
    const r = await callAi("meeting-mom", {
      transcript,
      contactName: "Synthetic Test Contact",
      topic: "Discovery call",
      companyName: "Synthetic Test Co",
      organizationId: ORG_ID,
      activityId,
      contactId,
    });
    const steps = await stepsForContactAgent("meeting_mom", contactId);
    record(
      "meeting_mom: agent_step_events recorded (bug fix: activityId/contactId now reach the agent)",
      steps.length >= 2,
      `http=${r.status} ok=${r.json.ok} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  // ── 7. post_meeting_process ─────────────────────────────────────
  {
    const transcript =
      "Rep: Thanks for the call. Lead: We need a proposal covering onboarding for 20 users and API access. " +
      "Rep: Can we meet again next Tuesday at 2pm to review it? Lead: Yes, Tuesday 2pm works.";
    const r = await callAi("post-meeting-process", {
      transcript,
      contactName: "Synthetic Test Contact",
      organizationId: ORG_ID,
      timeZone: "Asia/Kolkata",
      referenceNowIso: new Date().toISOString(),
      activityId,
      contactId,
    });
    const steps = await stepsForContactAgent("post_meeting_process", contactId);
    record(
      "post_meeting_process: agent_step_events recorded (bug fix: activityId/contactId now reach the agent)",
      steps.length >= 2,
      `http=${r.status} ok=${r.json.ok} steps=${steps.map((st) => `${st.step}:${st.status}`).join(",")}`,
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed / ${results.length} ===`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  FAIL: ${r.name} — ${r.detail}`);
  }
  await getPrismaClient().$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await getPrismaClient().$disconnect();
  } catch {
    /* */
  }
  process.exit(1);
});
