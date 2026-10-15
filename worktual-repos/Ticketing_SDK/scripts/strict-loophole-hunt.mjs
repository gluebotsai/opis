#!/usr/bin/env node
/**
 * Extra loophole / security stress pass for E2E strict testing.
 * Writes scripts/.loophole-hunt-report.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const AGENTS = process.env.AGENTS_BASE || "http://127.0.0.1:8012";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".loophole-hunt-report.json");

const USERS = {
  admin: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com",
  agent: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com",
  resolver: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com",
};

const findings = [];
const checks = [];
let cookie = "";

function find(sev, module, title, detail = "", role = "") {
  findings.push({ sev, module, title, detail: String(detail || "").slice(0, 500), role });
  console.log(`[${sev}] ${module}${role ? `/${role}` : ""}: ${title}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
}
function pass(msg) {
  checks.push(msg);
  console.log(`  OK  ${msg}`);
}

async function api(p, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { ...opts, headers });
  for (const c of res.headers.getSetCookie?.() || []) {
    if (c.startsWith("worktual_token=")) cookie = c.split(";")[0];
  }
  const raw = res.headers.get("set-cookie");
  if (raw?.includes("worktual_token=")) cookie = raw.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function login(email) {
  cookie = "";
  return api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
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

async function main() {
  const started = new Date().toISOString();
  console.log(`\nLoophole hunt\nAPI ${BASE} · Agents ${AGENTS}\n`);

  if ((await fetch(BASE + "/").then((r) => r.status).catch(() => 0)) !== 200) {
    find("CRITICAL", "infra", "App down");
  } else pass("app up");
  const ag = await fetch(AGENTS + "/health").then((r) => r.status).catch(() => 0);
  if (ag !== 200) find("CRITICAL", "infra", "Agents down", String(ag));
  else pass("agents up");

  // --- Auth loopholes ---
  console.log("\n=== AUTH ===");
  {
    cookie = "";
    const bad = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: USERS.agent, password: "wrong-password" }),
    });
    if (bad.status === 200) find("CRITICAL", "auth", "Wrong password accepted");
    else pass(`bad password → ${bad.status}`);

    const none = await api("/api/tickets");
    if (none.status !== 401) find("HIGH", "auth", "Unauth tickets not 401", String(none.status));
    else pass("unauth tickets 401");

    const forge = await fetch(BASE + "/api/tickets", {
      headers: { Cookie: "worktual_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid" },
    });
    if (forge.status === 200) find("CRITICAL", "auth", "Forged JWT accepted");
    else pass(`forged JWT → ${forge.status}`);
  }

  // --- Concurrent ticket number uniqueness ---
  console.log("\n=== RACE: parallel creates ===");
  {
    await login(USERS.agent);
    const stamp = Date.now();
    const cust = await ensureDirectoryCustomer();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api("/api/tickets", {
          method: "POST",
          body: JSON.stringify({
            customerId: cust.id || undefined,
            customerName: cust.name,
            customerEmail: cust.email || undefined,
            customerPhone: cust.phone || undefined,
            subject: `Race create ${stamp}-${i}`,
            description: "Parallel create uniqueness stress for ticket numbers",
            priority: "low",
          }),
        })
      )
    );
    const ok = results.filter((r) => r.status === 201);
    const ids = ok.map((r) => r.body?.id).filter(Boolean);
    const uniq = new Set(ids);
    if (ok.length < 6) {
      find("HIGH", "tickets", "Parallel creates mostly failed", `${ok.length}/8 ${results.map((r) => r.status).join(",")}`, "agent");
    } else pass(`parallel creates ${ok.length}/8`);
    if (uniq.size !== ids.length) {
      find("CRITICAL", "tickets", "Duplicate ticket_number under parallel create", [...ids].join(","), "agent");
    } else pass(`parallel ids unique n=${ids.length}`);
  }

  // --- Resolver cannot mutate other people's tickets ---
  console.log("\n=== RBAC: resolver boundary ===");
  {
    await login(USERS.agent);
    const cust = await ensureDirectoryCustomer();
    const cr = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: `Resolver must not touch ${Date.now()}`,
        description: "Ticket owned by agent for resolver IDOR probe",
        priority: "medium",
        assignee: "Mohamed Fazil",
      }),
    });
    const tid = cr.body?.id;
    if (cr.status !== 201 || !tid) {
      find("HIGH", "tickets", "Setup create for resolver IDOR failed", String(cr.status), "agent");
    } else {
      await login(USERS.resolver);
      const get = await api(`/api/tickets/${encodeURIComponent(tid)}`);
      if (get.status === 200) {
        find("HIGH", "idor", "Resolver can GET agent-owned ticket", tid, "resolver");
      } else pass(`resolver GET foreign → ${get.status}`);

      const put = await api(`/api/tickets/${encodeURIComponent(tid)}`, {
        method: "PUT",
        body: JSON.stringify({ status: "Open", subject: "HACKED_BY_RESOLVER" }),
      });
      if (put.status === 200) {
        find("CRITICAL", "idor", "Resolver can PUT agent-owned ticket", tid, "resolver");
      } else pass(`resolver PUT foreign → ${put.status}`);

      const note = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`, {
        method: "POST",
        body: JSON.stringify({ text: "resolver sneak", visibility: "internal" }),
      });
      if (note.status === 201) {
        find("HIGH", "idor", "Resolver can note on agent-owned ticket", tid, "resolver");
      } else pass(`resolver note foreign → ${note.status}`);

      const esc = await api(`/api/tickets/${encodeURIComponent(tid)}/escalate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (esc.status === 200) {
        find("HIGH", "idor", "Resolver can escalate agent-owned ticket", tid, "resolver");
      } else pass(`resolver escalate foreign → ${esc.status}`);
    }
  }

  // --- Agent cannot force org scope / analytics ---
  console.log("\n=== RBAC: agent elevation ===");
  {
    await login(USERS.agent);
    for (const [path, want] of [
      ["/api/tickets?scope=org", 403],
      ["/api/analytics", 403],
      ["/api/audit", 403],
      ["/api/csat-reports", 403],
      ["/api/org-preferences", 403],
      ["/api/escalation-directory", 403],
    ]) {
      const r = await api(path);
      if (r.status !== want) find("HIGH", "rbac", `Agent ${path} expected ${want}`, String(r.status), "agent");
      else pass(`agent ${path} → ${r.status}`);
    }
    const prefPut = await api("/api/org-preferences", {
      method: "PUT",
      body: JSON.stringify({ ticketPrefix: "XX", portalLabel: "hack", displayTimezone: "UTC" }),
    });
    if (prefPut.status === 200) find("CRITICAL", "rbac", "Agent can PUT org-preferences", "", "agent");
    else pass(`agent org-preferences PUT → ${prefPut.status}`);
  }

  // --- Path traversal uploads / KB ---
  console.log("\n=== UPLOADS / KB path abuse ===");
  {
    await login(USERS.agent);
    const trav = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: `Traversal ${Date.now()}`,
        content: "Body long enough for KB validation rules here.",
        category: "General",
        attachments: [
          "/uploads/../server.ts",
          "/uploads/../../etc/passwd",
          "https://evil.example/x.txt",
          "/uploads/not-real.bin",
        ],
      }),
    });
    if (trav.status === 201) {
      const atts = trav.body?.attachments || [];
      const bad = atts.filter(
        (a) => a.includes("..") || a.startsWith("http") || a === "/uploads/not-real.bin" || a.includes("server.ts")
      );
      if (bad.length) find("HIGH", "kb", "KB accepted dangerous attachment paths", bad.join(","), "agent");
      else pass("KB stripped traversal/fake attachments");
    } else find("MED", "kb", "KB create for traversal probe failed", String(trav.status), "agent");

    const fileGet = await fetch(BASE + "/uploads/../package.json");
    const ct = fileGet.headers.get("content-type") || "";
    const text = await fileGet.text().catch(() => "");
    if (fileGet.status === 200 && /"name"\s*:\s*"worktual"/.test(text)) {
      find("CRITICAL", "uploads", "Static uploads path traversal reads package.json");
    } else pass(`uploads traversal → ${fileGet.status}`);
  }

  // --- Mass assignment / customer portal fields on staff create ---
  console.log("\n=== MASS ASSIGN / CREATE ===");
  {
    await login(USERS.agent);
    const cust = await ensureDirectoryCustomer();
    const cr = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: `Mass ${Date.now()}`,
        description: "Try to inject resolved status and csat on create",
        priority: "low",
        status: "Resolved",
        csatScore: 5,
      }),
    });
    if (cr.status === 201) {
      if (String(cr.body?.status) === "Resolved") {
        find("MED", "create-ticket", "Agent create accepted status=Resolved", cr.body.id, "agent");
      } else pass(`agent create status forced Open (${cr.body?.status})`);
      if (cr.body?.csatScore != null) {
        find("MED", "create-ticket", "Agent create accepted csatScore", String(cr.body.csatScore), "agent");
      } else pass("agent create ignored csatScore");
    } else find("HIGH", "create-ticket", "Mass-assign create failed", String(cr.status), "agent");
  }

  // --- Cross-org notes / escalate with Jane ticket ---
  console.log("\n=== CROSS-ORG ===");
  {
    const jane = await login(USERS.admin);
    const jOrg = jane.body?.user?.organizationId;
    const list = await api("/api/tickets?scope=org");
    const victim = Array.isArray(list.body) && list.body[0];
    await login(USERS.agent);
    const aOrg = (await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: USERS.agent, password: PASSWORD }),
    })).body?.user?.organizationId;
    // re-login agent properly
    await login(USERS.agent);
    const agentLogin = await login(USERS.agent);
    if (victim && jOrg && agentLogin.body?.user?.organizationId && jOrg !== agentLogin.body.user.organizationId) {
      const paths = [
        ["GET", `/api/tickets/${encodeURIComponent(victim.id)}`],
        ["PUT", `/api/tickets/${encodeURIComponent(victim.id)}`],
        ["POST", `/api/tickets/${encodeURIComponent(victim.id)}/notes`],
        ["POST", `/api/tickets/${encodeURIComponent(victim.id)}/escalate`],
      ];
      for (const [method, p] of paths) {
        const r = await api(p, {
          method,
          body: method === "GET" ? undefined : JSON.stringify(method.includes("notes") ? { text: "x", visibility: "internal" } : method.includes("escalate") ? {} : { subject: "X" }),
        });
        if (r.status === 200 || r.status === 201) {
          // subject match for GET/PUT to avoid false positive on collision (should be gone)
          if (method === "GET" || method === "PUT") {
            if (String(r.body?.subject || "") === String(victim.subject || "")) {
              find("CRITICAL", "idor", `Agent ${method} other-org ticket`, victim.id, "agent");
            } else pass(`agent ${method} ${victim.id} → ${r.status} (own-org different subject)`);
          } else {
            find("CRITICAL", "idor", `Agent ${method} other-org ticket`, `${victim.id} → ${r.status}`, "agent");
          }
        } else pass(`agent ${method} ${victim.id} → ${r.status}`);
      }
    } else pass("skip cross-org (same org)");
  }

  // --- Coworker: resolver via Express + direct agents with can_create true spoof ---
  console.log("\n=== COWORKER SPOOF ===");
  {
    await login(USERS.resolver);
    const chat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "create a ticket for Spoof",
        page: "Home",
        session_id: `lp-${Date.now()}`,
        can_create_ticket: true,
        user_role: "admin",
      }),
    });
    const text = String(chat.body?.reply || "");
    if (/full name|customer.?s name|what.?s the name/i.test(text) && !/can.?t create|cannot create|can’t create|role/i.test(text)) {
      find("HIGH", "coworker", "Resolver spoofed can_create via Express body", text.slice(0, 200), "resolver");
    } else if (/can.?t create|cannot create|can’t create|role/i.test(text)) {
      pass("Express ignores client can_create spoof");
    } else pass(`resolver chat reply (non-guided): ${text.slice(0, 80)}`);

    const direct = await fetch(AGENTS + "/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key":
          process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret",
      },
      body: JSON.stringify({
        message: "create a ticket for Spoof",
        role: "resolver",
        can_create_ticket: true,
        user_name: "Yaswanth mg",
        organization_id: "00000000-0000-4000-8000-000000000099",
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    const dtext = String(direct.body?.reply || "");
    // Agents may honor can_create_ticket=true even for resolver — that's a loophole if clients can hit agents directly
    if (
      /full name|customer.?s name|what.?s the name/i.test(dtext) &&
      !/can.?t create|cannot create|can’t create|role/i.test(dtext)
    ) {
      find(
        "MED",
        "coworker",
        "Direct agents /chat honors can_create_ticket=true for resolver (bypass if agents port exposed)",
        dtext.slice(0, 200),
        "resolver"
      );
    } else if (/can.?t create|cannot create|can’t create|role/i.test(dtext)) {
      pass("agents deny create even if can_create_ticket=true");
    } else pass(`agents spoof reply: ${dtext.slice(0, 80)}`);
  }

  // --- SQL-ish search injection ---
  console.log("\n=== INJECTION ===");
  {
    await login(USERS.agent);
    const q = await api("/api/tickets?scope=search&q=" + encodeURIComponent("%' OR 1=1 --"));
    if (q.status !== 200) find("MED", "search", "Search exploded on injection string", String(q.status), "agent");
    else pass(`search injection-safe → 200 n=${Array.isArray(q.body) ? q.body.length : "?"}`);
  }

  // --- Global ticket number uniqueness snapshot ---
  console.log("\n=== GLOBAL ID SNAPSHOT ===");
  {
    await login(USERS.admin);
    const janeCust = await ensureDirectoryCustomer();
    const j = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: janeCust.id || undefined,
        customerName: janeCust.name,
        customerEmail: janeCust.email || undefined,
        customerPhone: janeCust.phone || undefined,
        subject: `Glob J ${Date.now()}`,
        description: "Global uniqueness snapshot admin",
        priority: "low",
      }),
    });
    await login(USERS.agent);
    const agentCust = await ensureDirectoryCustomer();
    const a = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: agentCust.id || undefined,
        customerName: agentCust.name,
        customerEmail: agentCust.email || undefined,
        customerPhone: agentCust.phone || undefined,
        subject: `Glob A ${Date.now()}`,
        description: "Global uniqueness snapshot agent",
        priority: "low",
      }),
    });
    if (j.status === 201 && a.status === 201 && j.body?.id !== a.body?.id) {
      pass(`cross-org ids ${j.body.id} ≠ ${a.body.id}`);
    } else if (j.body?.id === a.body?.id) {
      find("CRITICAL", "tickets", "Cross-org ticket ids collided", j.body?.id);
    } else find("HIGH", "tickets", "Global snapshot create failed", `${j.status}/${a.status}`);
  }

  const bySev = { CRITICAL: 0, HIGH: 0, MED: 0, LOW: 0 };
  for (const f of findings) bySev[f.sev] = (bySev[f.sev] || 0) + 1;
  const report = {
    started,
    finished: new Date().toISOString(),
    passed: checks.length,
    failed: findings.length,
    bySeverity: bySev,
    findings,
    checks,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n======== LOOPHOLE HUNT SUMMARY ========");
  console.log(JSON.stringify(bySev));
  console.log(`Passed: ${checks.length} · Findings: ${findings.length}`);
  console.log(`Report: ${OUT}`);
  process.exit(bySev.CRITICAL + bySev.HIGH > 0 ? 2 : findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
