#!/usr/bin/env node
/**
 * Product E2E — covers the gaps fake-LLM suites missed.
 *
 * Requires: Express :3001 + ai-agents :8012 + reachable DATABASE_URL.
 *
 * Covers:
 *  1. Intent typos (my tickets / assigned to me)
 *  2. Assignee scope (id OR name) — seed + list must include
 *  3. Unassigned / team / org RBAC by role
 *  4. Create ticket + enrich
 *  5. Escalate to resolver
 *  6. Coworker chat (history memory + my-tickets live path)
 *  7. Guided phrase / ticket-reason
 *  8. AI insights (Python proxy)
 *  9. Module list APIs per role
 * 10. SPA shell
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const AGENTS = (process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012").replace(
  /\/$/,
  ""
);
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";

const USERS = {
  admin: { email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com", role: "admin" },
  agent: { email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com", role: "agent" },
  resolver: { email: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com", role: "resolver" },
};

let cookie = "";
let passed = 0;
let failed = 0;
const failures = [];

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  const detail = err?.message || String(err);
  failures.push({ name, detail });
  console.error(`  ✗ ${name} — ${detail}`);
}

async function api(pathName, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${pathName}`, { ...options, headers });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const part = c.split(";")[0];
    if (part.startsWith("worktual_token=")) cookie = part;
  }
  const raw = res.headers.get("set-cookie");
  if (raw?.includes("worktual_token=")) cookie = raw.split(";")[0];
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

async function login(email) {
  cookie = "";
  const { status, body } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (status !== 200 || !cookie) {
    throw new Error(`login ${status}: ${JSON.stringify(body)}`);
  }
  return body.user;
}

async function ensureDirectoryCustomer() {
  const listed = await api("/api/customers");
  const rows = Array.isArray(listed.body) ? listed.body : [];
  const hit = rows.find((c) => (c?.email || c?.phone) && (c?.id || c?.customerId));
  if (hit) {
    return {
      id: String(hit.id || hit.customerId || ""),
      name: String(hit.name || "Directory Customer"),
      email: String(hit.email || ""),
      phone: String(hit.phone || ""),
    };
  }
  const email = `dir.${Date.now()}@test.local`;
  const created = await api("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Directory Customer",
      email,
      phone: "5550100123",
    }),
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(
      `directory customer missing (list ${listed.status}, create ${created.status})`
    );
  }
  const c = created.body || {};
  return {
    id: String(c.id || c.customerId || ""),
    name: String(c.name || "Directory Customer"),
    email: String(c.email || email),
    phone: String(c.phone || "5550100123"),
  };
}

function section(title) {
  console.log(`\n=== ${title} ===\n`);
}

/* -------------------------------------------------------------------------- */
/* 1. Intent unit (no server)                                                 */
/* -------------------------------------------------------------------------- */
function testIntentsOffline() {
  section("1. Chat intents (offline)");
  const script = `
    import { routeCoworkerIntent } from './ui-frontend/src/components/coworker/coworkerIntent.ts';
    import { compactStackedAssistantIntros, decideModuleGreeting, UNIVERSAL_COWORKER_GREETING_INTENT } from './ui-frontend/src/components/coworker/moduleGreetingPolicy.ts';
    import { inferCoworkerUiActionsFallback, normalizeCoworkerUiActions } from './ui-frontend/src/components/coworker/coworkerActions.ts';
    const agentOwned = [
      'show tickes assigend to me',
      'show tickets assigned to me',
      'my tickets',
      'unassigned tickets',
      'create ticket',
    ];
    for (const text of agentOwned) {
      if (routeCoworkerIntent(text, 'home') !== null) bad.push(text + ' should be agent-owned');
    }
    const cases = [
      ['update ticket status', 'tickets-list'],
      ['change ticket status', 'tickets-list'],
    ];
    let bad = [];
    for (const [text, nav] of cases) {
      const r = routeCoworkerIntent(text, 'home');
      if (nav && r?.navigate !== nav) bad.push(text + ' => ' + (r?.navigate||'null'));
      if (text.includes('status') && r?.ticketSearch) bad.push(text + ' bogus search=' + r.ticketSearch);
    }
    // Create/list/search are LangGraph-owned, including typos and role checks.
    const c = routeCoworkerIntent('craete ticket', 'home', 'agent');
    if (c !== null) bad.push('craete ticket should be agent-owned');
    const resolverCreate = routeCoworkerIntent('create ticket', 'home', 'resolver');
    if (resolverCreate?.ticketCreate || resolverCreate?.navigate === 'create-ticket') {
      bad.push('resolver must not enter create-ticket flow');
    }
    const resolverCust = routeCoworkerIntent('show customers', 'home', 'resolver');
    if (resolverCust?.navigate === 'customers') bad.push('resolver must not open customers');
    const agentCreate = routeCoworkerIntent('create ticket', 'home', 'agent');
    if (agentCreate !== null) bad.push('agent create ticket should be agent-owned');

    // "list all" must CLEAR search — never use the phrase as a filter token
    const listCust = routeCoworkerIntent('list all', 'customers');
    if (!listCust || listCust.customerSearch !== '') bad.push('list all on customers must clear customerSearch');
    if (listCust?.customerSearch && listCust.customerSearch.length > 0) bad.push('list all leaked filter');
    const listAllCust = routeCoworkerIntent('list all customers', 'home');
    if (!listAllCust || listAllCust.customerSearch !== '' || listAllCust.navigate !== 'customers') {
      bad.push('list all customers');
    }
    const listTickets = routeCoworkerIntent('list all', 'assigned');
    if (listTickets !== null) bad.push('list all on tickets should be agent-owned');
    const showAll = routeCoworkerIntent('show all', 'kb');
    if (!showAll || showAll.kbSearch !== '') bad.push('show all on kb must clear kbSearch');
    const clearF = routeCoworkerIntent('clear filter', 'customers');
    if (!clearF || clearF.customerSearch !== '') bad.push('clear filter on customers');
    // Soft-search dump removed: raw "Acme Corp" on customers must NOT become a filter via intent
    const soft = routeCoworkerIntent('Acme Corp xyz', 'customers');
    if (soft?.customerSearch === 'Acme Corp xyz') bad.push('soft-search dump still active');

    // Action catalog fallback: list all clears; never uses utterance as query
    const act = inferCoworkerUiActionsFallback('list all', 'customers');
    if (!act.actions.some(a => a.type === 'set_filter' && a.module === 'customers' && a.query === '')) {
      bad.push('ui action list all');
    }
    const everyone = inferCoworkerUiActionsFallback('show everyone', 'customers');
    if (!everyone.actions.some(a => a.type === 'set_filter' && a.query === '')) bad.push('show everyone');
    const norm = normalizeCoworkerUiActions([
      { type: 'set_filter', module: 'customers', query: 'list all' },
    ]);
    if (norm[0]?.query !== '') bad.push('normalize must blank list-all query');

    // Faceted set_filter (status / priority / channel / customer status)
    const facet = inferCoworkerUiActionsFallback('open urgent tickets', 'dashboard');
    if (facet.actions.length) bad.push('open urgent tickets should be agent-owned');
    const high = inferCoworkerUiActionsFallback('high priority tickets', 'assigned');
    if (high.actions.length) bad.push('high priority tickets should be agent-owned');
    const pending = inferCoworkerUiActionsFallback('pending tickets', 'team-inbox');
    if (pending.actions.length) bad.push('pending tickets should be agent-owned');
    const active = inferCoworkerUiActionsFallback('show active customers', 'customers');
    if (!active.actions.some(a => a.type === 'set_filter' && a.status === 'Active')) bad.push('active customers facet');
    const inactive = inferCoworkerUiActionsFallback('show inactive customers', 'kb');
    if (!inactive.actions.some(a => a.type === 'navigate' && a.view === 'customers')) bad.push('inactive customers navigate');
    if (!inactive.actions.some(a => a.type === 'set_filter' && a.status === 'Inactive')) bad.push('inactive customers facet');
    const qNoFacet = inferCoworkerUiActionsFallback('how many open tickets?', 'assigned');
    if (qNoFacet.actions.length) bad.push('question must not facet-filter');
    const facetNorm = normalizeCoworkerUiActions([
      { type: 'set_filter', module: 'tickets', query: '', status: 'open', priority: 'P1', channel: 'email' },
    ])[0];
    if (facetNorm?.status !== 'Open' || facetNorm?.priority !== 'urgent' || facetNorm?.channel !== 'Email') {
      bad.push('normalize ticket facets');
    }

    // Universal initial greeting only (covers all modules); no per-module intros on switch.
    const g = (n, pages) => decideModuleGreeting({ messageCount: n, greetedPages: pages });
    if (g(0, []) !== 'greet') bad.push('empty → greet');
    if (g(3, ['__initial__']) !== 'skip') bad.push('after greeting → skip');
    if (g(3, ['Home']) !== 'skip') bad.push('legacy greeted page → skip');
    if (g(3, []) !== 'skip_and_mark') bad.push('legacy restore → skip_and_mark');
    if (g(4, ['__initial__']) !== 'skip') bad.push('module switch with history → skip');
    if (g(0, ['__initial__']) !== 'greet') bad.push('cleared transcript → greet');
    const stacked = [
      { role: 'assistant', text: 'Welcome A' },
      { role: 'assistant', text: 'Welcome B' },
      { role: 'assistant', text: 'Welcome C' },
    ];
    const compacted = compactStackedAssistantIntros(stacked);
    if (compacted.length !== 1 || compacted[0].text !== 'Welcome C') bad.push('compact stacked intros');
    const withUser = compactStackedAssistantIntros([
      { role: 'assistant', text: 'Hi' },
      { role: 'user', text: 'help' },
      { role: 'assistant', text: 'ok' },
    ]);
    if (withUser.length !== 3) bad.push('compact must keep user history');
    if (!UNIVERSAL_COWORKER_GREETING_INTENT.toLowerCase().includes('tickets')) {
      bad.push('universal greeting should mention modules');
    }

    if (bad.length) { console.error(JSON.stringify(bad)); process.exit(1); }
    console.log('ok');
  `;
  const r = spawnSync(
    "npx",
    ["--yes", "tsx", "-e", script],
    { cwd: ROOT, encoding: "utf8", env: process.env }
  );
  if (r.status === 0 && (r.stdout || "").includes("ok")) {
    pass("intent typos → assigned / create");
    pass("module greeting policy (universal initial only)");
  } else {
    fail("intent / greeting policy", new Error((r.stderr || r.stdout || "tsx failed").slice(0, 400)));
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Health                                                                  */
/* -------------------------------------------------------------------------- */
async function testHealth() {
  section("2. Health (Express + Python)");
  try {
    const { status, body } = await api("/api/health");
    if (status !== 200 || body?.status !== "ok") throw new Error(JSON.stringify(body));
    pass("Express /api/health", `db=${body.db}`);
  } catch (e) {
    fail("Express /api/health", e);
  }
  try {
    const res = await fetch(`${AGENTS}/health`);
    const body = await res.json();
    if (!res.ok || body.status !== "ok") throw new Error(JSON.stringify(body));
    pass("Python /health", `model=${body.model}`);
  } catch (e) {
    fail("Python /health", e);
  }
}

/* -------------------------------------------------------------------------- */
/* 3. SPA                                                                     */
/* -------------------------------------------------------------------------- */
async function testSpa() {
  section("3. Frontend SPA");
  try {
    const res = await fetch(BASE + "/");
    const html = await res.text();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (!html.includes('id="root"') && !html.includes("id='root'")) {
      throw new Error("missing #root");
    }
    pass("GET / shell");
    const need = [
      "TicketsView",
      "CreateTicketView",
      "WorkBoardView",
      "CoworkerChatPanel",
    ];
    const missing = need.filter(
      (n) =>
        !fs.existsSync(path.join(ROOT, "ui-frontend/src/components", `${n}.tsx`)) &&
        !fs.existsSync(path.join(ROOT, "ui-frontend/src/components/coworker", `${n}.tsx`))
    );
    if (missing.length) throw new Error(`missing ${missing.join(",")}`);
    pass("critical UI modules on disk");
  } catch (e) {
    fail("SPA", e);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Role RBAC + scopes                                                      */
/* -------------------------------------------------------------------------- */
async function testRoleScopes() {
  section("4. Role RBAC + ticket scopes");

  const matrix = [
    {
      key: "agent",
      paths: {
        "/api/tickets": 200,
        "/api/tickets?scope=assignee": 200,
        "/api/tickets?scope=team": 200,
        "/api/tickets?scope=unassigned": 200,
        "/api/tickets?scope=org": 403,
        "/api/analytics?range=7days": 403,
        "/api/customers": 200,
      },
    },
    {
      key: "resolver",
      paths: {
        "/api/tickets?scope=assignee": 200,
        "/api/tickets?scope=team": 403,
        "/api/tickets?scope=unassigned": 403,
        "/api/tickets?scope=org": 403,
        "/api/customers": 403,
      },
    },
    {
      key: "admin",
      paths: {
        "/api/tickets?scope=org": 200,
        "/api/tickets?scope=assignee": 200,
        "/api/tickets?scope=unassigned": 200,
        "/api/analytics?range=7days": 200,
        "/api/audit": 200,
      },
    },
  ];

  for (const row of matrix) {
    try {
      const user = await login(USERS[row.key].email);
      if (user.role !== USERS[row.key].role) {
        throw new Error(`role ${user.role}`);
      }
      pass(`${row.key} login`, user.name);
      for (const [p, want] of Object.entries(row.paths)) {
        const { status, body } = await api(p);
        if (status !== want) {
          throw new Error(`${p} expected ${want} got ${status}`);
        }
        const n = Array.isArray(body) ? ` · ${body.length}` : "";
        pass(`${row.key} ${p}`, `HTTP ${status}${n}`);
      }

      if (row.key === "agent" || row.key === "admin") {
        const un = await api("/api/tickets?scope=unassigned");
        if (un.status === 200 && Array.isArray(un.body)) {
          const bad = un.body.filter(
            (t) => t.assignee && t.assignee !== "Unassigned"
          );
          if (bad.length) {
            throw new Error(
              `assigned tickets in unassigned: ${bad
                .slice(0, 3)
                .map((t) => `${t.id}:${t.assignee}`)
                .join(", ")}`
            );
          }
          pass(`${row.key} unassigned integrity`, `${un.body.length} rows`);
        }
      }
    } catch (e) {
      fail(`${row.key} scopes`, e);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 5. My tickets regression (THE bug you hit)                                 */
/* -------------------------------------------------------------------------- */
async function testMyTicketsRegression() {
  section("5. My tickets / assignee regression");

  let user;
  try {
    user = await login(USERS.agent.email);
    pass("agent for my-tickets", user.name);
  } catch (e) {
    fail("agent login (my-tickets)", e);
    return;
  }

  let ticketId = null;
  try {
    const queues = await api("/api/queues");
    const qName =
      (Array.isArray(queues.body) &&
        (queues.body[0]?.queueName || queues.body[0]?.name)) ||
      "";
    const cust = await ensureDirectoryCustomer();
    const created = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: `E2E my-tickets ${Date.now()}`,
        description: "product-e2e assignee regression",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        channel: "Web",
        priority: "high",
        assignee: user.name,
        assigneeId: user.id,
        queue: qName,
      }),
    });
    if (created.status !== 201) {
      throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
    }
    ticketId = created.body.id;
    pass("create ticket assigned to agent", ticketId);

    // Force name-only match path: clear id via PUT keeping name (if API allows)
    const put = await api(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: "PUT",
      body: JSON.stringify({ assignee: user.name }),
    });
    if (put.status !== 200) throw new Error(`PUT ${put.status}`);
    pass("ensure assignee name set", put.body?.assignee);

    const mine = await api("/api/tickets?scope=assignee");
    if (mine.status !== 200 || !Array.isArray(mine.body)) {
      throw new Error(`assignee list ${mine.status}`);
    }
    const hit = mine.body.find((t) => t.id === ticketId);
    if (!hit) {
      throw new Error(
        `created ${ticketId} missing from assignee scope (n=${mine.body.length})`
      );
    }
    if (hit.assignee !== user.name) {
      throw new Error(`assignee mismatch ${hit.assignee}`);
    }
    pass("GET scope=assignee includes seeded ticket", `${mine.body.length} total`);

    // Default list for agent should also be assignee-scoped
    const def = await api("/api/tickets");
    const hit2 = Array.isArray(def.body) && def.body.find((t) => t.id === ticketId);
    if (!hit2) throw new Error("default /api/tickets missing seeded ticket");
    pass("default tickets list includes mine");

    // Name-only ticket: assign by name without relying on id equality in list filter
    const nameOnly = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: `E2E name-only ${Date.now()}`,
        description: "assignee name without perfect id path",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        channel: "Web",
        priority: "medium",
        assignee: user.name,
        queue: qName,
      }),
    });
    if (nameOnly.status !== 201) {
      throw new Error(`name-only create ${nameOnly.status}`);
    }
    const mine2 = await api("/api/tickets?scope=assignee");
    const hit3 = mine2.body?.find((t) => t.id === nameOnly.body.id);
    if (!hit3) {
      throw new Error("name-assigned ticket not in assignee scope");
    }
    pass("name-matched assignee visible in scope", nameOnly.body.id);
  } catch (e) {
    fail("my-tickets regression", e);
  }

  // Chat module details path (same API chat UI uses after intent)
  try {
    const { fetchChatModuleDetails } = await import(
      "../ui-frontend/src/components/coworker/chatModuleDetails.ts"
    );
    const details = await fetchChatModuleDetails({
      navigate: "assigned",
      resolvedView: "assigned",
      cookie,
    });
    if (!details) throw new Error("null details");
    if (typeof details.listCount !== "number") throw new Error("no listCount");
    // After seeding, must be > 0 for this agent
    if (details.listCount < 1) {
      throw new Error(`assigned listCount=${details.listCount} (expected ≥1)`);
    }
    pass("fetchChatModuleDetails(assigned)", `${details.listCount} tickets`);
  } catch (e) {
    fail("fetchChatModuleDetails(assigned)", e);
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Enrich + escalate                                                       */
/* -------------------------------------------------------------------------- */
async function testEnrichEscalate() {
  section("6. Enrich + escalate");

  let agent;
  try {
    agent = await login(USERS.agent.email);
  } catch (e) {
    fail("enrich login", e);
    return;
  }

  let ticketId = null;
  try {
    const enrich = await api("/api/tickets/enrich", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Enrich Cust",
        customerEmail: `enrich.${Date.now()}@test.local`,
        issue: "VPN cannot connect to office network",
      }),
    });
    if (enrich.status !== 200) {
      throw new Error(`enrich ${enrich.status} ${JSON.stringify(enrich.body)}`);
    }
    if (!enrich.body?.subject || !enrich.body?.assignee) {
      throw new Error("enrich missing subject/assignee");
    }
    pass(
      "POST /api/tickets/enrich",
      `${enrich.body.subject} → ${enrich.body.assignee}`
    );

    const queues = await api("/api/queues");
    const qName =
      (Array.isArray(queues.body) &&
        (queues.body[0]?.queueName || queues.body[0]?.name)) ||
      enrich.body.queue ||
      "";
    const cust = await ensureDirectoryCustomer();
    const created = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: enrich.body.subject || `E2E escalate ${Date.now()}`,
        description: enrich.body.description || "vpn escalate e2e",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        channel: "Web",
        priority: enrich.body.priority || "high",
        assignee: agent.name,
        assigneeId: agent.id,
        queue: qName || undefined,
      }),
    });
    if (created.status !== 201) {
      // Retry bare create (queue mismatch can 500 on some orgs)
      const retry = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: `E2E escalate ${Date.now()}`,
          description: "vpn escalate e2e",
          customerId: cust.id || undefined,
          customerName: cust.name,
          customerEmail: cust.email || undefined,
          customerPhone: cust.phone || undefined,
          channel: "Web",
          priority: "high",
          assignee: agent.name,
          assigneeId: agent.id,
        }),
      });
      if (retry.status !== 201) {
        throw new Error(
          `create ${created.status}/${retry.status} ${JSON.stringify(retry.body)}`
        );
      }
      ticketId = retry.body.id;
    } else {
      ticketId = created.body.id;
    }
    pass("ticket for escalate", ticketId);

    const esc = await api(`/api/tickets/${encodeURIComponent(ticketId)}/escalate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (esc.status !== 200) {
      throw new Error(`escalate ${esc.status} ${JSON.stringify(esc.body)}`);
    }
    if (!esc.body?.resolver && !esc.body?.ticket?.resolver) {
      throw new Error("no resolver after escalate");
    }
    const agentKept = esc.body?.assignee || esc.body?.ticket?.assignee;
    if (agentKept && String(agentKept) !== String(agent.name)) {
      // Agent create forces L1 = creator; escalate must keep L1
      throw new Error(
        `escalate cleared L1 agent: expected ${agent.name}, got ${agentKept}`
      );
    }
    pass(
      "POST escalate",
      `agent ${agentKept || agent.name} kept → resolver ${esc.body.resolver || esc.body.ticket?.resolver}`
    );
  } catch (e) {
    fail("enrich/escalate", e);
  }
}

/* -------------------------------------------------------------------------- */
/* 7. Coworker chat + guided + insights                                       */
/* -------------------------------------------------------------------------- */
async function testCoworkerStack() {
  section("7. Coworker chat / phrase / insights");

  let user;
  try {
    user = await login(USERS.agent.email);
  } catch (e) {
    fail("chat login", e);
    return;
  }

  try {
    const history = [
      { role: "user", text: "create ticket" },
      { role: "assistant", text: "Customer name?" },
      { role: "user", text: "manoj" },
      { role: "assistant", text: "Got **manoj**. Email?" },
      { role: "user", text: "what is my name?" },
    ];
    const { status, body } = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "what is my name?",
        page: "Create Ticket",
        session_id: `e2e-mem-${Date.now()}`,
        history,
      }),
    });
    if (status !== 200) throw new Error(`chat ${status} ${JSON.stringify(body)}`);
    if (!String(body.reply || "").toLowerCase().includes("manoj")) {
      throw new Error(`memory miss: ${body.reply}`);
    }
    pass("chat memory name recall", body.agent);
  } catch (e) {
    fail("chat memory", e);
  }

  try {
    // Ground truth from API first
    const mine = await api("/api/tickets?scope=assignee");
    const openMine = Array.isArray(mine.body)
      ? mine.body.filter((t) => String(t.status || "").toLowerCase() !== "resolved")
      : [];
    pass("assignee ground truth before chat", `${openMine.length} open`);

    const { status, body } = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "show tickes assigend to me",
        page: "Home",
        session_id: `e2e-mine-${Date.now()}`,
        history: [{ role: "user", text: "show tickes assigend to me" }],
      }),
    });
    if (status !== 200) throw new Error(`chat ${status}`);
    const reply = String(body.reply || "").toLowerCase();
    if (reply.includes("database error") || reply.includes("temporarily unavailable")) {
      throw new Error("DB error in reply");
    }
    // If API has open assigned tickets, chat must not claim zero
    if (openMine.length > 0) {
      const claimsZero =
        /(couldn'?t find any tickets assigned|could not find any tickets assigned|no tickets (are )?assigned|0 tickets assigned|you have \*\*0\*\*|you have 0 )/i.test(
          reply
        );
      if (claimsZero) {
        throw new Error(
          `chat claimed empty but API has ${openMine.length} assigned: ${reply.slice(0, 160)}`
        );
      }
      // Must not under-report total when live data provides it (sample ≠ total)
      const m = reply.match(/\b(\d+)\s+(open\s+)?tickets?\s+assigned\b/);
      if (m) {
        const stated = Number(m[1]);
        if (Number.isFinite(stated) && stated > 0 && stated < Math.min(openMine.length, 15)) {
          // stating fewer than sample size is clearly wrong
          throw new Error(
            `chat under-count ${stated} vs API ${openMine.length}: ${reply.slice(0, 160)}`
          );
        }
      }
    }
    pass("chat typo my-tickets (agents path)", reply.slice(0, 80));
  } catch (e) {
    fail("chat typo my-tickets", e);
  }

  try {
    const phrase = await api("/api/coworker/guided-reply", {
      method: "POST",
      body: JSON.stringify({
        module: "greeting",
        kind: "chitchat",
        userText: "hi",
        pageLabel: "Home",
        fallback: "STATIC_SEED_MUST_NOT_ECHO_E2E",
      }),
    });
    if (phrase.status !== 200) throw new Error(`phrase ${phrase.status}`);
    if (String(phrase.body?.reply || "").includes("STATIC_SEED_MUST_NOT_ECHO_E2E")) {
      throw new Error("phrase echoed seed");
    }
    pass("guided-reply phrase", String(phrase.body.reply).slice(0, 60));
  } catch (e) {
    fail("guided-reply", e);
  }

  try {
    const reason = await api("/api/coworker/ticket-reason", {
      method: "POST",
      body: JSON.stringify({
        userText: "manoj",
        stepId: "customerName",
        fallbackReply: "name?",
      }),
    });
    if (reason.status !== 200) throw new Error(`reason ${reason.status}`);
    if (!reason.body?.intent || !reason.body?.reply) {
      throw new Error(JSON.stringify(reason.body));
    }
    pass("ticket-reason", `${reason.body.intent}`);
  } catch (e) {
    fail("ticket-reason", e);
  }

  try {
    const insights = await api("/api/ai-insights", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (insights.status !== 200) throw new Error(`insights ${insights.status}`);
    if (!Array.isArray(insights.body?.insights) || !insights.body.insights.length) {
      throw new Error("empty insights");
    }
    pass("ai-insights", `${insights.body.insights.length} · ${insights.body.source || ""}`);
  } catch (e) {
    fail("ai-insights", e);
  }

  // Structured UI actions — list-all + facets via Express proxy
  try {
    const listAll = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({ message: "list all", page: "Customers" }),
    });
    if (listAll.status !== 200) throw new Error(`ui-actions ${listAll.status}`);
    if (
      !listAll.body?.actions?.some(
        (a) => a.type === "set_filter" && a.module === "customers" && a.query === ""
      )
    ) {
      throw new Error(JSON.stringify(listAll.body?.actions));
    }
    pass("ui-actions list all customers");

    const urgent = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({ message: "open urgent tickets", page: "Home" }),
    });
    if (urgent.status !== 200) throw new Error(`urgent ${urgent.status}`);
    if ((urgent.body?.actions || []).length !== 0) {
      throw new Error(JSON.stringify(urgent.body?.actions));
    }
    pass("ui-actions ticket semantics deferred to LangGraph");

    const urgentChat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "open urgent tickets",
        page: "Home",
        session_id: `e2e-urgent-${Date.now()}`,
      }),
    });
    if (urgentChat.status !== 200) throw new Error(`urgent chat ${urgentChat.status}`);
    const uf = (urgentChat.body?.ui_actions || []).find(
      (a) => a.type === "set_filter" && a.module === "tickets"
    );
    if (!uf || uf.status !== "Open" || uf.priority !== "urgent") {
      throw new Error(JSON.stringify(urgentChat.body?.ui_actions));
    }
    pass("LangGraph open urgent tickets", JSON.stringify(uf));

    const active = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({ message: "show active customers", page: "Customers" }),
    });
    if (active.status !== 200) throw new Error(`active ${active.status}`);
    if (
      !active.body?.actions?.some(
        (a) => a.type === "set_filter" && a.module === "customers" && a.status === "Active"
      )
    ) {
      throw new Error(JSON.stringify(active.body?.actions));
    }
    pass("ui-actions active customers");

    const q = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({
        message: "how many open tickets are there?",
        page: "Tickets",
      }),
    });
    if (q.status !== 200) throw new Error(`Q ${q.status}`);
    if ((q.body?.actions || []).length !== 0) {
      throw new Error(`question leaked filters: ${JSON.stringify(q.body.actions)}`);
    }
    pass("ui-actions question no filter");
  } catch (e) {
    fail("ui-actions facets", e);
  }

  // Resolver must not start create-ticket via chat
  try {
    const resolver = await login(USERS.resolver.email);
    const { status, body } = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "create ticket",
        page: "Home",
        session_id: `e2e-resolver-create-${Date.now()}`,
        history: [{ role: "user", text: "create ticket" }],
      }),
    });
    if (status !== 200) throw new Error(`chat ${status}`);
    const reply = String(body.reply || "");
    if (/customer.?s?\s+full\s+name|what is the customer/i.test(reply)) {
      throw new Error(`create flow leaked: ${reply.slice(0, 140)}`);
    }
    if (
      !/can.?t create|cannot create|can’t create|don'?t allow|not allow|permissions?|role/i.test(
        reply
      )
    ) {
      throw new Error(`expected denial: ${reply.slice(0, 140)}`);
    }
    pass("resolver create ticket chat denied", reply.slice(0, 80));
    // restore agent session for remaining tests if any
    await login(USERS.agent.email);
  } catch (e) {
    fail("resolver create ticket chat", e);
  }

  // Direct Python /chat with user_name for assigned-to-me live block
  try {
    const mine = await api("/api/tickets?scope=assignee");
    const openMine = Array.isArray(mine.body)
      ? mine.body.filter((t) => String(t.status || "").toLowerCase() !== "resolved")
      : [];

    const res = await fetch(`${AGENTS}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key":
          process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret",
      },
      body: JSON.stringify({
        message: "show tickets assigned to me",
        page: "Home",
        organization_id: user.organizationId,
        user_id: user.id,
        user_name: user.name,
        session_id: `py-mine-${Date.now()}`,
        history: [{ role: "user", text: "show tickets assigned to me" }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
    const reply = String(body.reply || "").toLowerCase();
    if (openMine.length > 0) {
      const claimsZero =
        /(couldn'?t find any tickets assigned|could not find any tickets assigned|no tickets (are )?assigned|0 tickets assigned|you have \*\*0\*\*|you have 0 )/i.test(
          reply
        );
      if (claimsZero) {
        throw new Error(
          `Python claimed 0 but API has ${openMine.length} for ${user.name}: ${reply.slice(0, 180)}`
        );
      }
    }
    pass("Python /chat my-tickets", String(body.reply || "").slice(0, 80));
  } catch (e) {
    fail("Python /chat my-tickets", e);
  }
}

/* -------------------------------------------------------------------------- */
/* 8. Module GETs smoke (agent)                                               */
/* -------------------------------------------------------------------------- */
async function testModuleLists() {
  section("8. Module list APIs (agent)");
  try {
    await login(USERS.agent.email);
  } catch (e) {
    fail("module lists login", e);
    return;
  }
  const paths = [
    "/api/metrics",
    "/api/queues",
    "/api/kb",
    "/api/agents",
    "/api/roster",
    "/api/notifications",
    "/api/activities",
    "/api/dashboard/chart?range=7days",
    "/api/agent/triage-stats",
    "/api/account",
  ];
  for (const p of paths) {
    try {
      const { status, body } = await api(p);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const detail = Array.isArray(body)
        ? `${body.length} rows`
        : typeof body?.openTickets === "number"
          ? `open=${body.openTickets}`
          : "ok";
      pass(p, detail);
    } catch (e) {
      fail(p, e);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */
async function main() {
  console.log("Worktual PRODUCT E2E");
  console.log(`API:    ${BASE}`);
  console.log(`Agents: ${AGENTS}`);

  testIntentsOffline();
  await testHealth();
  await testSpa();
  await testRoleScopes();
  await testMyTicketsRegression();
  await testEnrichEscalate();
  await testCoworkerStack();
  await testModuleLists();

  console.log("\n=== Summary ===\n");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
