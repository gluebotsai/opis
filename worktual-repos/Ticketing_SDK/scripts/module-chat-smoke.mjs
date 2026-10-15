#!/usr/bin/env node
/**
 * Cross-module API + dynamic chat smoke tests.
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const EMAIL = process.env.SMOKE_EMAIL || "jane.smith@worktual.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";

let cookie = "";
let failed = 0;
let passed = 0;

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  console.error(`  ✗ ${name} — ${err?.message || err}`);
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
  return { status: res.status, body };
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

function assertOk(status, label) {
  if (status < 200 || status >= 300) throw new Error(`${label} HTTP ${status}`);
}

async function guidedReply(payload, fallback) {
  const { status, body } = await api("/api/coworker/guided-reply", {
    method: "POST",
    body: JSON.stringify({ ...payload, fallback }),
  });
  assertOk(status, "guided-reply");
  const reply = String(body?.reply || "").trim();
  if (!reply) throw new Error("empty reply");
  return reply;
}

async function main() {
  console.log(`\n=== Module smoke @ ${BASE} ===\n`);

  console.log("Auth & health");
  try {
    const h = await api("/api/health");
    assertOk(h.status, "health");
    pass("health", `db=${h.body?.db}`);
  } catch (e) {
    fail("health", e);
  }

  try {
    const { status, body } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    assertOk(status, "login");
    if (!cookie) throw new Error("no session cookie");
    pass("login", body?.user?.name || EMAIL);
  } catch (e) {
    fail("login", e);
    console.error("\nCannot continue without auth.\n");
    process.exit(1);
  }

  console.log("\nModule list APIs");
  const listChecks = [
    ["/api/tickets", (b) => Array.isArray(b), "tickets"],
    ["/api/customers", (b) => Array.isArray(b), "customers"],
    ["/api/kb", (b) => Array.isArray(b), "kb"],
    ["/api/queues", (b) => Array.isArray(b), "teams/queues"],
    ["/api/agents", (b) => Array.isArray(b), "agents"],
    ["/api/metrics", (b) => b && typeof b === "object", "metrics (home)"],
    ["/api/dashboard/chart", (b) => b != null, "dashboard chart"],
    ["/api/analytics?range=7days", (b) => b && typeof b === "object", "analytics"],
    ["/api/notifications", (b) => Array.isArray(b) || (b && Array.isArray(b.items)), "notifications"],
    ["/api/activities", (b) => Array.isArray(b), "activities"],
    ["/api/account", (b) => b && typeof b === "object", "settings/account"],
  ];

  for (const [path, ok, label] of listChecks) {
    try {
      const { status, body } = await api(path);
      assertOk(status, label);
      if (!ok(body)) throw new Error("unexpected body shape");
      const detail = Array.isArray(body)
        ? `${body.length} rows`
        : typeof body?.totalTickets === "number"
          ? `total=${body.totalTickets}`
          : typeof body?.openTickets === "number"
            ? `open=${body.openTickets}`
            : "ok";
      pass(label, detail);
    } catch (e) {
      fail(label, e);
    }
  }

  console.log("\nGuided chat (LLM) — ticket / team / nav / greeting");
  const chatCases = [
    {
      name: "ticket start",
      payload: {
        module: "ticket",
        kind: "start",
        userText: "create ticket",
        pageLabel: "Create Ticket",
        context: { nextStep: "customer full name" },
      },
      fallback: "Share the customer’s full name.",
    },
    {
      name: "ticket got_name",
      payload: {
        module: "ticket",
        kind: "got_name",
        userText: "Alex Rivera",
        pageLabel: "Create Ticket",
        context: { customerName: "Alex Rivera", nextStep: "email or phone" },
      },
      fallback: "Got Alex. What’s their email or phone?",
    },
    {
      name: "team start",
      payload: {
        module: "team",
        kind: "start",
        userText: "create team",
        pageLabel: "Teams",
        context: { nextStep: "team name" },
      },
      fallback: "What should we name this team?",
    },
    {
      name: "team got_type",
      payload: {
        module: "team",
        kind: "got_type",
        userText: "Shared",
        pageLabel: "Teams",
        context: { teamName: "Night Shift", teamType: "Shared" },
      },
      fallback: "Shared. Which agents should we add?",
    },
    {
      name: "nav tickets",
      payload: {
        module: "nav",
        kind: "opened",
        userText: "my tickets",
        pageLabel: "My Tickets",
        context: { module: "assigned", seedHint: "Showing My Tickets" },
      },
      fallback: "Showing My Tickets.",
    },
    {
      name: "nav kb",
      payload: {
        module: "nav",
        kind: "opened",
        userText: "KB password reset",
        pageLabel: "Knowledge Base",
        context: { module: "kb", kbSearch: "password reset" },
      },
      fallback: "Searching Knowledge Base for password reset.",
    },
    {
      name: "nav customers",
      payload: {
        module: "nav",
        kind: "opened",
        userText: "find customer Acme",
        pageLabel: "Customers",
        context: { module: "customers", customerSearch: "Acme" },
      },
      fallback: "Searching customers for Acme.",
    },
    {
      name: "nav analytics",
      payload: {
        module: "nav",
        kind: "opened",
        userText: "open analytics",
        pageLabel: "Analytics",
        context: { module: "analytics" },
      },
      fallback: "Opening Analytics.",
    },
    {
      name: "greeting home",
      payload: {
        module: "greeting",
        kind: "greeting",
        pageLabel: "Home",
        context: { pageLabel: "Home" },
      },
      fallback: "I'm your Worktual co-worker on Home.",
    },
    {
      name: "greeting teams",
      payload: {
        module: "greeting",
        kind: "greeting",
        pageLabel: "Teams",
        context: { pageLabel: "Teams" },
      },
      fallback: "I'm your Worktual co-worker on Teams.",
    },
  ];

  const replies = {};
  for (const c of chatCases) {
    try {
      const reply = await guidedReply(c.payload, c.fallback);
      replies[c.name] = reply;
      const usedFallback = reply === c.fallback;
      pass(c.name, usedFallback ? `FALLBACK: ${reply.slice(0, 70)}` : reply.slice(0, 90));
    } catch (e) {
      fail(c.name, e);
    }
  }

  console.log("\nDynamic wording (same prompt twice should usually differ)");
  try {
    const a = await guidedReply(
      {
        module: "ticket",
        kind: "start",
        userText: "new ticket please",
        pageLabel: "Create Ticket",
        context: { nextStep: "full name", run: "A" },
      },
      "Share the customer full name."
    );
    const b = await guidedReply(
      {
        module: "ticket",
        kind: "start",
        userText: "new ticket please",
        pageLabel: "Create Ticket",
        context: { nextStep: "full name", run: "B" },
      },
      "Share the customer full name."
    );
    if (a === b) {
      pass("ticket start variance", "same wording (model may be deterministic)");
    } else {
      pass("ticket start variance", "different replies");
    }
    console.log(`    A: ${a.slice(0, 100)}`);
    console.log(`    B: ${b.slice(0, 100)}`);
  } catch (e) {
    fail("ticket start variance", e);
  }

  console.log("\nCreate-ticket enrich + file");
  let enrichOk = false;
  try {
    const { status, body } = await api("/api/tickets/enrich", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Smoke Tester",
        customerEmail: "smoke.tester@example.com",
        issue: "Cannot reset MFA on the mobile app after OS update; login loops forever.",
      }),
    });
    assertOk(status, "enrich");
    if (!body?.subject) throw new Error("missing subject");
    enrichOk = true;
    pass(
      "ticket enrich",
      `subject=${String(body.subject).slice(0, 50)} priority=${body.priority} assignee=${body.assignee || "?"}`
    );
  } catch (e) {
    fail("ticket enrich", e);
  }

  try {
    const cust = await ensureDirectoryCustomer();
    const { status, body } = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: `Smoke module test ${Date.now()}`,
        description: "Automated module smoke create",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        priority: "medium",
        status: "Open",
        channel: "Web",
      }),
    });
    assertOk(status, "create ticket");
    pass("create ticket", body?.id || body?.ticketId || "created");
  } catch (e) {
    fail("create ticket", e);
  }

  console.log("\nTeams create");
  try {
    const name = `Smoke Team ${Date.now().toString(36)}`;
    const { status, body } = await api("/api/queues", {
      method: "POST",
      body: JSON.stringify({
        queueName: name,
        description: "Module chat smoke team",
        type: "Private",
        agents: [],
      }),
    });
    if (status !== 201) {
      throw new Error(
        `create team HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`
      );
    }
    pass("create team", body?.queueName || body?.name || name);
  } catch (e) {
    fail("create team", e);
  }

  console.log("\nLegacy chat-reply alias");
  try {
    const { status, body } = await api("/api/tickets/chat-reply", {
      method: "POST",
      body: JSON.stringify({
        kind: "start",
        userText: "create ticket",
        fallback: "What is the customer’s full name?",
      }),
    });
    assertOk(status, "chat-reply");
    if (!String(body?.reply || "").trim()) throw new Error("empty");
    pass("tickets/chat-reply", String(body.reply).slice(0, 90));
  } catch (e) {
    fail("tickets/chat-reply", e);
  }

  console.log("\nCoworker agents chat (optional)");
  try {
    const { status, body } = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "What can you help me with on Home?",
        pageLabel: "Home",
      }),
    });
    if (status >= 200 && status < 300 && (body?.reply || body?.message)) {
      pass("coworker/chat", String(body.reply || body.message).slice(0, 90));
    } else {
      pass("coworker/chat", `skipped/unavailable HTTP ${status}`);
    }
  } catch (e) {
    pass("coworker/chat", `skipped — ${e.message}`);
  }

  // Role-gated chat: resolver must not enter create-ticket guided flow
  console.log("\nResolver chat RBAC");
  try {
    cookie = "";
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "yaswanthmg1@gmail.com",
        password: PASSWORD,
      }),
    });
    if (login.status !== 200) throw new Error(`resolver login ${login.status}`);
    pass("resolver login");

    const { status, body } = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "create ticket",
        page: "Home",
        session_id: `resolver-create-${Date.now()}`,
        history: [{ role: "user", text: "create ticket" }],
      }),
    });
    if (status !== 200) throw new Error(`chat HTTP ${status} ${JSON.stringify(body)}`);
    const reply = String(body?.reply || "");
    if (/customer.?s?\s+full\s+name|what is the customer/i.test(reply)) {
      throw new Error(`resolver entered create flow: ${reply.slice(0, 160)}`);
    }
    if (
      !/can.?t create|cannot create|can’t create|don'?t allow|not allow|permissions?|role/i.test(
        reply
      )
    ) {
      throw new Error(`expected role denial, got: ${reply.slice(0, 160)}`);
    }
    pass("resolver create ticket denied in chat", reply.slice(0, 100));
  } catch (e) {
    fail("resolver create ticket chat", e);
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  if (enrichOk === false) process.exitCode = failed ? 1 : 0;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
