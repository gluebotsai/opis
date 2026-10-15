#!/usr/bin/env node
/**
 * End-to-end smoke for user-reported chat scenarios across admin/agent/resolver.
 * Run: node scripts/user-scenario-smoke.mjs
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const USERS = {
  admin: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com",
  agent: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com",
  resolver: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com",
};

let passed = 0;
let failed = 0;
const failures = [];

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const detail = err instanceof Error ? err.message : String(err);
  failures.push({ name, detail });
  console.error(`  ✗ ${name} — ${detail.slice(0, 220)}`);
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} HTTP ${res.status}`);
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = (set.find((c) => c.startsWith("worktual_token")) || "").split(";")[0];
  if (!cookie) throw new Error(`no cookie ${email}`);
  const body = await res.json();
  return { cookie, user: body.user };
}

async function chat(cookie, message, page = "Home", history = [], options = {}) {
  const res = await fetch(`${BASE}/api/coworker/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      message,
      page,
      session_id:
        options.sessionId ||
        `user-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      history,
      ticket_draft: options.ticketDraft || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

async function api(cookie, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  }
  return body;
}

async function guided(cookie, intent) {
  const res = await fetch(`${BASE}/api/coworker/guided-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      module: "greeting",
      kind: "greeting",
      pageLabel: "Home",
      fallback: intent,
      context: { pageLabel: "Home", scope: "universal" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`guided HTTP ${res.status}`);
  return String(body.reply || "").trim();
}

/** Live chat returns `ui_actions`; some older paths used `actions`. */
function chatActions(body) {
  if (Array.isArray(body?.ui_actions)) return body.ui_actions;
  if (Array.isArray(body?.actions)) return body.actions;
  return [];
}

function navs(body) {
  return chatActions(body)
    .filter((a) => String(a.type).toLowerCase() === "navigate")
    .map((a) => String(a.view));
}
function types(body) {
  return chatActions(body).map((a) => String(a.type).toLowerCase());
}

async function main() {
  console.log("\n=== User scenario smoke (all roles) ===\n");
  const sessions = {};
  for (const [role, email] of Object.entries(USERS)) {
    try {
      sessions[role] = await login(email);
      pass(`login ${role}`, sessions[role].user?.role);
    } catch (e) {
      fail(`login ${role}`, e);
    }
  }

  // Greeting phrase (fast path)
  if (sessions.resolver) {
    try {
      const t0 = Date.now();
      const reply = await guided(
        sessions.resolver.cookie,
        "Greet as the Worktual co-worker in 1–2 short sentences. Ask how you can help."
      );
      const ms = Date.now() - t0;
      if (!reply || /greet as the worktual/i.test(reply)) throw new Error(`bad greeting: ${reply.slice(0, 80)}`);
      if (ms > 8000) throw new Error(`greeting too slow ${ms}ms`);
      pass("login greeting phrase", `${ms}ms · ${reply.slice(0, 50)}`);
    } catch (e) {
      fail("login greeting phrase", e);
    }
  }

  // Queue pressure
  for (const role of ["admin", "agent", "resolver"]) {
    if (!sessions[role]) continue;
    try {
      const body = await chat(sessions[role].cookie, "show queue pressure");
      if (!navs(body).includes("dashboard")) throw new Error(`nav=${JSON.stringify(navs(body))} reply=${(body.reply||"").slice(0,80)}`);
      if (/see the list on the right/i.test(body.reply || "")) throw new Error(`bad list hint: ${body.reply}`);
      if (!/queue pressure|home|dashboard/i.test(body.reply || "")) throw new Error(`reply=${(body.reply||"").slice(0,100)}`);
      pass(`${role}: show queue pressure`, (body.reply || "").slice(0, 60));
    } catch (e) {
      fail(`${role}: show queue pressure`, e);
    }
  }

  // Open tickets for me
  for (const role of ["admin", "agent", "resolver"]) {
    if (!sessions[role]) continue;
    try {
      const body = await chat(sessions[role].cookie, "how many open tickets are there for me?");
      const reply = String(body.reply || "");
      const zeroOk = /\b(no|zero|0)\b.{0,40}\bopen\b.{0,20}\btickets?\b/i.test(reply);
      if (/cannot find|unavailable|system error/i.test(reply) && !/\b\d+\b/.test(reply) && !zeroOk) {
        throw new Error(reply.slice(0, 160));
      }
      if (!/\d+/.test(reply) && !zeroOk) throw new Error(`no count: ${reply.slice(0, 120)}`);
      if (/cannot find any tickets specifically assigned/i.test(reply)) throw new Error(reply.slice(0, 160));
      pass(`${role}: open tickets for me`, reply.slice(0, 80));
    } catch (e) {
      fail(`${role}: open tickets for me`, e);
    }
  }

  // Role-scoped open counts: resolver/agent must not quote org-wide admin total
  {
    const openCounts = {};
    for (const role of ["admin", "agent", "resolver"]) {
      if (!sessions[role]) continue;
      try {
        const body = await chat(sessions[role].cookie, "how many open tickets are there?");
        const reply = String(body.reply || "");
        const m = reply.match(/(\d[\d,]*)\s+open/i) || reply.match(/\*\*(\d[\d,]*)\*\*/) || reply.match(/\b(\d{1,5})\b/);
        if (!m) throw new Error(`no open count: ${reply.slice(0, 140)}`);
        openCounts[role] = Number(String(m[1]).replace(/,/g, ""));
        pass(`${role}: how many open tickets`, `${openCounts[role]} · ${reply.slice(0, 60)}`);
      } catch (e) {
        fail(`${role}: how many open tickets`, e);
      }
    }
    if (
      openCounts.admin != null &&
      openCounts.resolver != null &&
      openCounts.admin > 0 &&
      openCounts.resolver === openCounts.admin
    ) {
      fail(
        "resolver open != org-wide",
        `resolver echoed admin org total ${openCounts.admin} — chat must use assignee scope`
      );
    } else if (openCounts.admin != null && openCounts.resolver != null) {
      pass("resolver open scoped vs admin", `admin=${openCounts.admin} resolver=${openCounts.resolver}`);
    }
    if (
      openCounts.admin != null &&
      openCounts.agent != null &&
      openCounts.admin > 0 &&
      openCounts.agent === openCounts.admin
    ) {
      fail(
        "agent open != org-wide",
        `agent echoed admin org total ${openCounts.admin} — chat must use assignee scope`
      );
    } else if (openCounts.admin != null && openCounts.agent != null) {
      pass("agent open scoped vs admin", `admin=${openCounts.admin} agent=${openCounts.agent}`);
    }
  }

  // Resolver Q&A must not invent customer/team totals
  if (sessions.resolver) {
    try {
      const body = await chat(sessions.resolver.cookie, "how many customers are there?");
      const reply = String(body.reply || "");
      const denied = /can(not|.?t)\s+(use|access|open|create|view)|can’t\s+(use|access|open|create|view)|unable to\s+(initiate|create|access)|don.?t (have|allow|access)|not (have|allowed)|no access|permissions?.{0,40}(don.?t|do not)|restricted/i.test(
        reply
      );
      if (!denied) throw new Error(`expected access deny: ${reply.slice(0, 140)}`);
      pass("resolver: customer count denied", reply.slice(0, 70));
    } catch (e) {
      fail("resolver: customer count denied", e);
    }
  }

  // Show all → right-panel wording
  if (sessions.agent) {
    try {
      const body = await chat(sessions.agent.cookie, "show all", "My Tickets");
      const reply = String(body.reply || "");
      const actions = chatActions(body);
      const hasFilter = actions.some(
        (a) => String(a.type).toLowerCase() === "set_filter" && a.module === "tickets"
      );
      if (!hasFilter) throw new Error(`actions=${JSON.stringify(actions)} reply=${reply.slice(0,80)}`);
      if (!/right/i.test(reply) && !/showing all/i.test(reply) && !/found\s+\*\*\d+/i.test(reply) && !/\*\*\d+\*\*.*ticket/i.test(reply)) {
        throw new Error(`expected list ack: ${reply.slice(0, 100)}`);
      }
      pass("agent: show all tickets", reply.slice(0, 70));
    } catch (e) {
      fail("agent: show all tickets", e);
    }
  }

  // Escalate without number → ask which
  for (const role of ["agent", "resolver"]) {
    if (!sessions[role]) continue;
    try {
      const body = await chat(sessions[role].cookie, "escalate ticket", "My Tickets");
      const reply = String(body.reply || "");
      if (!/which ticket|ticket number|which one|provide.{0,20}ticket|ticket (id|to escalate)/i.test(reply)) {
        throw new Error(`expected which-ticket: ${reply.slice(0, 140)}`);
      }
      if (types(body).includes("escalate")) throw new Error("escalate applied too early");
      pass(`${role}: escalate asks which ticket`, reply.slice(0, 70));
    } catch (e) {
      fail(`${role}: escalate asks which ticket`, e);
    }
  }

  // Reassign without number → ask which
  if (sessions.agent) {
    try {
      const body = await chat(sessions.agent.cookie, "reassign tickets", "My Tickets");
      if (!/which ticket|ticket number|which one|provide.{0,20}ticket|ticket (id|to (escalate|reassign))/i.test(String(body.reply || ""))) {
        throw new Error(`expected which-ticket: ${String(body.reply || "").slice(0, 140)}`);
      }
      if (types(body).includes("escalate")) throw new Error("escalate applied too early");
      pass("agent: reassign asks which ticket");
    } catch (e) {
      fail("agent: reassign asks which ticket", e);
    }
  }

  // Resolver denied modules
  if (sessions.resolver) {
    for (const [msg, label] of [
      ["show customers", "Customers"],
      ["open analytics", "Analytics"],
      ["open teams", "Teams"],
      ["create ticket", "create"],
    ]) {
      try {
        const body = await chat(sessions.resolver.cookie, msg);
        const reply = String(body.reply || "");
        const denied = /can(not|.?t)\s+(use|access|open|create|view)|can’t\s+(use|access|open|create|view)|unable to\s+(initiate|create|access|open|view)|don.?t (have|allow|access)|not (have|allowed)|no access|permissions?.{0,40}(don.?t|do not)|restricted/i.test(
          reply
        );
        const badNav = navs(body).some((v) =>
          ["customers", "analytics", "agent-queues", "create-ticket"].includes(v)
        );
        if (!denied || badNav) throw new Error(`reply=${reply.slice(0,120)} nav=${JSON.stringify(navs(body))}`);
        pass(`resolver deny: ${msg}`);
      } catch (e) {
        fail(`resolver deny: ${msg}`, e);
      }
    }
  }

  // Resolver allowed modules
  if (sessions.resolver) {
    for (const [msg, view] of [
      ["go to search", "search"],
      ["open work board", "work-board"],
      ["open knowledge base", "kb"],
      ["open settings", "settings"],
      ["my tickets", "assigned"],
    ]) {
      try {
        const body = await chat(sessions.resolver.cookie, msg);
        if (!navs(body).includes(view)) {
          throw new Error(`expected ${view}, got ${JSON.stringify(navs(body))} · ${(body.reply||"").slice(0,80)}`);
        }
        pass(`resolver nav: ${msg}`, view);
      } catch (e) {
        fail(`resolver nav: ${msg}`, e);
      }
    }
  }

  // High priority filter + pending escalate must not swallow filters
  if (sessions.resolver) {
    try {
      const body = await chat(sessions.resolver.cookie, "show high priority tickets", "My Tickets");
      const actions = chatActions(body);
      const hasFilter = actions.some(
        (a) => String(a.type).toLowerCase() === "set_filter" && String(a.priority || "").toLowerCase() === "high"
      );
      if (!hasFilter) throw new Error(`actions=${JSON.stringify(actions)} reply=${(body.reply||"").slice(0,100)}`);
      pass("resolver: high priority filter");
    } catch (e) {
      fail("resolver: high priority filter", e);
    }
  }

  // Escalate with explicit ticket → ask who (not apply yet)
  if (sessions.agent) {
    try {
      // Use a number from which-ticket list if possible
      const ask = await chat(sessions.agent.cookie, "escalate ticket", "My Tickets");
      const m = String(ask.reply || "").match(/#(\d{4,})/);
      if (!m) throw new Error(`no ticket in ask list: ${String(ask.reply||"").slice(0,120)}`);
      const tn = m[1];
      const who = await chat(
        sessions.agent.cookie,
        tn,
        "My Tickets",
        [
          { role: "user", text: "escalate ticket" },
          { role: "assistant", text: ask.reply },
        ]
      );
      const reply = String(who.reply || "");
      if (!/who should|escalate (this )?to|which (agent|resolver|person|assignee|team member)|who.{0,40}(handle|own|take|assign)/i.test(reply)) {
        throw new Error(`expected who-ask: ${reply.slice(0, 160)}`);
      }
      if (types(who).includes("escalate")) throw new Error("escalate applied before who");
      pass("agent: escalate ticket# → ask who", `#${tn}`);
    } catch (e) {
      fail("agent: escalate ticket# → ask who", e);
    }
  }

  // Stateful conversational engine: park Create Ticket, execute a live ticket
  // side quest, then resume from LangGraph state (even with a stale UI draft).
  if (sessions.agent) {
    try {
      const cookie = sessions.agent.cookie;
      const directoryRows = await api(cookie, "/api/customers");
      let customer = (Array.isArray(directoryRows) ? directoryRows : []).find(
        (row) =>
          row &&
          (row.id || row.customerId) &&
          row.name &&
          (row.email || row.phone)
      );
      if (!customer) {
        const token = randomUUID();
        customer = await api(cookie, "/api/customers", {
          method: "POST",
          body: JSON.stringify({
            name: `Customer-${token}`,
            email: `customer-${token}@example.test`,
          }),
        });
      }
      const liveTickets = await api(cookie, "/api/tickets");
      const liveRows = Array.isArray(liveTickets) ? liveTickets : [];
      const liveIds = new Set(
        liveRows
          .map((row) => String(row?.ticketNumber || row?.ticket_number || row?.id || ""))
          .filter(Boolean)
      );

      const sessionId = `side-quest-${randomUUID()}`;
      const history = [];
      let activeDraft = null;
      const turn = async (message, ticketDraft = activeDraft) => {
        const body = await chat(cookie, message, "Create Ticket", history, {
          sessionId,
          ticketDraft,
        });
        history.push({ role: "user", text: message });
        history.push({ role: "assistant", text: String(body.reply || "") });
        if (body?.data && Object.prototype.hasOwnProperty.call(body.data, "ticket_draft")) {
          activeDraft = body.data.ticket_draft;
        }
        return body;
      };

      const started = await turn("Create a ticket");
      if (!started?.data?.ticket_draft) {
        throw new Error(`workflow did not start: ${String(started.reply || "").slice(0, 140)}`);
      }

      const contact = String(customer.email || customer.phone || "");
      const identified = await turn(
        `The customer is ${String(customer.name)}. Their contact is ${contact}.`
      );
      if (!identified?.data?.ticket_draft) {
        throw new Error(`customer fields not retained: ${String(identified.reply || "").slice(0, 140)}`);
      }

      const issue = "Login is broken for this customer.";
      const described = await turn(issue);
      const preParkDraft = described?.data?.ticket_draft;
      if (
        !preParkDraft ||
        !preParkDraft.customerName ||
        !(preParkDraft.customerEmail || preParkDraft.customerPhone) ||
        !preParkDraft.issue
      ) {
        throw new Error(`ticket fields incomplete before park: ${JSON.stringify(preParkDraft)}`);
      }

      const side = await turn(
        "Could you show the tickets assigned to me before I finish this?"
      );
      if (side?.data?.ticket_draft !== null) {
        throw new Error(`ticket remained active: ${JSON.stringify(side?.data?.ticket_draft)}`);
      }
      if (!(side?.data?.parked_drafts || []).some((item) => item?.flow === "ticket")) {
        throw new Error(`ticket was not parked: ${JSON.stringify(side?.data?.parked_drafts)}`);
      }
      if (!navs(side).includes("assigned")) {
        throw new Error(`live list did not navigate: ${JSON.stringify(chatActions(side))}`);
      }
      if (
        !chatActions(side).some(
          (action) =>
            String(action.type).toLowerCase() === "set_filter" &&
            action.module === "tickets"
        )
      ) {
        throw new Error(`live list filter missing: ${JSON.stringify(chatActions(side))}`);
      }
      if (side?.data?._tool_name !== "list_tickets") {
        throw new Error(`ticket list tool did not run: ${JSON.stringify(side?.data)}`);
      }
      const toolPayload = side.data.payload;
      const toolRows = Array.isArray(toolPayload)
        ? toolPayload
        : Array.isArray(toolPayload?.data)
          ? toolPayload.data
          : [];
      if (
        liveIds.size > 0 &&
        !toolRows.some((row) =>
          liveIds.has(String(row?.ticketNumber || row?.ticket_number || row?.id || ""))
        )
      ) {
        throw new Error("tool result did not contain live Postgres ticket rows");
      }

      // Deliberately send the stale pre-park React snapshot. The server
      // checkpointer must still win and resume rather than restart.
      const resumed = await turn("Continue the workflow.", preParkDraft);
      const resumedDraft = resumed?.data?.ticket_draft;
      if (!resumedDraft || resumed?.data?.workflow !== "create_ticket") {
        throw new Error(`workflow did not resume: ${JSON.stringify(resumed?.data)}`);
      }
      for (const key of [
        "customerId",
        "customerName",
        "customerEmail",
        "customerPhone",
        "issue",
      ]) {
        if (String(resumedDraft[key] || "") !== String(preParkDraft[key] || "")) {
          throw new Error(`field ${key} changed across park/resume`);
        }
      }
      if (resumedDraft.awaiting !== "confirm") {
        throw new Error(`resume asked wrong field: ${JSON.stringify(resumedDraft)}`);
      }
      pass("agent: create → live side quest → resume", resumedDraft.awaiting);
    } catch (e) {
      fail("agent: create → live side quest → resume", e);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(` - ${f.name}: ${f.detail.slice(0, 200)}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
