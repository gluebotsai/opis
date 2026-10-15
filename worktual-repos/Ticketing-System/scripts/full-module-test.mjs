#!/usr/bin/env node
/**
 * Full multi-role module suite — backend APIs + frontend SPA shell.
 * Roles: admin (seed), agent/resolver (Fazil org).
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";

const USERS = [
  { label: "admin", email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com", expectRole: "admin" },
  { label: "agent", email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com", expectRole: "agent" },
  { label: "resolver", email: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com", expectRole: "resolver" },
];

const MODULE_GETS = [
  { name: "account", path: "/api/account", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "notifications", path: "/api/notifications", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "org-branding", path: "/api/org-branding", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "tickets", path: "/api/tickets", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "tickets?scope=assignee", path: "/api/tickets?scope=assignee", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "tickets?scope=created", path: "/api/tickets?scope=created", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "tickets?scope=team", path: "/api/tickets?scope=team", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "tickets?scope=unassigned", path: "/api/tickets?scope=unassigned", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "metrics", path: "/api/metrics", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "queues/teams", path: "/api/queues", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "kb", path: "/api/kb", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "customers", path: "/api/customers", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "agents", path: "/api/agents", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "activities", path: "/api/activities", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "dashboard/chart", path: "/api/dashboard/chart", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "analytics", path: "/api/analytics?range=7days", expect: { admin: 200, agent: 403, resolver: 403 } },
  { name: "audit", path: "/api/audit", expect: { admin: 200, agent: 403, resolver: 403 } },
  { name: "csat-reports", path: "/api/csat-reports", expect: { admin: 200, agent: 403, resolver: 403 } },
  { name: "macros", path: "/api/macros", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "org-preferences", path: "/api/org-preferences", expect: { admin: 200, agent: 403, resolver: 403 } },
  { name: "escalation-directory", path: "/api/escalation-directory", expect: { admin: 200, agent: 403, resolver: 403 } },
  { name: "agent/triage-stats", path: "/api/agent/triage-stats", expect: { admin: 200, agent: 200, resolver: 403 } },
  { name: "roster", path: "/api/roster", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "priorities", path: "/api/priorities", expect: { admin: 200, agent: 200, resolver: 200 } },
  { name: "statuses", path: "/api/statuses", expect: { admin: 200, agent: 200, resolver: 200 } },
];

let cookie = "";
let failed = 0;
let passed = 0;
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

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const part = c.split(";")[0];
    if (part.startsWith("worktual_token=")) cookie = part;
  }
  const raw = res.headers.get("set-cookie");
  if (raw && raw.includes("worktual_token=")) cookie = raw.split(";")[0];
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
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

async function login(email) {
  cookie = "";
  const { status, body } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (status !== 200 || !cookie) {
    throw new Error(`login failed HTTP ${status}: ${JSON.stringify(body)}`);
  }
  return body.user;
}

async function testFrontend() {
  console.log("\n=== Frontend SPA ===\n");
  try {
    const res = await fetch(BASE + "/");
    const html = await res.text();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (!html.includes('id="root"') && !html.includes("id='root'")) {
      throw new Error("missing #root");
    }
    pass("GET / SPA shell", `${html.length} bytes`);

    // Dev (Vite) or production build
    if (html.includes("/src/main.tsx")) {
      const main = await fetch(BASE + "/src/main.tsx");
      if (main.status !== 200) throw new Error(`main.tsx HTTP ${main.status}`);
      pass("Vite entry /src/main.tsx", "dev");
    } else {
      const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
      const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
      if (!cssMatch || !jsMatch) throw new Error("missing production asset links");
      const css = await fetch(BASE + cssMatch[1]);
      const js = await fetch(BASE + jsMatch[1]);
      if (css.status !== 200 || js.status !== 200) {
        throw new Error(`assets css=${css.status} js=${js.status}`);
      }
      pass("Production assets", `${cssMatch[1]} + ${jsMatch[1]}`);
    }

    const views = [
      "DashboardView",
      "TicketsView",
      "WorkBoardView",
      "AgentQueuesView",
      "KnowledgeBaseView",
      "CustomersView",
      "AnalyticsView",
      "CreateTicketView",
      "SettingsView",
      "AuditLogView",
      "CsatReportsView",
      "MacrosView",
      "EscalationDirectoryView",
      "OrgPreferencesView",
      "LoginView",
    ];
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "ui-frontend/src/components");
    const missing = views.filter(
      (v) => !fs.existsSync(path.join(root, `${v}.tsx`))
    );
    if (missing.length) throw new Error(`missing views: ${missing.join(", ")}`);
    pass("Frontend module views on disk", `${views.length} components`);
  } catch (e) {
    fail("frontend SPA", e);
  }
}

async function testRole(user) {
  console.log(`\n=== Role: ${user.label} (${user.email}) ===\n`);
  let authUser;
  try {
    authUser = await login(user.email);
    if (authUser.role !== user.expectRole) {
      throw new Error(`expected role ${user.expectRole}, got ${authUser.role}`);
    }
    if (user.label !== "admin" && !authUser.myAccountUserId) {
      throw new Error("expected explicit MyAccount identity mapping");
    }
    pass("login", `${authUser.name} / ${authUser.role}`);
  } catch (e) {
    fail(`${user.label} login`, e);
    return;
  }

  for (const m of MODULE_GETS) {
    const expect = m.expect[user.label];
    try {
      const { status, body } = await api(m.path);
      if (status !== expect) throw new Error(`expected ${expect}, got ${status}`);
      let detail = `HTTP ${status}`;
      if (status === 200) {
        if (Array.isArray(body)) detail += ` · ${body.length} rows`;
        else if (body && typeof body.openTickets === "number")
          detail += ` · open=${body.openTickets}`;
        else if (body && typeof body.totalTickets === "number")
          detail += ` · total=${body.totalTickets}`;
        if (m.name === "account") {
          if (body?.profile?.email !== authUser.email) {
            throw new Error("account profile is not using authenticated MyAccount email");
          }
          if (body?.profile?.role !== authUser.role) {
            throw new Error("account profile is not using authenticated MyAccount role");
          }
        }
      }
      pass(`${user.label}:${m.name}`, detail);
    } catch (e) {
      fail(`${user.label}:${m.name}`, e);
    }
  }

  if (authUser.myAccountUserId) {
    try {
      const { status, body } = await api("/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: authUser.name, phone: "" }),
      });
      if (status !== 409) {
        throw new Error(`expected MyAccount-managed profile 409, got ${status}`);
      }
      if (!/myaccount/i.test(String(body?.error || ""))) {
        throw new Error("profile ownership error did not identify MyAccount");
      }
      pass(`${user.label}:profile-source`, "MyAccount managed");
    } catch (e) {
      fail(`${user.label}:profile-source`, e);
    }
  }

  // Customer 360 — requires email; resolvers blocked by canMutate? Actually canMutate includes resolver.
  // Resolver gets 403 from customers module? Route uses canMutate not requireModule customers.
  // Without email → 400 for staff who can mutate.
  try {
    const email =
      user.label === "admin"
        ? "alice@acme.com"
        : user.label === "agent"
          ? authUser.email
          : "nobody@example.com";
    const { status, body } = await api(
      `/api/customers/360?email=${encodeURIComponent(email)}`
    );
    const expect =
      user.label === "resolver" ? [200, 403, 404] : [200, 404];
    // admin/agent: 200 or 404 if email unknown; 400 only if missing email
    if (user.label === "resolver") {
      // canMutate allows resolver; may return 200 with empty or scoped data
      if (![200, 403, 404].includes(status)) {
        throw new Error(`unexpected ${status}`);
      }
    } else if (![200, 404].includes(status)) {
      throw new Error(`expected 200/404, got ${status}`);
    }
    pass(
      `${user.label}:customers/360`,
      `HTTP ${status}${body?.customer ? ` · ${body.customer.name || body.customer.email}` : ""}`
    );
  } catch (e) {
    fail(`${user.label}:customers/360`, e);
  }

  // AI insights is POST
  try {
    const { status, body } = await api("/api/ai-insights", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const expect = user.label === "resolver" ? 403 : 200;
    if (status !== expect) throw new Error(`expected ${expect}, got ${status}`);
    const n = Array.isArray(body?.insights) ? body.insights.length : 0;
    pass(`${user.label}:ai-insights`, `HTTP ${status} · ${n} insights`);
  } catch (e) {
    fail(`${user.label}:ai-insights`, e);
  }

  // Mutations
  if (user.label === "admin" || user.label === "agent") {
    try {
      const cust = await ensureDirectoryCustomer();
      const createBody = {
        subject: `Module test ${user.label} ${Date.now()}`,
        description: "full-module-test",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        channel: "Web",
        priority: "medium",
        status: "Resolved",
        assignee: authUser.name,
        assigneeId: authUser.id,
      };
      // Agent: assign to self so notes/PUT pass IDOR; skip triage override by providing subject+queue
      if (user.label === "agent") {
        const queues = await api("/api/queues");
        const qName = Array.isArray(queues.body) && queues.body[0]
          ? queues.body[0].queueName || queues.body[0].name
          : "tech support";
        createBody.queue = qName;
      }

      const { status, body } = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify(createBody),
      });
      if (status !== 201) throw new Error(`create HTTP ${status} ${JSON.stringify(body)}`);
      if (user.label !== "admin" && body.status !== "Open") {
        throw new Error(`status injection: expected Open, got ${body.status}`);
      }
      pass(`${user.label}:create-ticket`, `${body.id} status=${body.status}`);

      const note = await api(`/api/tickets/${encodeURIComponent(body.id)}/notes`, {
        method: "POST",
        body: JSON.stringify({ text: `note from ${user.label}` }),
      });
      if (note.status !== 201) {
        throw new Error(`note HTTP ${note.status} ${JSON.stringify(note.body)}`);
      }
      pass(`${user.label}:add-note`, note.body?.id || "ok");

      const put = await api(`/api/tickets/${encodeURIComponent(body.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: "Pending" }),
      });
      if (put.status !== 200) throw new Error(`PUT HTTP ${put.status}`);
      pass(`${user.label}:update-own-ticket`, put.body?.status);
    } catch (e) {
      fail(`${user.label}:ticket-mutations`, e);
    }
  } else {
    // Resolver cannot create tickets
    try {
      const { status } = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: "resolver should fail",
          description: "x",
          customerName: "X",
          customerEmail: `r.${Date.now()}@test.local`,
          channel: "Web",
        }),
      });
      if (status !== 403) throw new Error(`expected create 403, got ${status}`);
      pass(`${user.label}:create-ticket-denied`, "HTTP 403");
    } catch (e) {
      fail(`${user.label}:create-ticket-denied`, e);
    }

    // Update an assigned ticket
    try {
      const list = await api("/api/tickets?scope=assignee");
      if (!Array.isArray(list.body) || !list.body.length) {
        pass(`${user.label}:update-assigned`, "skipped (no assigned tickets)");
      } else {
        const t = list.body[0];
        const put = await api(`/api/tickets/${encodeURIComponent(t.id)}`, {
          method: "PUT",
          body: JSON.stringify({ status: t.status === "Pending" ? "Open" : "Pending" }),
        });
        if (put.status !== 200) throw new Error(`PUT HTTP ${put.status}`);
        pass(`${user.label}:update-assigned`, put.body?.status);
        // restore
        await api(`/api/tickets/${encodeURIComponent(t.id)}`, {
          method: "PUT",
          body: JSON.stringify({ status: t.status }),
        });
      }
    } catch (e) {
      fail(`${user.label}:update-assigned`, e);
    }
  }

  if (user.label === "agent" || user.label === "resolver") {
    try {
      const idor = await api("/api/tickets/%2310001", {
        method: "PUT",
        body: JSON.stringify({ status: "Pending" }),
      });
      if (idor.status === 200) throw new Error("IDOR: cross-org update succeeded");
      if (![403, 404].includes(idor.status)) {
        throw new Error(`expected 403/404, got ${idor.status}`);
      }
      pass(`${user.label}:idor-cross-org`, `HTTP ${idor.status}`);
    } catch (e) {
      fail(`${user.label}:idor-cross-org`, e);
    }
  }

  try {
    const { status } = await api("/api/auth/logout", { method: "POST" });
    if (status !== 200) throw new Error(`logout ${status}`);
    cookie = "";
    pass(`${user.label}:logout`);
  } catch (e) {
    fail(`${user.label}:logout`, e);
  }
}

async function testUnauth() {
  console.log("\n=== Unauthenticated ===\n");
  cookie = "";
  for (const path of ["/api/tickets", "/api/metrics", "/api/kb", "/api/customers"]) {
    try {
      const { status } = await api(path);
      if (status !== 401) throw new Error(`expected 401, got ${status}`);
      pass(`401 ${path}`);
    } catch (e) {
      fail(`401 ${path}`, e);
    }
  }
}

async function main() {
  console.log("Worktual full module test");
  console.log(`API: ${BASE}`);

  await testFrontend();
  await testUnauth();

  try {
    const { status, body } = await api("/api/health");
    if (status !== 200 || body?.status !== "ok") throw new Error(JSON.stringify(body));
    pass("health", `db=${body.db}`);
  } catch (e) {
    fail("health", e);
  }

  for (const u of USERS) {
    await testRole(u);
  }

  // Co-worker UI actions (facets) — agent session
  console.log("\n=== Coworker UI actions (facets) ===\n");
  try {
    const agent = USERS.find((u) => u.label === "agent");
    const loginRes = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: agent.email, password: PASSWORD }),
    });
    if (loginRes.status !== 200) throw new Error(`login ${loginRes.status}`);
    pass("ui-actions login");

    const cases = [
      ["list all", "Customers", (a) => a.type === "set_filter" && a.module === "customers" && a.query === ""],
      ["show active customers", "Customers", (a) => a.type === "set_filter" && a.status === "Active"],
      ["open urgent tickets", "Home", null],
      ["high priority tickets", "My Tickets", null],
      ["how many open tickets?", "Tickets", null],
    ];
    for (const [msg, page, pred] of cases) {
      const { status, body } = await api("/api/coworker/ui-actions", {
        method: "POST",
        body: JSON.stringify({ message: msg, page }),
      });
      if (status !== 200) throw new Error(`${msg} HTTP ${status}`);
      if (pred === null) {
        if ((body?.actions || []).length !== 0) {
          throw new Error(`${msg} expected no actions`);
        }
        pass(`ui-actions Q: ${msg}`);
      } else if (!(body?.actions || []).some(pred)) {
        throw new Error(`${msg} ${JSON.stringify(body?.actions)}`);
      } else {
        pass(`ui-actions: ${msg}`);
      }
    }

    const ticketChat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "open urgent tickets",
        page: "Home",
        session_id: `full-module-ticket-${Date.now()}`,
      }),
    });
    if (ticketChat.status !== 200) throw new Error(`ticket chat ${ticketChat.status}`);
    const ticketFilter = (ticketChat.body?.ui_actions || []).find(
      (a) =>
        a.type === "set_filter" &&
        a.module === "tickets" &&
        a.status === "Open" &&
        a.priority === "urgent"
    );
    if (!ticketFilter) throw new Error(JSON.stringify(ticketChat.body?.ui_actions));
    pass("LangGraph ticket facets");
  } catch (e) {
    fail("ui-actions facets suite", e);
  }

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
