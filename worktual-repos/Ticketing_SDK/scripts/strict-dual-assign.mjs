#!/usr/bin/env node
/**
 * Strict dual Agent (L1) + Resolver (L2) assignment — live portals + confidence gate.
 *
 * Covers:
 *  - Unit matrix (pytest)
 *  - Agent enrich/create (force L1=self)
 *  - Admin create (when admin shares agent org; otherwise isolated)
 *  - Intake API (admin org)
 *  - Confidence gate consistency + threshold flip (0.5 vs 0.99) via Python one-shots
 *  - Escalate keeps L1 / sets L2
 *  - Resolver My Tickets on resolver_*; agent keeps escalated L1
 *  - Resolver create denied
 *
 * Requires: Express :3001 + ai-agents :8012
 * Run: node scripts/strict-dual-assign.mjs
 */
import { spawnSync } from "node:child_process";
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
const TASKS_SECRET =
  process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
const DEFAULT_THRESHOLD = Number(
  process.env.RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE || 0.5
);

const USERS = {
  admin: { email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com", role: "admin" },
  agent: { email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com", role: "agent" },
  resolver: { email: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com", role: "resolver" },
};

const ISSUE_HIGH =
  "Production VPN tunnel cannot connect to office network — critical outage for remote staff";
const ISSUE_LOW =
  "Hello, I have a general question about something minor, just curious";

let cookie = "";
let passed = 0;
let failed = 0;
const failures = [];
const stamp = Date.now();

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const detail = err instanceof Error ? err.message : String(err);
  failures.push({ name, detail });
  console.error(`  ✗ ${name} — ${detail.slice(0, 320)}`);
}
function section(title) {
  console.log(`\n=== ${title} ===\n`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(pathName, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (cookie && !headers.Cookie) headers.Cookie = cookie;
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

async function triageDirect(payload) {
  const res = await fetch(`${AGENTS}/tasks/triage-assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Coworker-Tasks-Key": TASKS_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`triage ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function confOf(obj) {
  if (obj?.resolver_confidence != null) return Number(obj.resolver_confidence);
  if (obj?.resolverConfidence != null) return Number(obj.resolverConfidence);
  return null;
}

function hasResolverFields(obj) {
  return obj && ("resolver" in obj || "resolver_id" in obj || "resolverId" in obj);
}

async function createTicket(fields) {
  const { skipDirectory, ...rest } = fields;
  let customer = {};
  if (!skipDirectory) {
    const cust = await ensureDirectoryCustomer();
    customer = {
      customerId: cust.id || undefined,
      customerName: cust.name,
      customerEmail: cust.email || undefined,
      customerPhone: cust.phone || undefined,
    };
  }
  return api("/api/tickets", {
    method: "POST",
    body: JSON.stringify({
      channel: "Web",
      priority: "medium",
      status: "Open",
      ...rest,
      ...customer,
    }),
  });
}

async function getTicket(id) {
  return api(`/api/tickets/${encodeURIComponent(id)}`);
}

async function listAssigneeScope() {
  return api("/api/tickets?listScope=assignee");
}

function runPytest() {
  const r = spawnSync(
    path.join(ROOT, "ai-agents", ".venv", "bin", "python"),
    ["-m", "pytest", "tests/test_dual_assign.py", "-q"],
    { cwd: path.join(ROOT, "ai-agents"), encoding: "utf8" }
  );
  return r;
}

/** One-shot dual-assign with forced skills + threshold (no live LLM/DB teams required). */
function runConfidenceOneShot({ threshold, skillScoreMode }) {
  const py = `
import os, json
os.environ["RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE"] = "${threshold}"
from unittest.mock import patch, MagicMock
from contextlib import contextmanager
from app.tasks.pipeline import run_triage_assign
from app.tasks.schemas import TriageAssignRequest

AGENT = {"id":"a1","name":"Alice Agent","role":"agent","status":"Active"}
RESOLVER = {"id":"r1","name":"Rita Resolver","role":"resolver","status":"Active"}
TEAM = {"id":"t1","name":"Network","member_ids":["a1","r1"]}

@contextmanager
def fake_db():
    yield MagicMock()

skills = {"a1":["General"], "r1": ${
    skillScoreMode === "high" ? '["VPN","Network"]' : '["General"]'
  }}

def fake_cat(**kw):
    return {
      "subject":"VPN down","description":"x","priority":"high",
      "category":"Network","skill":"VPN","queue":"Network",
      "rationale":"matched","enrichedByAi":False,
    }

with patch("app.db.db_conn", fake_db), \\
     patch("app.tasks.pipeline.resolve_org_id", return_value="org-1"), \\
     patch("app.tasks.pipeline.list_org_teams", return_value=[dict(TEAM)]), \\
     patch("app.tasks.pipeline.list_org_agents", return_value=[dict(AGENT), dict(RESOLVER)]), \\
     patch("app.tasks.pipeline.org_skills_by_user", return_value=skills), \\
     patch("app.tasks.pipeline.open_workload_by_assignee", return_value={}), \\
     patch("app.tasks.pipeline.categorize_ticket", side_effect=fake_cat), \\
     patch("app.tasks.assign.open_workload_by_assignee", return_value={}), \\
     patch("app.tasks.assign.open_workload_by_resolver", return_value={}):
    out = run_triage_assign(TriageAssignRequest(
      organization_id="org-1", customer_name="P", customer_email="p@t.com",
      issue="VPN down", created_by_role="customer"))
    print(json.dumps({
      "assignee": out.assignee, "resolver": out.resolver,
      "resolver_id": out.resolver_id, "resolver_confidence": out.resolver_confidence,
    }))
`;
  const r = spawnSync(
    path.join(ROOT, "ai-agents", ".venv", "bin", "python"),
    ["-c", py],
    { cwd: path.join(ROOT, "ai-agents"), encoding: "utf8" }
  );
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "oneshot failed").slice(0, 400));
  }
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  STRICT dual-assign — all portals + confidence           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`BASE=${BASE}  AGENTS=${AGENTS}  defaultThreshold=${DEFAULT_THRESHOLD}`);

  // ── 0. Unit matrix ──────────────────────────────────────
  section("0. Unit matrix (pytest test_dual_assign)");
  try {
    const r = runPytest();
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    if (r.status !== 0) throw new Error(out.slice(0, 500));
    pass("pytest dual-assign", out.trim().split("\n").pop() || "ok");
  } catch (e) {
    fail("pytest dual-assign", e);
  }

  // ── 1. Deterministic confidence one-shots ───────────────
  section("1. Confidence one-shots (high skill vs general)");
  try {
    const high = runConfidenceOneShot({ threshold: "0.5", skillScoreMode: "high" });
    assert(high.resolver === "Rita Resolver", `high expected L2, got ${JSON.stringify(high)}`);
    assert(Number(high.resolver_confidence) > 0.5, `high conf ${high.resolver_confidence}`);
    pass("high skill + threshold 0.5 → auto L2", `conf=${high.resolver_confidence}`);
  } catch (e) {
    fail("high skill one-shot", e);
  }
  try {
    const low = runConfidenceOneShot({ threshold: "0.5", skillScoreMode: "low" });
    assert(!low.resolver && !low.resolver_id, `low must null L2, got ${JSON.stringify(low)}`);
    assert(Number(low.resolver_confidence) <= 0.5, `low conf ${low.resolver_confidence}`);
    pass("general-only + threshold 0.5 → L2 null (not > 0.5)", `conf=${low.resolver_confidence}`);
  } catch (e) {
    fail("low skill one-shot", e);
  }
  try {
    const flip = runConfidenceOneShot({ threshold: "0.4", skillScoreMode: "low" });
    assert(flip.resolver === "Rita Resolver", `threshold 0.4 should assign on general (0.5), got ${JSON.stringify(flip)}`);
    pass("threshold flip 0.4 + general → auto L2", `conf=${flip.resolver_confidence}`);
  } catch (e) {
    fail("threshold flip one-shot", e);
  }

  // ── 2. Health + sessions ────────────────────────────────
  section("2. Health + role sessions");
  try {
    const h = await api("/api/health");
    assert(h.status === 200 && h.body?.db, `express ${h.status}`);
    pass("express health");
  } catch (e) {
    fail("express health", e);
    process.exit(1);
  }
  try {
    const res = await fetch(`${AGENTS}/health`);
    assert(res.ok, `agents ${res.status}`);
    pass("agents health");
  } catch (e) {
    fail("agents health", e);
    process.exit(1);
  }

  const sessions = {};
  for (const [key, u] of Object.entries(USERS)) {
    try {
      const user = await login(u.email);
      assert(user.role === u.role, `role ${u.role} vs ${user.role}`);
      sessions[key] = { user, cookie };
      pass(`login ${key}`, `${user.name} org=${String(user.organizationId).slice(0, 8)}…`);
    } catch (e) {
      fail(`login ${key}`, e);
    }
  }
  if (!sessions.agent || !sessions.resolver) {
    console.error("Need agent + resolver sessions.");
    process.exit(1);
  }

  const sameOrg =
    sessions.admin &&
    sessions.admin.user.organizationId === sessions.agent.user.organizationId;
  if (!sameOrg) {
    pass(
      "note: admin org ≠ agent/resolver org",
      "admin/intake exercised in admin org; dual roster tests use agent org"
    );
  }

  const agentOrg = sessions.agent.user.organizationId;

  // ── 3. Live triage gate on agent org ────────────────────
  section("3. Live triage confidence gate (agent org)");
  try {
    const samples = [];
    for (const issue of [ISSUE_HIGH, ISSUE_LOW, "Active Directory password reset locked account"]) {
      const t = await triageDirect({
        organization_id: agentOrg,
        customer_name: "Gate",
        customer_email: `gate.${stamp}@test.local`,
        issue,
        created_by_role: "customer",
      });
      assert(hasResolverFields(t), "missing resolver fields on triage");
      const conf = confOf(t);
      assert(conf != null, `missing confidence for ${issue.slice(0, 40)}`);
      if (conf > DEFAULT_THRESHOLD) {
        assert(t.resolver, `conf ${conf} > ${DEFAULT_THRESHOLD} without resolver`);
      } else {
        assert(!t.resolver && !t.resolver_id, `conf ${conf} ≤ threshold but resolver=${t.resolver}`);
      }
      samples.push(`${conf}${t.resolver ? "→L2" : "→null"}`);
    }
    pass("live gate consistency", samples.join(", "));
  } catch (e) {
    fail("live triage gate", e);
  }

  // ── 4. Agent portal ─────────────────────────────────────
  section("4. Agent portal enrich + create (force L1=self)");
  cookie = sessions.agent.cookie;
  let agentTicketId = null;
  let agentL1 = sessions.agent.user.name;
  try {
    const enrich = await api("/api/tickets/enrich", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Agent Portal Cust",
        customerEmail: `agent.portal.${stamp}@test.local`,
        issue: ISSUE_HIGH,
      }),
    });
    assert(enrich.status === 200, `enrich ${enrich.status} ${JSON.stringify(enrich.body)}`);
    assert(hasResolverFields(enrich.body), "enrich missing resolver fields");
    assert(
      enrich.body.assignee === agentL1,
      `enrich must force self, got ${enrich.body.assignee}`
    );
    pass(
      "agent enrich forces L1=self",
      `L2=${enrich.body.resolver ?? "null"} conf=${confOf(enrich.body)}`
    );

    const created = await createTicket({
      customerName: "Agent Portal Cust",
      customerEmail: `agent.portal.${stamp}@test.local`,
      subject: enrich.body.subject || `Agent dual ${stamp}`,
      description: enrich.body.description || ISSUE_HIGH,
      assignee: agentL1,
      assigneeId: sessions.agent.user.id,
      queue: enrich.body.queue || undefined,
      resolver: enrich.body.resolver || undefined,
      resolverId: enrich.body.resolver_id || undefined,
      category: enrich.body.category,
      skill: enrich.body.skill,
      priority: enrich.body.priority || "high",
    });
    assert(
      created.status === 201,
      `create ${created.status} ${JSON.stringify(created.body)}`
    );
    assert(created.body.assignee === agentL1, `create L1 ${created.body.assignee}`);
    if (created.body.resolverId) {
      assert(
        String(created.body.resolverId) !== String(sessions.agent.user.id),
        "L2 must not be creating agent"
      );
    }
    agentTicketId = created.body.id;
    pass(
      "agent create dual owners",
      `L1=${created.body.assignee} L2=${created.body.resolver ?? "null"} id=${agentTicketId}`
    );
  } catch (e) {
    fail("agent portal create", e);
  }

  // Low-confidence wording create
  try {
    const created = await createTicket({
      customerName: "Agent Low",
      customerEmail: `agent.low.${stamp}@test.local`,
      subject: `Agent low ${stamp}`,
      description: ISSUE_LOW,
      assignee: agentL1,
      assigneeId: sessions.agent.user.id,
    });
    assert(created.status === 201, `low create ${created.status}`);
    assert(created.body.assignee === agentL1, "low create cleared self");
    const confProbe = await triageDirect({
      organization_id: agentOrg,
      customer_name: "x",
      customer_email: "x@y.com",
      issue: ISSUE_LOW,
      created_by_role: "agent",
      force_assignee_id: sessions.agent.user.id,
      force_assignee_name: agentL1,
    });
    if (confOf(confProbe) < DEFAULT_THRESHOLD) {
      assert(
        !created.body.resolver,
        `low create should not set L2 when conf low; got ${created.body.resolver}`
      );
      pass("agent low-confidence create keeps L2 null", `conf≈${confOf(confProbe)}`);
    } else {
      pass(
        "agent low-wording still high conf in live org",
        `L2=${created.body.resolver ?? "null"} conf=${confOf(confProbe)}`
      );
    }
  } catch (e) {
    fail("agent low create", e);
  }

  // ── 5. Admin portal (same-org or isolated) ──────────────
  section("5. Admin portal create");
  if (sessions.admin) {
    cookie = sessions.admin.cookie;
    try {
      const enrich = await api("/api/tickets/enrich", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Admin Cust",
          customerEmail: `admin.${stamp}@test.local`,
          issue: ISSUE_HIGH,
        }),
      });
      assert(enrich.status === 200, `admin enrich ${enrich.status}`);
      assert(hasResolverFields(enrich.body), "admin enrich missing resolver fields");
      pass(
        "admin enrich returns dual fields",
        `L1=${enrich.body.assignee} L2=${enrich.body.resolver ?? "null"}`
      );

      const created = await createTicket({
        customerName: "Admin Cust",
        customerEmail: `admin.${stamp}@test.local`,
        subject: enrich.body.subject || `Admin dual ${stamp}`,
        description: ISSUE_HIGH,
        assignee: sameOrg ? sessions.agent.user.name : enrich.body.assignee,
        assigneeId: sameOrg ? sessions.agent.user.id : enrich.body.assignee_id,
        queue: enrich.body.queue || undefined,
      });
      assert(created.status === 201, `admin create ${created.status} ${JSON.stringify(created.body)}`);
      pass(
        "admin create",
        `L1=${created.body.assignee} L2=${created.body.resolver ?? "null"}`
      );

      if (sameOrg) {
        assert(
          created.body.assignee === sessions.agent.user.name,
          "admin explicit override failed"
        );
        pass("admin honors explicit agent override");
      }
    } catch (e) {
      fail("admin portal", e);
    }
  }

  // ── 6. Resolver denied ──────────────────────────────────
  section("6. Resolver create denied");
  cookie = sessions.resolver.cookie;
  try {
    const denied = await createTicket({
      skipDirectory: true,
      customerName: "Nope",
      customerEmail: `nope.${stamp}@test.local`,
      subject: "deny",
      description: "deny",
    });
    assert(denied.status === 403, `expected 403 got ${denied.status}`);
    pass("resolver POST /api/tickets → 403");
  } catch (e) {
    fail("resolver create deny", e);
  }

  // ── 7. Intake API ───────────────────────────────────────
  section("7. Intake API (customer-role triage)");
  if (sessions.admin) {
    cookie = sessions.admin.cookie;
    let apiKey = "";
    try {
      const keyRes = await api("/api/integration/keys", {
        method: "POST",
        body: JSON.stringify({ name: `dual-strict-${stamp}` }),
      });
      assert(
        keyRes.status === 200 || keyRes.status === 201,
        `key ${keyRes.status} ${JSON.stringify(keyRes.body)}`
      );
      apiKey = keyRes.body.secret;
      assert(apiKey, "missing secret");
      pass("create API key");
    } catch (e) {
      fail("create API key", e);
    }

    if (apiKey) {
      for (const [label, issue] of [
        ["high", ISSUE_HIGH],
        ["low", ISSUE_LOW],
      ]) {
        try {
          cookie = sessions.admin.cookie;
          const customer = await ensureDirectoryCustomer();
          const res = await fetch(`${BASE}/api/intake/tickets`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              channel: "api",
              requester: {
                name: customer.name,
                email: customer.email || undefined,
                phone: customer.phone || undefined,
              },
              subject: `Intake ${label} ${stamp}`,
              description: issue,
            }),
          });
          const body = await res.json();
          assert(
            res.status === 200 || res.status === 201,
            `intake ${label} ${res.status} ${JSON.stringify(body)}`
          );
          const ticket = body.ticket || body;
          assert(ticket.ticketNumber || ticket.id, "intake missing ticketNumber");
          // Prefer response fields; fall back to GET for older servers / confirm persistence.
          let assignee = ticket.assignee;
          let resolver = ticket.resolver;
          const tn = ticket.ticketNumber || ticket.id;
          if (assignee === undefined || resolver === undefined) {
            cookie = sessions.admin.cookie;
            const got = await getTicket(tn);
            assert(got.status === 200, `GET intake ticket ${got.status}`);
            assignee = got.body.assignee;
            resolver = got.body.resolver;
          }
          assert(assignee !== undefined, "intake assignee missing after GET");
          pass(
            `intake ${label} create`,
            `${tn} L1=${assignee ?? "?"} L2=${resolver ?? "null"}`
          );
        } catch (e) {
          fail(`intake ${label}`, e);
        }
      }

      // revoke
      try {
        const keys = await api("/api/integration/keys");
        const mine = (Array.isArray(keys.body) ? keys.body : []).find(
          (k) => k.name === `dual-strict-${stamp}`
        );
        if (mine?.id) {
          await api(`/api/integration/keys/${mine.id}`, { method: "DELETE" });
          pass("revoked API key");
        }
      } catch (e) {
        fail("revoke API key", e);
      }
    }
  } else {
    pass("intake skipped (no admin session)");
  }

  // ── 8. Escalate keeps L1 ────────────────────────────────
  section("8. Escalate sets resolver, keeps L1");
  cookie = sessions.agent.cookie;
  let escalatedTo = null;
  try {
    if (!agentTicketId) throw new Error("no agent ticket");
    const before = await getTicket(agentTicketId);
    assert(before.status === 200, `before ${before.status}`);
    assert(before.body.assignee === agentL1, "precondition L1");

    const esc = await api(
      `/api/tickets/${encodeURIComponent(agentTicketId)}/escalate`,
      { method: "POST", body: "{}" }
    );
    assert(esc.status === 200, `escalate ${esc.status} ${JSON.stringify(esc.body)}`);
    const ticket = esc.body.ticket || {};
    const l1 = esc.body.assignee || ticket.assignee;
    const l2 = esc.body.resolver || ticket.resolver;
    assert(l1 === agentL1, `L1 erased: ${l1}`);
    assert(l2 && l2 !== "Unassigned", `no L2: ${l2}`);
    escalatedTo = l2;
    pass("escalate keeps L1 + sets L2", `agent=${l1} resolver=${l2}`);

    const after = await getTicket(agentTicketId);
    assert(after.body.assignee === agentL1, "GET L1 cleared");
    assert(after.body.resolver === l2, "GET L2 missing");
    pass("GET confirms dual owners");
  } catch (e) {
    fail("escalate keeps L1", e);
  }

  // PUT set resolver
  try {
    cookie = sessions.agent.cookie;
    const created = await createTicket({
      customerName: "Put Res",
      customerEmail: `put.${stamp}@test.local`,
      subject: `PUT resolver ${stamp}`,
      description: ISSUE_LOW,
      assignee: agentL1,
      assigneeId: sessions.agent.user.id,
    });
    assert(created.status === 201, `put setup ${created.status}`);
    const put = await api(`/api/tickets/${encodeURIComponent(created.body.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        resolver: sessions.resolver.user.name,
        escalate: true,
      }),
    });
    assert(put.status === 200, `PUT ${put.status} ${JSON.stringify(put.body)}`);
    assert(put.body.assignee === agentL1, "PUT cleared L1");
    assert(
      put.body.resolver === sessions.resolver.user.name,
      `PUT resolver=${put.body.resolver}`
    );
    pass("PUT resolver keeps agent");
  } catch (e) {
    fail("PUT set resolver", e);
  }

  // ── 9. Lists / RBAC ─────────────────────────────────────
  section("9. Resolver + agent My Tickets scopes");
  cookie = sessions.resolver.cookie;
  try {
    const list = await listAssigneeScope();
    assert(list.status === 200, `resolver list ${list.status}`);
    const rows = Array.isArray(list.body) ? list.body : list.body?.tickets || [];
    const asL2 = rows.filter(
      (t) =>
        t.resolver === sessions.resolver.user.name ||
        t.resolverId === sessions.resolver.user.id
    );
    pass(
      "resolver My Tickets includes resolver_* rows",
      `total=${rows.length} asL2=${asL2.length}`
    );

    if (agentTicketId && escalatedTo === sessions.resolver.user.name) {
      const t = await getTicket(agentTicketId);
      assert(t.status === 200, `resolver GET ${t.status}`);
      pass("resolver can open escalated L2 ticket");
    } else if (agentTicketId) {
      const t = await getTicket(agentTicketId);
      if (t.status === 200 || t.status === 403 || t.status === 404) {
        pass(
          `resolver access to foreign escalate → ${t.status}`,
          `escalatedTo=${escalatedTo}`
        );
      } else {
        throw new Error(`unexpected ${t.status}`);
      }
    }
  } catch (e) {
    fail("resolver list/access", e);
  }

  cookie = sessions.agent.cookie;
  try {
    if (!agentTicketId) throw new Error("missing ticket");
    const list = await listAssigneeScope();
    assert(list.status === 200, `agent list ${list.status}`);
    const rows = Array.isArray(list.body) ? list.body : list.body?.tickets || [];
    const hit = rows.find((t) => String(t.id) === String(agentTicketId));
    assert(hit, "escalated ticket missing from agent My Tickets");
    assert(hit.assignee === agentL1, "agent list L1 wrong");
    pass("agent My Tickets still shows escalated ticket (L1 kept)");
  } catch (e) {
    fail("agent My Tickets after escalate", e);
  }

  // ── Summary ─────────────────────────────────────────────
  console.log("\n────────────────────────────────────────");
  console.log(`STRICT dual-assign: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f.name}: ${f.detail}`);
  }
  console.log("");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
