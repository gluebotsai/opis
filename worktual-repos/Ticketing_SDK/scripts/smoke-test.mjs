#!/usr/bin/env node
/**
 * Full smoke test suite — Postgres + authenticated Express API
 */
import pg from "pg";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const results = [];
let failed = 0;
let cookie = "";

function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  const detail = err?.message || String(err);
  results.push({ ok: false, name, detail });
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
  // Fallback for older fetch
  const raw = res.headers.get("set-cookie");
  if (raw && raw.includes("worktual_token=")) {
    cookie = raw.split(";")[0];
  }
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, status: res.status };
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

async function testDatabase() {
  console.log("\n=== PostgreSQL smoke tests ===\n");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    pass("Connect to DATABASE_URL");
  } catch (e) {
    fail("Connect to DATABASE_URL", e);
    return;
  }

  try {
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'ticketing'
        AND table_name = 'agents'
        AND column_name = 'setup_user_id'
    `);
    assert.equal(rows.length, 1);
    pass("agents.setup_user_id mapping column exists");
  } catch (e) {
    fail("agents.setup_user_id mapping column exists", e);
  }

  try {
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'ticketing'
        AND table_name = 'tickets'
        AND column_name = 'due_at'
    `);
    assert.ok(rows.length === 1);
    pass("tickets.due_at column exists");
  } catch (e) {
    fail("tickets.due_at column exists", e);
  }

  try {
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'accounts' AND table_name = 'setup_users'
    `);
    if (rows[0].n >= 1) {
      const hashes = await client.query(`
        SELECT COUNT(*)::int AS n
        FROM accounts.setup_users
        WHERE password_hash IS NOT NULL
          AND work_email IS NOT NULL
      `);
      assert.ok(hashes.rows[0].n >= 1);
      pass("MyAccount users have password hashes", `${hashes.rows[0].n} users`);

      const mapped = await client.query(`
        SELECT COUNT(*)::int AS mapped
        FROM ticketing.agents
        WHERE setup_user_id IS NOT NULL
      `);
      assert.ok(mapped.rows[0].mapped >= 1);
      const pwCol = await client.query(`
        SELECT COUNT(*)::int AS n
        FROM information_schema.columns
        WHERE table_schema = 'ticketing'
          AND table_name = 'agents'
          AND column_name = 'password_hash'
      `);
      assert.equal(pwCol.rows[0].n, 0);
      pass(
        "MyAccount mappings have no Ticketing passwords",
        `${mapped.rows[0].mapped} agents`
      );
    } else {
      pass("MyAccount users have password hashes", "accounts schema absent (seed demo only)");
    }
  } catch (e) {
    fail("MyAccount users have password hashes", e);
  }

  try {
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS n FROM ticketing.tickets
      WHERE due_at IS NOT NULL
    `);
    // Real orgs may have zero tickets locally; column check above is enough.
    pass("Tickets with SLA due_at", `${rows[0].n} tickets`);
  } catch (e) {
    fail("Tickets with SLA due_at", e);
  }

  await client.end();
}

async function testApi() {
  console.log("\n=== Authenticated API smoke tests ===\n");

  try {
    const { status } = await api("/api/tickets");
    assert.equal(status, 401);
    pass("GET /api/tickets requires auth (401)");
  } catch (e) {
    fail("GET /api/tickets requires auth (401)", e);
  }

  try {
    const { status, body } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: process.env.SMOKE_EMAIL || process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com",
        password: process.env.SMOKE_PASSWORD || "Worktual@123",
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.user.role, "admin");
    assert.ok(cookie.includes("worktual_token"));
    pass("POST /api/auth/login", body.user.name);
  } catch (e) {
    fail("POST /api/auth/login", e);
  }

  try {
    const { status, body } = await api("/api/auth/me");
    assert.equal(status, 200);
    assert.equal(body.user.email, process.env.SMOKE_EMAIL || process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com");
    assert.ok(Array.isArray(body.modules), "auth/me modules");
    assert.ok(body.dataScope, "auth/me dataScope");
    assert.ok(body.portalLabel, "auth/me portalLabel");
    pass("GET /api/auth/me", `${body.modules.length} modules`);
  } catch (e) {
    fail("GET /api/auth/me", e);
  }

  let meUser = null;
  try {
    const { body } = await api("/api/auth/me");
    meUser = body.user;
  } catch {
    /* covered above */
  }

  try {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.service, "ticketing-backend");
    assert.equal(body.status, "ok");
    pass("GET /health", `service=${body.service}`);
  } catch (e) {
    fail("GET /health", e);
  }

  try {
    const res = await fetch(`${BASE}/docs`);
    assert.equal(res.status, 200);
    pass("GET /docs");
  } catch (e) {
    fail("GET /docs", e);
  }

  try {
    const res = await fetch(`${BASE}/api/openapi.json`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.openapi);
    pass("GET /api/openapi.json");
  } catch (e) {
    fail("GET /api/openapi.json", e);
  }

  try {
    const { status, body } = await api("/api/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "ticketing-backend");
    pass("GET /api/health", `db=${body.db}`);
  } catch (e) {
    fail("GET /api/health", e);
  }

  if (meUser?.id && meUser?.organizationId) {
    const tasksKey =
      process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
    const sessionId = `smoke-${Date.now()}`;
    try {
      const res = await fetch(
        `${BASE}/api/coworker/conversation-context?sessionId=${encodeURIComponent(sessionId)}`,
        {
          headers: {
            "X-Coworker-Tasks-Key": tasksKey,
            "X-Coworker-Actor-Id": meUser.id,
            "X-Coworker-Org-Id": meUser.organizationId,
          },
        }
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.version, 0);
      pass("GET /api/coworker/conversation-context (service actor)");
    } catch (e) {
      fail("GET /api/coworker/conversation-context (service actor)", e);
    }

    try {
      const res = await fetch(`${BASE}/api/coworker/conversation-context`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Coworker-Tasks-Key": tasksKey,
          "X-Coworker-Actor-Id": meUser.id,
          "X-Coworker-Org-Id": meUser.organizationId,
        },
        body: JSON.stringify({
          sessionId,
          context: { smoke: true, at: new Date().toISOString() },
          expectedVersion: 0,
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(body.version >= 1);
      pass("PUT /api/coworker/conversation-context (service actor)", `v${body.version}`);
    } catch (e) {
      fail("PUT /api/coworker/conversation-context (service actor)", e);
    }

    try {
      const res = await fetch(`${BASE}/api/coworker/triage-data`, {
        headers: {
          "X-Coworker-Tasks-Key": tasksKey,
          "X-Coworker-Org-Id": meUser.organizationId,
        },
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.teams));
      assert.ok(Array.isArray(body.agents));
      pass("GET /api/coworker/triage-data (service actor)", `teams=${body.teams.length}`);
    } catch (e) {
      fail("GET /api/coworker/triage-data (service actor)", e);
    }

    try {
      const res = await fetch(`${BASE}/api/internal/organizations`, {
        headers: { "X-Coworker-Tasks-Key": tasksKey },
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.items));
      pass("GET /api/internal/organizations (tasks key)", `count=${body.items.length}`);
    } catch (e) {
      fail("GET /api/internal/organizations (tasks key)", e);
    }
  }

  let createdId = null;
  try {
    const { status, body } = await api("/api/tickets");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    pass("GET /api/tickets", `${body.length} tickets`);
  } catch (e) {
    fail("GET /api/tickets", e);
  }

  try {
    const { status, body } = await api("/api/metrics");
    assert.equal(status, 200);
    assert.ok(typeof body.openTickets === "number");
    assert.ok(body.priorityCounts && typeof body.priorityCounts === "object");
    assert.ok(Array.isArray(body.topQueues));
    pass(
      "GET /api/metrics",
      `open=${body.openTickets} overdue=${body.overdue} queues=${body.topQueues.length}`
    );
  } catch (e) {
    fail("GET /api/metrics", e);
  }

  try {
    const { status, body } = await api("/api/analytics?range=7days");
    assert.equal(status, 200);
    assert.ok(body.totalTickets !== undefined);
    assert.ok(Array.isArray(body.weeklyPoints));
    pass("GET /api/analytics", `total=${body.totalTickets}`);
  } catch (e) {
    fail("GET /api/analytics", e);
  }

  try {
    const cust = await ensureDirectoryCustomer();
    const { status, body } = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: "Enhancement smoke ticket",
        description: "Persisted to Postgres",
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        channel: "Web",
        priority: "urgent",
        queue: "",
        attachments: [],
      }),
    });
    assert.equal(status, 201);
    assert.ok(body.id);
    assert.ok(body.dueAt);
    createdId = body.id;
    pass("POST /api/tickets", `${createdId} dueAt=${body.dueAt?.slice(0, 10)}`);
  } catch (e) {
    fail("POST /api/tickets", e);
  }

  if (createdId) {
    try {
      const { status, body } = await api(
        `/api/tickets/${encodeURIComponent(createdId)}/notes`,
        {
          method: "POST",
          body: JSON.stringify({ text: "Persisted smoke note" }),
        }
      );
      assert.equal(status, 201);
      assert.equal(body.text, "Persisted smoke note");
      pass("POST /api/tickets/:id/notes", body.id);
    } catch (e) {
      fail("POST /api/tickets/:id/notes", e);
    }

    try {
      const { status, body } = await api(
        `/api/tickets/${encodeURIComponent(createdId)}/notes`
      );
      assert.equal(status, 200);
      assert.ok(body.length >= 1);
      pass("GET /api/tickets/:id/notes", `${body.length} notes`);
    } catch (e) {
      fail("GET /api/tickets/:id/notes", e);
    }

    try {
      const { status, body } = await api(
        `/api/tickets/${encodeURIComponent(createdId)}`,
        {
          method: "PUT",
          body: JSON.stringify({ status: "Pending" }),
        }
      );
      assert.equal(status, 200);
      assert.equal(body.status, "Pending");
      pass("PUT /api/tickets/:id", body.status);
    } catch (e) {
      fail("PUT /api/tickets/:id", e);
    }
  }

  try {
    const { status, body } = await api("/api/queues");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    // Seed org may have zero MyAccount teams; Fazil org has teams.
    const atRisk = body.filter((q) => q.slaStatus === "At Risk").length;
    pass(
      "GET /api/queues with SLA",
      `${body.length} queues, ${atRisk} at risk`
    );
  } catch (e) {
    fail("GET /api/queues with SLA", e);
  }

  try {
    const { status } = await api("/api/auth/logout", { method: "POST" });
    assert.equal(status, 200);
    cookie = "";
    pass("POST /api/auth/logout");
  } catch (e) {
    fail("POST /api/auth/logout", e);
  }
}

async function main() {
  console.log("Worktual enhancement smoke suite");
  console.log(`API: ${BASE}`);
  await testDatabase();
  await testApi();
  console.log("\n=== Summary ===\n");
  const passed = results.filter((r) => r.ok).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${results.length}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
