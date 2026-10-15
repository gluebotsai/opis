import assert from "node:assert/strict";
import test from "node:test";
import {
  applySdkTrace,
  prepareSdkNamedTask,
  sdkConfirmRequired,
  sdkDebugRequested,
  sdkErrorMessage,
  sdkGrantDecision,
  sdkLocaleFromParts,
  sdkPartnerCall,
  sdkQuotaDecision,
  sdkQuotaLimits,
  sdkQuotaMessage,
  sdkQuotaTierMap,
  sdkRoleDenied,
  sdkSkillBreakdown,
  sdkTurnErrorCode,
  sdkUsageContext,
  sdkUsageMeter,
  sdkUsageSkill,
  sdkWidgetEmbed,
  stampSdkTurn,
} from "./sdkTasks.ts";

test("summarize pins the investigation skill and ticket", () => {
  const prepared = prepareSdkNamedTask({
    sessionMemory: { reply_locale: "es" },
    body: {
      sdk_task: "ticket.summarize",
      entity_id: "#128",
      message: "",
    },
    message: "",
  });
  assert.equal(prepared.message, "Summarize this ticket.");
  assert.deepEqual(prepared.sessionMemory, {
    reply_locale: "es",
    sdkTask: "ticket.summarize",
    harnessTaskId: "ticket.investigation.summary",
    harnessFields: { ticket_number: "#128" },
  });
});

test("deflect requires the issue text and stores it as the search query", () => {
  assert.throws(
    () =>
      prepareSdkNamedTask({
        sessionMemory: {},
        body: { sdk_task: "intake.deflect" },
        message: "",
      }),
    /message is required/
  );
  const prepared = prepareSdkNamedTask({
    sessionMemory: {},
    body: { sdk_task: "intake.deflect" },
    message: "How do I reset VPN?",
  });
  assert.equal(prepared.sessionMemory.harnessTaskId, "intake.self.service.deflection");
  assert.deepEqual(prepared.sessionMemory.harnessFields, { query: "How do I reset VPN?" });
});

test("metrics require a question and reject sql", () => {
  assert.throws(
    () =>
      prepareSdkNamedTask({
        sessionMemory: {},
        body: { sdk_task: "analytics.ask", sql: "select count(*) from tickets" },
        message: "How many open tickets?",
      }),
    /sql is not accepted/
  );
  const prepared = prepareSdkNamedTask({
    sessionMemory: {},
    body: { sdk_task: "analytics.why" },
    message: "Why did SLA drop?",
  });
  assert.equal(prepared.sessionMemory.harnessTaskId, "analytics.root.cause");
  assert.equal(prepared.message, "Why did SLA drop?");
});

test("create requires a message and pins ticket.create", () => {
  assert.throws(
    () =>
      prepareSdkNamedTask({
        sessionMemory: {},
        body: { sdk_task: "ticket.create" },
        message: "",
      }),
    /message is required/
  );
  const prepared = prepareSdkNamedTask({
    sessionMemory: {},
    body: { sdk_task: "ticket.create" },
    message: "VPN is down for the finance team",
  });
  assert.equal(prepared.sessionMemory.harnessTaskId, "ticket.create");
  assert.equal(prepared.sessionMemory.sdkTask, "ticket.create");
  assert.equal(prepared.message, "VPN is down for the finance team");
});

test("workload pins routing.optimize.workload without a ticket", () => {
  const prepared = prepareSdkNamedTask({
    sessionMemory: {},
    body: { sdk_task: "ticket.workload" },
    message: "",
  });
  assert.equal(prepared.sessionMemory.harnessTaskId, "routing.optimize.workload");
  assert.deepEqual(prepared.sessionMemory.harnessFields, {});
  assert.match(String(prepared.message), /Do not reassign/);
});

test("unknown sdk_task is rejected and ordinary turns are unchanged", () => {
  assert.throws(
    () =>
      prepareSdkNamedTask({
        sessionMemory: { keep: true },
        body: { sdk_task: "not-a-task" },
        message: "hello",
      }),
    /Unknown sdk_task/
  );
  const prepared = prepareSdkNamedTask({
    sessionMemory: { keep: true },
    body: {},
    message: "hello",
  });
  assert.deepEqual(prepared, { sessionMemory: { keep: true }, message: "hello" });
});

test("a ticket skill without a ticket is missing_context in the call locale", () => {
  assert.throws(
    () =>
      prepareSdkNamedTask({
        sessionMemory: {},
        body: { sdk_task: "ticket.summarize" },
        message: "",
        locale: "fr-CA",
      }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "missing_context");
      assert.equal((err as Error).message, sdkErrorMessage("missing_context", "fr"));
      return true;
    }
  );
});

test("partner error text follows the locale and falls back to English", () => {
  assert.equal(sdkErrorMessage("session_expired", "es-MX"), sdkErrorMessage("session_expired", "es"));
  assert.equal(sdkErrorMessage("forbidden", "zz"), sdkErrorMessage("forbidden", "en"));
  assert.match(sdkErrorMessage("ticketing_not_purchased", "ar"), /Ticketing/);
  assert.equal(sdkErrorMessage("not_a_code", "es"), "Request failed.");
  assert.equal(
    sdkLocaleFromParts({ body: {}, query: {}, acceptLanguage: "de-DE,de;q=0.9" }),
    "de"
  );
  assert.equal(sdkPartnerCall({ path: "/api/coworker/agent-turn" }), false);
  assert.equal(sdkPartnerCall({ path: "/api/coworker/agent-turn", feature: "ai.turn" }), true);
  assert.equal(sdkPartnerCall({ path: "/api/sdk/sessions" }), true);
});

test("role, grant, and turn payload map onto the stable codes", () => {
  assert.equal(sdkRoleDenied("viewer", "ticket.summarize"), false);
  assert.equal(sdkRoleDenied("viewer", "ticket.assign"), true);
  assert.equal(sdkRoleDenied("customer", ""), true);
  assert.equal(sdkRoleDenied("admin", "ticket.create"), false);
  assert.equal(sdkGrantDecision({ schemaAvailable: false, organizationExists: false, granted: false }), "unknown");
  assert.equal(sdkGrantDecision({ schemaAvailable: true, organizationExists: true, granted: false }), "missing");
  assert.equal(sdkGrantDecision({ schemaAvailable: true, organizationExists: true, granted: true }), "granted");
  assert.equal(
    sdkTurnErrorCode({ data: { refusal: { code: "unsupported_product", message: "Payroll is outside Ticketing." } } }),
    "unsupported_operation"
  );
  assert.equal(
    sdkTurnErrorCode({ data: { ticket_draft: { customer_not_found: true } } }),
    "customer_not_found"
  );
  const staff = {
    assistantText: "Payroll is outside Ticketing.",
    reply: "Payroll is outside Ticketing.",
    data: { refusal: { code: "forbidden" } },
  };
  assert.equal(stampSdkTurn(false, "es", staff).reply, "Payroll is outside Ticketing.");
  const partner = stampSdkTurn(true, "es", staff);
  assert.equal(partner.code, "forbidden");
  assert.equal(partner.reply, sdkErrorMessage("forbidden", "es"));
  assert.equal((partner.data as { code?: string }).code, "forbidden");
});

test("quota blocks a full minute or too many in-flight turns", () => {
  assert.deepEqual(
    sdkQuotaDecision({ recentTurns: 0, inFlight: 0, ratePerMinute: 0, concurrent: 0 }),
    { ok: true }
  );
  assert.deepEqual(
    sdkQuotaDecision({ recentTurns: 3, inFlight: 1, ratePerMinute: 10, concurrent: 2 }),
    { ok: true }
  );
  assert.deepEqual(
    sdkQuotaDecision({ recentTurns: 10, inFlight: 0, ratePerMinute: 10, concurrent: 0 }),
    { ok: false, reason: "rate" }
  );
  assert.deepEqual(
    sdkQuotaDecision({ recentTurns: 0, inFlight: 2, ratePerMinute: 0, concurrent: 2 }),
    { ok: false, reason: "concurrent" }
  );
  assert.equal(sdkQuotaMessage("es-MX"), sdkQuotaMessage("es"));
  assert.match(sdkQuotaMessage("zz"), /AI turn limit/);
  assert.match(sdkQuotaMessage("ar"), /الذكاء الاصطناعي/);
});

test("widget calls are ui and named components, other calls stay headless", () => {
  assert.deepEqual(sdkUsageContext({ surface: "ui", component: "worktual-chat" }), {
    surface: "ui",
    component: "worktual-chat",
  });
  assert.deepEqual(sdkUsageContext({ surface: "UI", component: "Worktual-Summary" }), {
    surface: "ui",
    component: "worktual-summary",
  });
  assert.deepEqual(sdkUsageContext({ surface: "browser", component: "../chat" }), {
    surface: "headless",
    component: null,
  });
  assert.deepEqual(sdkUsageContext({}), { surface: "headless", component: null });
});

test("usage bills the catalog skill, then a reported skill, and skips blanks", () => {
  assert.equal(
    sdkUsageSkill({ sdkTask: "analytics.ask", reportedSkill: "other-skill" }),
    "analytics-query"
  );
  assert.equal(sdkUsageSkill({ reportedSkill: "reply-draft" }), "reply-draft");
  assert.equal(sdkUsageSkill({ sdkTask: "not-a-task", reportedSkill: "  " }), null);
  assert.equal(sdkUsageSkill({ sdkTask: "ticket.create", reportedSkill: "other" }), "ticket-create");
  assert.deepEqual(
    sdkSkillBreakdown([
      { skill: "reply-draft", count: "2" },
      { skill: "  ", count: 4 },
      { skill: null, count: 1 },
      { skill: "analytics-query", count: 1 },
      { skill: "reply-draft", count: 1 },
    ]),
    [
      { skill: "analytics-query", count: 1 },
      { skill: "reply-draft", count: 3 },
    ]
  );
});

test("quota tier prefers a stored row, including an explicit unlimited row", () => {
  assert.deepEqual(sdkQuotaTierMap("1000:30:2, nope, 1001:0:0, 1002:-1:1"), {
    "1000": { ratePerMinute: 30, concurrent: 2 },
    "1001": { ratePerMinute: 0, concurrent: 0 },
  });
  const configured = sdkQuotaTierMap("9:4:1");
  assert.deepEqual(
    sdkQuotaLimits({
      organizationId: "9",
      envRate: 10,
      envConcurrent: 2,
      configured,
      stored: { ratePerMinute: 0, concurrent: 0 },
    }),
    { ratePerMinute: 0, concurrent: 0 }
  );
  assert.deepEqual(
    sdkQuotaLimits({ organizationId: "9", envRate: 10, envConcurrent: 2, configured, stored: null }),
    { ratePerMinute: 4, concurrent: 1 }
  );
  assert.deepEqual(
    sdkQuotaLimits({ organizationId: "8", envRate: 10, envConcurrent: 2, configured, stored: null }),
    { ratePerMinute: 10, concurrent: 2 }
  );
});

test("usage meter counts AI turns and confirmation only on AI features", () => {
  assert.deepEqual(sdkUsageMeter("ai.turn", true), { agentTurns: 1, confirmRequired: true });
  assert.deepEqual(sdkUsageMeter("auth.session", true), { agentTurns: 0, confirmRequired: false });
  assert.deepEqual(sdkUsageMeter("quota.exceeded", false), { agentTurns: 0, confirmRequired: false });
  assert.equal(
    sdkConfirmRequired({ toolProposals: [{ name: "update_ticket", auto: false, risk: "low" }] }),
    true
  );
  assert.equal(sdkConfirmRequired({ toolProposals: [{ name: "update_ticket", auto: true, risk: "low" }] }), false);
  assert.equal(sdkConfirmRequired({ toolProposals: [{ name: "update_ticket", risk: "high" }] }), true);
});

test("debug trace is partner-only and drops the route query", () => {
  assert.equal(
    sdkDebugRequested({ path: "/api/coworker/agent-turn", feature: "ai.turn", debug: true }),
    true
  );
  assert.equal(sdkDebugRequested({ path: "/api/coworker/agent-turn", debug: true }), false);
  assert.equal(
    sdkDebugRequested({ path: "/api/coworker/agent-turn", feature: "ai.turn", debug: "true" }),
    false
  );
  const traced = applySdkTrace(true, {
    reply: "Listo",
    data: { trace: { agents: ["super"], routes: [{ from: "super", to: "executor", query: "secret" }] } },
  });
  assert.deepEqual(traced.trace, { agents: ["super"], routes: [{ from: "super", to: "executor" }] });
  assert.equal(JSON.stringify(traced).includes("secret"), false);
  const staff = applySdkTrace(false, traced);
  assert.equal("trace" in staff, false);
  assert.equal("trace" in (staff.data as Record<string, unknown>), false);
});

test("help widget embed uses the public id and never an API key", () => {
  const embed = sdkWidgetEmbed("https://tickets.example", "wgt_abc");
  assert.match(embed.script, /data-widget-id="wgt_abc"/);
  assert.match(embed.iframe, /embed\/help\.html\?id=wgt_abc/);
  assert.equal(embed.script.includes("wt_live_"), false);
  assert.equal(embed.iframe.includes("wt_live_"), false);
});
