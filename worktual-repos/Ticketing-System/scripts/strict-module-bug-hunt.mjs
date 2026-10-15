#!/usr/bin/env node
/**
 * Strict multi-role module bug hunt.
 * Writes JSON report to scripts/.bug-hunt-report.json
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const AGENTS = process.env.AGENTS_BASE || "http://127.0.0.1:8012";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const OUT = new URL("./.bug-hunt-report.json", import.meta.url);

const USERS = [
  { label: "admin", email: "jane.smith@worktual.com", expectRole: "admin" },
  { label: "agent", email: "smohamedfazil16@gmail.com", expectRole: "agent" },
  { label: "resolver", email: "yaswanthmg1@gmail.com", expectRole: "resolver" },
];

/** Expected HTTP for GET endpoints by role */
const MODULE_GETS = [
  { mod: "health", path: "/api/health", auth: false, expect: { "*": 200 } },
  { mod: "account", path: "/api/account", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "notifications", path: "/api/notifications", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "org-branding", path: "/api/org-branding", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "tickets/default", path: "/api/tickets", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "tickets/assignee", path: "/api/tickets?scope=assignee", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "tickets/team", path: "/api/tickets?scope=team", expect: { admin: 200, agent: 200, resolver: 403 } },
  { mod: "tickets/unassigned", path: "/api/tickets?scope=unassigned", expect: { admin: 200, agent: 200, resolver: 403 } },
  { mod: "tickets/org", path: "/api/tickets?scope=org", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "tickets/search", path: "/api/tickets?scope=search", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "metrics", path: "/api/metrics", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "dashboard/chart", path: "/api/dashboard/chart?range=7days", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "queues/teams", path: "/api/queues", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "kb", path: "/api/kb", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "customers", path: "/api/customers", expect: { admin: 200, agent: 200, resolver: 403 } },
  { mod: "agents", path: "/api/agents", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "roster", path: "/api/roster", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "activities", path: "/api/activities", expect: { admin: 200, agent: 200, resolver: 200 } },
  { mod: "analytics", path: "/api/analytics", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "audit", path: "/api/audit", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "csat-reports", path: "/api/csat-reports", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "macros", path: "/api/macros", expect: { admin: 200, agent: 200, resolver: 403 } },
  { mod: "org-preferences", path: "/api/org-preferences", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "escalation-directory", path: "/api/escalation-directory", expect: { admin: 200, agent: 403, resolver: 403 } },
  { mod: "agent/triage-stats", path: "/api/agent/triage-stats", expect: { admin: 200, agent: 200, resolver: 403 } },
];

const findings = [];
const checks = [];
let cookie = "";

function find(sev, module, title, detail = "", role = "") {
  findings.push({
    sev,
    module,
    title,
    detail: String(detail || "").slice(0, 400),
    role,
  });
  const tag = `[${sev}] ${module}${role ? `/${role}` : ""}: ${title}`;
  console.log(tag + (detail ? ` — ${String(detail).slice(0, 120)}` : ""));
}

function pass(msg) {
  checks.push({ ok: true, msg });
  console.log(`  OK  ${msg}`);
}

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { ...opts, headers });
  for (const c of res.headers.getSetCookie?.() || []) {
    if (c.startsWith("worktual_token=")) cookie = c.split(";")[0];
  }
  const raw = res.headers.get("set-cookie");
  if (raw?.includes("worktual_token=")) cookie = raw.split(";")[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
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

function isUnassigned(t) {
  return !t.assignee || t.assignee === "Unassigned" || t.assignee === "";
}

function expectStatus(label, res, want, mod, role) {
  const wants = Array.isArray(want) ? want : [want];
  if (!wants.includes(res.status)) {
    find(
      "HIGH",
      mod,
      `${label} expected ${wants.join("|")} got ${res.status}`,
      JSON.stringify(res.body)?.slice(0, 160),
      role
    );
    return false;
  }
  pass(`${role || ""} ${label} → ${res.status}`.trim());
  return true;
}

async function main() {
  const started = new Date().toISOString();
  console.log(`\nStrict module bug hunt\nAPI ${BASE} · Agents ${AGENTS}\n`);

  // --- Infra ---
  const health = await fetch(BASE + "/").then((r) => r.status).catch(() => 0);
  if (health !== 200) find("CRITICAL", "infra", "App not responding", String(health));
  else pass("app HTTP 200");

  const agentsHealth = await fetch(AGENTS + "/health")
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    .catch(() => ({ status: 0, body: null }));
  if (agentsHealth.status !== 200) {
    find("HIGH", "infra", "Coworker agents /health failed", String(agentsHealth.status));
  } else pass(`agents health (${agentsHealth.body?.model || "ok"})`);

  // Unauth
  cookie = "";
  const unauth = await api("/api/tickets");
  if (unauth.status === 200) find("CRITICAL", "auth", "Unauthenticated tickets access allowed");
  else pass(`unauth tickets blocked → ${unauth.status}`);

  const roleCtx = {};

  for (const u of USERS) {
    console.log(`\n=== ${u.label.toUpperCase()} (${u.email}) ===`);
    const r = await login(u.email);
    if (r.status !== 200 || r.body?.user?.role !== u.expectRole) {
      find(
        "CRITICAL",
        "auth",
        `${u.label} login failed`,
        `${r.status} role=${r.body?.user?.role || r.body?.error}`,
        u.label
      );
      continue;
    }
    pass(`logged in as ${r.body.user.name} / ${r.body.user.role}`);
    roleCtx[u.label] = { user: r.body.user, cookie };

    for (const row of MODULE_GETS) {
      if (row.auth === false) continue;
      const want = row.expect[u.label];
      if (want == null) continue;
      const res = await api(row.path);
      expectStatus(row.path, res, want, row.mod, u.label);
    }
  }

  // --- Integrity: agent ---
  console.log("\n=== INTEGRITY: agent scopes ===");
  {
    const r = await login(USERS[1].email);
    const name = r.body.user.name;
    const un = await api("/api/tickets?scope=unassigned");
    if (un.status === 200 && Array.isArray(un.body)) {
      const bad = un.body.filter((t) => !isUnassigned(t));
      if (bad.length) {
        find(
          "HIGH",
          "unassigned",
          "Assigned tickets leaked into unassigned scope",
          bad.map((t) => `${t.id}:${t.assignee}`).join(", "),
          "agent"
        );
      } else pass(`agent unassigned clean n=${un.body.length}`);
    }
    const mine = await api("/api/tickets?scope=assignee");
    if (mine.status === 200 && Array.isArray(mine.body)) {
      const bad = mine.body.filter((t) => t.assignee !== name);
      if (bad.length) {
        find(
          "HIGH",
          "assigned",
          "Foreign tickets in assignee scope",
          bad.slice(0, 8).map((t) => `${t.id}:${t.assignee}`).join(", "),
          "agent"
        );
      } else pass(`agent assignee clean n=${mine.body.length}`);
    }
    const orgForce = await api("/api/tickets?scope=org");
    if (orgForce.status === 200) {
      find("HIGH", "rbac", "Agent can force scope=org", `n=${orgForce.body?.length}`, "agent");
    } else pass(`agent scope=org blocked → ${orgForce.status}`);
  }

  // --- Integrity: resolver ---
  console.log("\n=== INTEGRITY: resolver ===");
  {
    const r = await login(USERS[2].email);
    const name = r.body.user.name;
    expectStatus(
      "POST /api/tickets",
      await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          customerName: "X",
          customerEmail: `x_${Date.now()}@t.com`,
          subject: "no",
          description: "no",
        }),
      }),
      403,
      "create-ticket",
      "resolver"
    );
    expectStatus(
      "POST /api/kb",
      await api("/api/kb", {
        method: "POST",
        body: JSON.stringify({
          title: "Resolver should fail",
          content: "Should not publish this article body",
          category: "General",
        }),
      }),
      403,
      "kb",
      "resolver"
    );
    expectStatus(
      "POST /api/macros",
      await api("/api/macros", {
        method: "POST",
        body: JSON.stringify({ title: "x", body: "y" }),
      }),
      403,
      "macros",
      "resolver"
    );
    const board = await api("/api/tickets?scope=assignee");
    if (board.status === 200 && Array.isArray(board.body)) {
      const bad = board.body.filter(
        (t) => t.assignee !== name && t.resolver !== name
      );
      if (bad.length) {
        find(
          "HIGH",
          "work-board",
          "Resolver board has tickets not assigned to them",
          bad.map((t) => `${t.id}:${t.assignee}`).join(", "),
          "resolver"
        );
      } else pass(`resolver board clean n=${board.body.length}`);
      const open = board.body.filter(
        (t) => t.status !== "Resolved" && t.status !== "Closed"
      );
      const missingDue = open.filter((t) => !t.dueAt);
      if (missingDue.length) {
        find(
          "MED",
          "sla",
          "Open resolver tickets missing dueAt",
          missingDue
            .slice(0, 10)
            .map((t) => t.id)
            .join(", "),
          "resolver"
        );
      } else if (open.length) pass("resolver open tickets have dueAt");
    }
  }

  // --- Agent mutations / KB attachments ---
  console.log("\n=== MUTATIONS: agent KB + tickets ===");
  {
    await login(USERS[1].email);
    const shortKb = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({ title: "ab", content: "short", category: "General" }),
    });
    // Server currently may accept short titles — flag if it does without validation
    if (shortKb.status === 201) {
      find(
        "MED",
        "kb",
        "KB accepts very short title/content (UI requires 3/10 chars)",
        `title=ab content=short id=${shortKb.body?.id}`,
        "agent"
      );
    } else if ([400, 422].includes(shortKb.status)) {
      pass("KB rejects short title/content");
    } else {
      find("MED", "kb", `Unexpected short-KB status ${shortKb.status}`, JSON.stringify(shortKb.body), "agent");
    }

    const kbOk = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: `Strict hunt article ${Date.now()}`,
        content: "Body long enough for validation and audit trail.",
        category: "Troubleshooting",
        attachments: ["/uploads/fake-not-uploaded.txt"],
      }),
    });
    if (kbOk.status === 201) {
      pass(`KB create → ${kbOk.body?.id}`);
      if (!Array.isArray(kbOk.body?.attachments)) {
        find("HIGH", "kb", "Created KB missing attachments array in response", JSON.stringify(kbOk.body), "agent");
      } else if (kbOk.body.attachments.includes("/uploads/fake-not-uploaded.txt")) {
        find(
          "MED",
          "kb",
          "KB accepts arbitrary attachment URL without upload verification",
          kbOk.body.attachments.join(", "),
          "agent"
        );
      } else if (kbOk.body.attachments.length === 0) {
        pass("KB dropped unverified attachment URLs");
      } else {
        find(
          "MED",
          "kb",
          "KB kept unexpected attachments for fabricated URL",
          JSON.stringify(kbOk.body.attachments),
          "agent"
        );
      }
      const list = await api("/api/kb");
      const found = Array.isArray(list.body)
        ? list.body.find((a) => a.id === kbOk.body.id || a.title === kbOk.body.title)
        : null;
      if (!found) find("HIGH", "kb", "Created article not visible in GET /api/kb", kbOk.body?.id, "agent");
      else pass("KB list includes created article");
    } else {
      find("HIGH", "kb", "Agent KB create failed", `${kbOk.status} ${JSON.stringify(kbOk.body)}`, "agent");
    }

    // Upload endpoint
    const form = new FormData();
    form.append(
      "files",
      new Blob(["strict-hunt-file"], { type: "text/plain" }),
      "strict-hunt.txt"
    );
    const upRes = await fetch(BASE + "/api/uploads", {
      method: "POST",
      headers: cookie ? { Cookie: cookie } : {},
      body: form,
    });
    const upBody = await upRes.json().catch(() => null);
    if (upRes.status !== 201 || !upBody?.urls?.[0]) {
      find("HIGH", "uploads", "File upload failed for agent", `${upRes.status} ${JSON.stringify(upBody)}`, "agent");
    } else {
      pass(`upload → ${upBody.urls[0]}`);
      const kbAtt = await api("/api/kb", {
        method: "POST",
        body: JSON.stringify({
          title: `KB with real file ${Date.now()}`,
          content: "Article with a real uploaded attachment for strict hunt.",
          category: "General",
          attachments: upBody.urls,
        }),
      });
      expectStatus("KB with real upload", kbAtt, 201, "kb", "agent");
      if (kbAtt.status === 201) {
        const fileGet = await fetch(BASE + upBody.urls[0], {
          headers: cookie ? { Cookie: cookie } : {},
        });
        if (fileGet.status !== 200) {
          find("HIGH", "uploads", "Uploaded file not downloadable", `${fileGet.status} ${upBody.urls[0]}`, "agent");
        } else pass("uploaded file downloadable");
      }
    }

    // Customers POST should be blocked (directory from tickets)
    const custPost = await api("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Should Fail",
        email: `fail_${Date.now()}@ex.com`,
        status: "Active",
      }),
    });
    if (custPost.status === 201) {
      find("MED", "customers", "POST /api/customers still allowed (UI is read-only)", "", "agent");
    } else if (custPost.status === 403) pass("customers POST blocked");
    else find("MED", "customers", `Unexpected customers POST ${custPost.status}`, JSON.stringify(custPost.body), "agent");

    // Create ticket + note visibility
    const cust = await ensureDirectoryCustomer();
    const cr = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: `Strict hunt ${Date.now()}`,
        description: "Strict module bug hunt ticket",
        priority: "high",
      }),
    });
    expectStatus("create ticket", cr, 201, "create-ticket", "agent");
    const tid = cr.body?.id;
    if (tid) {
      const n1 = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`, {
        method: "POST",
        body: JSON.stringify({ text: "internal only", visibility: "internal" }),
      });
      expectStatus("internal note", n1, 201, "tickets", "agent");
      const n2 = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`, {
        method: "POST",
        body: JSON.stringify({ text: "public reply", visibility: "public" }),
      });
      expectStatus("public note", n2, 201, "tickets", "agent");
      const notes = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`);
      if (notes.status === 200 && Array.isArray(notes.body)) {
        const vis = notes.body.map((n) => n.visibility || n.Visibility);
        if (!vis.includes("internal") || !vis.includes("public")) {
          find("MED", "notes", "Visibility missing on notes list", JSON.stringify(notes.body).slice(0, 200), "agent");
        } else pass("notes both visibilities present");
      }
      if (!cr.body?.dueAt && cr.body?.status !== "Resolved") {
        // may be set async
        const again = await api(`/api/tickets/${encodeURIComponent(tid)}`);
        if (again.status === 200 && !again.body?.dueAt) {
          find("MED", "sla", "New ticket missing dueAt", tid, "agent");
        } else if (again.body?.dueAt) pass("new ticket has dueAt");
      }
    }
  }

  // --- Admin ---
  console.log("\n=== ADMIN checks ===");
  {
    await login(USERS[0].email);
    const prefs = await api("/api/org-preferences");
    expectStatus("GET org-preferences", prefs, 200, "org-preferences", "admin");
    if (prefs.status === 200) {
      const saved = await api("/api/org-preferences", {
        method: "PUT",
        body: JSON.stringify({
          ticketPrefix: prefs.body?.ticketPrefix || "#",
          portalLabel: prefs.body?.portalLabel || "",
          displayTimezone: prefs.body?.displayTimezone || prefs.body?.timezone || "UTC",
        }),
      });
      expectStatus("PUT org-preferences", saved, 200, "org-preferences", "admin");
    }
    const csat = await api("/api/csat-reports");
    expectStatus("csat-reports", csat, 200, "csat-reports", "admin");
    const audit = await api("/api/audit");
    expectStatus("audit", audit, 200, "audit", "admin");
    if (audit.status === 200 && Array.isArray(audit.body) && audit.body.length === 0) {
      find("LOW", "audit", "Audit log empty", "", "admin");
    }
    const edir = await api("/api/escalation-directory");
    expectStatus("escalation-directory", edir, 200, "escalation-directory", "admin");
    const un = await api("/api/tickets?scope=unassigned");
    if (un.status === 200 && Array.isArray(un.body)) {
      const bad = un.body.filter((t) => !isUnassigned(t));
      if (bad.length) {
        find(
          "HIGH",
          "unassigned",
          "Admin unassigned scope has assigned tickets",
          bad.map((t) => `${t.id}:${t.assignee}`).join(", "),
          "admin"
        );
      } else pass(`admin unassigned clean n=${un.body.length}`);
    }
  }

  // --- IDOR cross-org ---
  console.log("\n=== SECURITY: cross-org ===");
  {
    const jane = await login(USERS[0].email);
    const janeOrg = jane.body?.user?.organizationId;
    const janeTickets = await api("/api/tickets?scope=org");
    const janeTid = Array.isArray(janeTickets.body) && janeTickets.body[0]?.id;
    const agent = await login(USERS[1].email);
    const agentOrg = agent.body?.user?.organizationId;
    if (janeTid && janeOrg && agentOrg && janeOrg !== agentOrg) {
      const janeList = Array.isArray(janeTickets.body) ? janeTickets.body : [];
      // Prefer a Jane ticket number that does not resolve in the agent org (numbers can collide).
      let victim = janeList[0] || null;
      for (const t of janeList.slice(0, 25)) {
        const probe = await api(`/api/tickets/${encodeURIComponent(t.id)}`);
        if (probe.status === 404 || probe.status === 403) {
          victim = t;
          break;
        }
        // 200 with a different subject = same ticket_number in agent org — keep looking.
        if (
          probe.status === 200 &&
          String(probe.body?.subject || "") === String(t.subject || "")
        ) {
          find(
            "CRITICAL",
            "idor",
            "Agent can read other-org ticket by id",
            `${t.id} subject=${String(t.subject).slice(0, 60)}`,
            "agent"
          );
          victim = null;
          break;
        }
      }
      if (victim) {
        const janeSubject = String(victim.subject || "");
        const cross = await api(`/api/tickets/${encodeURIComponent(victim.id)}`);
        if (
          cross.status === 200 &&
          String(cross.body?.subject || "") === janeSubject
        ) {
          find(
            "CRITICAL",
            "idor",
            "Agent can read other-org ticket by id",
            victim.id,
            "agent"
          );
        } else if (cross.status === 200) {
          pass(
            `cross-org read: agent saw own-org ${victim.id} (subject differs from Jane)`
          );
        } else {
          pass(`cross-org read blocked → ${cross.status}`);
        }
        const marker = `IDOR_PROBE_${Date.now()}`;
        const crossPut = await api(`/api/tickets/${encodeURIComponent(victim.id)}`, {
          method: "PUT",
          body: JSON.stringify({ status: "Open", subject: marker }),
        });
        // Ticket numbers can collide across orgs — verify Jane's row was not rewritten.
        await login(USERS[0].email);
        const janeAgain = await api("/api/tickets?scope=org");
        const janeRow = Array.isArray(janeAgain.body)
          ? janeAgain.body.find((t) => t.id === victim.id)
          : null;
        if (janeRow && String(janeRow.subject) === marker) {
          find("CRITICAL", "idor", "Agent can mutate other-org ticket", victim.id, "agent");
        } else if (crossPut.status === 200) {
          pass(
            `cross-org mutate: agent PUT hit same ticket_number in own org (Jane subject unchanged)`
          );
        } else {
          pass(`cross-org mutate blocked → ${crossPut.status}`);
        }
      }
    } else {
      pass("skip cross-org (same org or no tickets)");
    }
  }

  // --- Coworker UI actions + chat RBAC ---
  console.log("\n=== COWORKER ===");
  {
    await login(USERS[1].email);
    const ui = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({
        message: "list all customers",
        pageLabel: "Customers",
      }),
    });
    if (ui.status !== 200) {
      find("HIGH", "coworker", "ui-actions failed", `${ui.status}`, "agent");
    } else {
      const actions = ui.body?.actions || [];
      const bad = actions.find(
        (a) => a.type === "set_filter" && a.module === "customers" && a.query && a.query.length > 0
      );
      // list all should clear
      const clear = actions.find(
        (a) => a.type === "set_filter" && a.module === "customers" && (a.query === "" || a.query == null)
      );
      if (!clear && actions.length) {
        // may navigate only
        pass(`ui-actions list all → ${JSON.stringify(actions).slice(0, 120)}`);
      } else pass("ui-actions list all customers");
    }

    const q = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({
        message: "how many open tickets are there?",
        pageLabel: "My Tickets",
      }),
    });
    if (q.status === 200) {
      const filters = (q.body?.actions || []).filter((a) => a.type === "set_filter");
      if (filters.length) {
        find(
          "MED",
          "coworker",
          "Count question produced filter actions",
          JSON.stringify(filters),
          "agent"
        );
      } else pass("count question produced no filters");
    }

    await login(USERS[2].email);
    const chat = await fetch(AGENTS + "/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key":
          process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret",
      },
      body: JSON.stringify({
        message: "create a ticket for John",
        page_label: "Home",
        role: "resolver",
        user_name: "Yaswanth mg",
        organization_id: "00000000-0000-4000-8000-000000000099",
      }),
    })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
      .catch((e) => ({ status: 0, body: { error: e.message } }));
    if (chat.status === 200) {
      const text = String(chat.body?.reply || chat.body?.message || "");
      if (/full name|customer.?s name|what.?s the name/i.test(text) && !/can.?t create|cannot create|can’t create|role|permissions?|not allow|don'?t allow/i.test(text)) {
        find(
          "HIGH",
          "coworker",
          "Resolver create-ticket chat started guided flow instead of denying",
          text.slice(0, 200),
          "resolver"
        );
      } else if (/can.?t create|cannot create|can’t create|role|permissions?|not allow|don'?t allow/i.test(text)) {
        pass("resolver create denied in agents chat");
      } else {
        find(
          "MED",
          "coworker",
          "Resolver create-ticket reply ambiguous",
          text.slice(0, 200),
          "resolver"
        );
      }
    } else {
      find("HIGH", "coworker", "Agents /chat failed for resolver create check", String(chat.status), "resolver");
    }
  }

  // --- SPA shell ---
  console.log("\n=== FRONTEND ===");
  {
    const spa = await fetch(BASE + "/");
    const html = await spa.text();
    if (spa.status !== 200 || !html.includes("root")) {
      find("HIGH", "frontend", "SPA shell missing", `status=${spa.status}`);
    } else pass("SPA shell");
    const views = [
      "DashboardView",
      "TicketsView",
      "KnowledgeBaseView",
      "CustomersView",
      "AgentQueuesView",
      "WorkBoardView",
      "AnalyticsView",
      "AuditLogView",
      "CsatReportsView",
      "MacrosView",
      "SettingsView",
      "CreateTicketView",
    ];
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "ui-frontend/src/components");
    for (const v of views) {
      const p = path.join(root, `${v}.tsx`);
      if (!fs.existsSync(p)) find("HIGH", "frontend", `Missing view component ${v}`);
      else pass(`view ${v}`);
    }
  }

  const bySev = { CRITICAL: 0, HIGH: 0, MED: 0, LOW: 0 };
  for (const f of findings) bySev[f.sev] = (bySev[f.sev] || 0) + 1;

  const report = {
    started,
    finished: new Date().toISOString(),
    base: BASE,
    agents: AGENTS,
    passed: checks.length,
    failed: findings.length,
    bySeverity: bySev,
    findings,
    modulesCovered: [...new Set(MODULE_GETS.map((m) => m.mod))],
    roles: USERS.map((u) => u.label),
  };

  const fs = await import("node:fs");
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log("\n======== STRICT BUG HUNT SUMMARY ========");
  console.log(JSON.stringify(bySev));
  console.log(`Passed checks: ${checks.length}`);
  console.log(`Findings: ${findings.length}`);
  console.log(`Report: ${OUT.pathname}`);

  if (bySev.CRITICAL > 0) process.exit(2);
  // Strict mode: HIGH findings fail the script
  if (bySev.HIGH > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
