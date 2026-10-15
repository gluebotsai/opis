#!/usr/bin/env node
/**
 * Flow-oriented strict bug hunt — product journeys + wrong-flow detection.
 * Writes scripts/.flow-bug-hunt-report.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const AGENTS = process.env.AGENTS_BASE || "http://127.0.0.1:8012";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, ".flow-bug-hunt-report.json");

const USERS = {
  admin: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com",
  agent: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com",
  resolver: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com",
};

const findings = [];
const checks = [];
const flows = []; // { id, name, status: ok|bug|wrong|skip, notes }
let cookie = "";

function find(sev, module, title, detail = "", role = "", flow = "") {
  findings.push({ sev, module, title, detail: String(detail || "").slice(0, 500), role, flow });
  console.log(
    `[${sev}] ${module}${role ? `/${role}` : ""}${flow ? ` (${flow})` : ""}: ${title}` +
      (detail ? ` — ${String(detail).slice(0, 140)}` : "")
  );
}

function pass(msg) {
  checks.push({ ok: true, msg });
  console.log(`  OK  ${msg}`);
}

function flowResult(id, name, status, notes = "") {
  flows.push({ id, name, status, notes });
  const tag = status === "ok" ? "FLOW-OK" : status === "wrong" ? "FLOW-WRONG" : status === "skip" ? "FLOW-SKIP" : "FLOW-BUG";
  console.log(`  ${tag}  ${id}: ${name}${notes ? ` — ${notes.slice(0, 160)}` : ""}`);
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
  return { status: res.status, body: await res.json().catch(() => null) };
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
  console.log(`\nStrict FLOW bug hunt\nAPI ${BASE} · Agents ${AGENTS}\n`);

  const appOk = (await fetch(BASE + "/").then((r) => r.status).catch(() => 0)) === 200;
  const agOk = await fetch(AGENTS + "/health")
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    .catch(() => ({ status: 0, body: null }));
  if (!appOk) find("CRITICAL", "infra", "App down", "");
  else pass("app up");
  if (agOk.status !== 200) find("CRITICAL", "infra", "Agents down", String(agOk.status));
  else pass(`agents up (${agOk.body?.model || "?"})`);

  // ─── FLOW A: Agent create → enrich assign → creator notes ───
  console.log("\n=== FLOW A: create → enrich → notes (creator) ===");
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
        subject: `Flow A create ${Date.now()}`,
        description: "Need VPN access reset urgently for laptop",
        priority: "high",
      }),
    });
    if (cr.status !== 201) {
      find("HIGH", "create-ticket", "Agent create ticket failed", `${cr.status} ${JSON.stringify(cr.body)}`, "agent", "A");
      flowResult("A", "Create → enrich → creator notes", "bug", `create ${cr.status}`);
    } else {
      const tid = cr.body?.id;
      const assignee = cr.body?.assignee || "";
      const me = (await api("/api/account")).body;
      const myName = me?.user?.name || me?.name || "";
      pass(`create ${tid} assignee=${assignee || "(empty)"}`);

      // Stress: note as creator even if reassigned
      let noteOk = 0;
      let noteFail = 0;
      const noteFails = [];
      for (let i = 0; i < 6; i++) {
        const n = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`, {
          method: "POST",
          body: JSON.stringify({ text: `flow-a note ${i}`, visibility: i % 2 ? "public" : "internal" }),
        });
        if (n.status === 201) noteOk++;
        else {
          noteFail++;
          noteFails.push(n.status);
        }
      }
      if (noteFail > 0) {
        find(
          "HIGH",
          "notes",
          "Creator notes failed after create/enrich",
          `ok=${noteOk} fail=${noteFail} statuses=${noteFails.join(",")} assignee=${assignee} me=${myName}`,
          "agent",
          "A"
        );
        flowResult("A", "Create → enrich → creator notes", "bug", `${noteFail}/6 notes failed`);
      } else {
        pass(`creator notes 6/6 after assign to "${assignee}"`);
        const reassigned = assignee && assignee !== "Unassigned" && assignee.toLowerCase() !== String(myName).toLowerCase();
        flowResult(
          "A",
          "Create → enrich → creator notes",
          "ok",
          reassigned
            ? `enrich reassigned to ${assignee}; creator retained note access`
            : `assignee stayed ${assignee || "self/unassigned"}; notes ok`
        );
      }

      // Progress endpoint
      const prog = await api(`/api/tickets/${encodeURIComponent(tid)}/progress`);
      if (![200, 404].includes(prog.status)) {
        find("MED", "progress", "Unexpected progress status", String(prog.status), "agent", "A");
      } else if (prog.status === 200) pass("progress readable by creator");

      // GET single ticket
      const one = await api(`/api/tickets/${encodeURIComponent(tid)}`);
      if (one.status !== 200) {
        find("HIGH", "tickets", "Creator cannot GET own ticket", `${one.status}`, "agent", "A");
      } else pass("GET ticket by id as creator");
    }
  }

  // ─── FLOW B: Resolver must not create (API + Express chat + Agents chat) ───
  console.log("\n=== FLOW B: resolver create-ticket denial ===");
  {
    await login(USERS.resolver);
    const post = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Should Fail",
        customerEmail: `fail_${Date.now()}@ex.com`,
        subject: "Resolver should not create",
        description: "blocked",
      }),
    });
    if (post.status !== 403) {
      find("CRITICAL", "rbac", "Resolver POST /api/tickets not 403", String(post.status), "resolver", "B");
      flowResult("B", "Resolver create denial", "bug", `API ${post.status}`);
    } else {
      pass("resolver API create 403");

      const expressChat = await api("/api/coworker/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "create a ticket for John",
          page: "Home",
          session_id: `flow-b-${Date.now()}`,
        }),
      });
      const exText = String(expressChat.body?.reply || "");
      const denied = /can.?t create|cannot create|can’t create|role|permissions?|not allow|don'?t allow/i.test(exText);
      const guided = /full name|customer.?s name|what.?s the name|email/i.test(exText) && !denied;

      const agentsChat = await fetch(AGENTS + "/chat", {
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
      const agText = String(agentsChat.body?.reply || "");
      const agDenied = /can.?t create|cannot create|can’t create|role|permissions?|not allow|don'?t allow/i.test(agText);
      const agGuided = /full name|customer.?s name|what.?s the name/i.test(agText) && !agDenied;

      if (guided) {
        find("HIGH", "coworker", "Express chat starts create flow for resolver", exText.slice(0, 200), "resolver", "B");
      } else if (denied) pass("express chat denies resolver create");
      else find("MED", "coworker", "Express resolver create reply ambiguous", exText.slice(0, 200), "resolver", "B");

      if (agGuided) {
        find("HIGH", "coworker", "Agents chat starts create flow for resolver", agText.slice(0, 200), "resolver", "B");
      } else if (agDenied) pass("agents chat denies resolver create");
      else find("MED", "coworker", "Agents resolver create reply ambiguous", agText.slice(0, 200), "resolver", "B");

      if (!guided && !agGuided && denied && agDenied) {
        flowResult("B", "Resolver create denial", "ok", "API + Express + Agents all deny");
      } else if (guided || agGuided) {
        flowResult("B", "Resolver create denial", "wrong", "guided create started for non-creator role");
      } else {
        flowResult("B", "Resolver create denial", "bug", "incomplete denial coverage");
      }
    }
  }

  // ─── FLOW C: Agent guided create via Express coworker ───
  console.log("\n=== FLOW C: agent coworker create intent ===");
  {
    await login(USERS.agent);
    const chat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "create a ticket for Alice",
        page: "Create Ticket",
        session_id: `flow-c-${Date.now()}`,
      }),
    });
    const text = String(chat.body?.reply || "");
    if (chat.status !== 200) {
      find("HIGH", "coworker", "Agent create chat failed", String(chat.status), "agent", "C");
      flowResult("C", "Agent coworker create intent", "bug", `status ${chat.status}`);
    } else if (/can.?t create|cannot create|can’t create/i.test(text)) {
      find("HIGH", "coworker", "Agent wrongly denied create in chat", text.slice(0, 200), "agent", "C");
      flowResult("C", "Agent coworker create intent", "wrong", "agent denied create");
    } else if (/name|email|issue|subject|customer|alice/i.test(text)) {
      pass("agent create chat engages guided/helpful reply");
      flowResult("C", "Agent coworker create intent", "ok", text.slice(0, 100));
    } else {
      find("MED", "coworker", "Agent create chat reply unclear", text.slice(0, 200), "agent", "C");
      flowResult("C", "Agent coworker create intent", "wrong", "unclear reply");
    }
  }

  // ─── FLOW D: Escalate ───
  console.log("\n=== FLOW D: escalate ===");
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
        subject: `Escalate flow ${Date.now()}`,
        description: "Escalation path test for network outage",
        priority: "high",
      }),
    });
    if (cr.status !== 201) {
      find("HIGH", "escalate", "Create for escalate failed", String(cr.status), "agent", "D");
      flowResult("D", "Escalate ticket", "bug", `create ${cr.status}`);
    } else {
      const tid = cr.body.id;
      const esc = await api(`/api/tickets/${encodeURIComponent(tid)}/escalate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (esc.status === 200 || esc.status === 201) {
        const agentKept = esc.body?.ticket?.assignee || esc.body?.assignee || "";
        const resolver = esc.body?.ticket?.resolver || esc.body?.resolver || "";
        if (!resolver) {
          find("HIGH", "escalate", "Escalate did not set resolver", JSON.stringify(esc.body)?.slice(0, 120), "agent", "D");
          flowResult("D", "Escalate ticket", "bug", "missing resolver");
        } else {
          pass(`escalate → ${esc.status} agent=${agentKept || "?"} resolver=${resolver}`);
          // Creator should still note (L1 kept)
          const n = await api(`/api/tickets/${encodeURIComponent(tid)}/notes`, {
            method: "POST",
            body: JSON.stringify({ text: "post-escalate note", visibility: "internal" }),
          });
          if (n.status !== 201) {
            find("HIGH", "escalate", "Creator lost note access after escalate", String(n.status), "agent", "D");
            flowResult("D", "Escalate ticket", "bug", `notes ${n.status} after escalate`);
          } else {
            pass("creator notes after escalate");
            flowResult("D", "Escalate ticket", "ok", `resolver=${resolver}`);
          }
        }
      } else if (esc.status === 400 || esc.status === 404) {
        // no resolver available may be env
        find("MED", "escalate", "Escalate rejected", `${esc.status} ${JSON.stringify(esc.body)?.slice(0, 120)}`, "agent", "D");
        flowResult("D", "Escalate ticket", "wrong", `escalate ${esc.status}`);
      } else {
        find("HIGH", "escalate", "Escalate unexpected status", String(esc.status), "agent", "D");
        flowResult("D", "Escalate ticket", "bug", `status ${esc.status}`);
      }
    }
  }

  // ─── FLOW E: KB create validation + attachments ───
  console.log("\n=== FLOW E: KB create validation ===");
  {
    await login(USERS.agent);
    const short = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({ title: "ab", content: "short", category: "General" }),
    });
    if ([400, 422].includes(short.status)) pass("KB rejects short");
    else {
      find("MED", "kb", "KB accepts short title/content", String(short.status), "agent", "E");
    }

    const fake = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: `Flow E fake att ${Date.now()}`,
        content: "Long enough body for KB validation rules.",
        category: "General",
        attachments: ["/uploads/does-not-exist-xyz.txt"],
      }),
    });
    if (fake.status === 201 && Array.isArray(fake.body?.attachments) && fake.body.attachments.length === 0) {
      pass("KB drops fake attachments");
    } else if (fake.status === 201 && fake.body?.attachments?.includes("/uploads/does-not-exist-xyz.txt")) {
      find("MED", "kb", "KB accepts unverified attachment URL", JSON.stringify(fake.body.attachments), "agent", "E");
    } else if (fake.status !== 201) {
      find("HIGH", "kb", "KB create with fake att failed entirely", String(fake.status), "agent", "E");
    }

    await login(USERS.resolver);
    const resKb = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: "Resolver KB should fail",
        content: "Resolver must not mutate knowledge base articles.",
        category: "General",
      }),
    });
    if (resKb.status === 403) pass("resolver KB mutate blocked");
    else find("HIGH", "kb", "Resolver can create KB", String(resKb.status), "resolver", "E");

    const kbBugs = findings.filter((f) => f.flow === "E");
    flowResult("E", "KB create + RBAC", kbBugs.length ? "bug" : "ok", kbBugs.length ? `${kbBugs.length} issue(s)` : "validation + resolver gate ok");
  }

  // ─── FLOW F: Resolver board vs team queue ───
  console.log("\n=== FLOW F: resolver scopes ===");
  {
    await login(USERS.resolver);
    const mine = await api("/api/tickets?scope=assignee");
    const team = await api("/api/tickets?scope=team");
    const un = await api("/api/tickets?scope=unassigned");
    const org = await api("/api/tickets?scope=org");
    if (mine.status !== 200) find("HIGH", "tickets", "Resolver assignee scope failed", String(mine.status), "resolver", "F");
    else {
      const bad = (mine.body || []).filter(
        (t) =>
          ![t.assignee, t.resolver].some((name) =>
            /yaswanth/i.test(String(name || ""))
          )
      );
      if (bad.length) {
        find(
          "HIGH",
          "tickets",
          "Resolver assignee scope leaked others",
          bad.slice(0, 3).map((t) => `${t.id}:${t.assignee}`).join(", "),
          "resolver",
          "F"
        );
      } else pass(`resolver board n=${(mine.body || []).length}`);
    }
    if (team.status !== 403) find("MED", "tickets", "Resolver team scope should be 403", String(team.status), "resolver", "F");
    else pass("resolver team 403");
    if (un.status !== 403) find("MED", "tickets", "Resolver unassigned should be 403", String(un.status), "resolver", "F");
    else pass("resolver unassigned 403");
    if (org.status !== 403) find("HIGH", "tickets", "Resolver org scope should be 403", String(org.status), "resolver", "F");
    else pass("resolver org 403");

    const fBugs = findings.filter((f) => f.flow === "F");
    flowResult("F", "Resolver scope matrix", fBugs.length ? "bug" : "ok", "assignee only; team/unassigned/org blocked");
  }

  // ─── FLOW G: Agent mutates non-assignee via creator privilege overreach? ───
  console.log("\n=== FLOW G: creator access after foreign assign ===");
  {
    await login(USERS.agent);
    const list = await api("/api/tickets?scope=search");
    const tickets = Array.isArray(list.body) ? list.body : [];
    const me = (await api("/api/account")).body;
    const myName = String(me?.user?.name || me?.name || "");
    // Find ticket assigned to someone else that we can still GET (creator path)
    let foreign = null;
    for (const t of tickets.slice(0, 40)) {
      if (t.assignee && t.assignee !== "Unassigned" && t.assignee.toLowerCase() !== myName.toLowerCase()) {
        const g = await api(`/api/tickets/${encodeURIComponent(t.id)}`);
        if (g.status === 200) {
          foreign = { t, g };
          break;
        }
      }
    }
    if (!foreign) {
      flowResult("G", "Creator access to reassigned tickets", "skip", "no reassigned-visible ticket in search sample");
    } else {
      const put = await api(`/api/tickets/${encodeURIComponent(foreign.t.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: foreign.g.body?.status || foreign.t.status || "Open" }),
      });
      // Product intent: creator retains access — note as expected, but flag if they can reassign away from current owner freely
      const steal = await api(`/api/tickets/${encodeURIComponent(foreign.t.id)}`, {
        method: "PUT",
        body: JSON.stringify({ assignee: myName }),
      });
      if (steal.status === 200 && String(steal.body?.assignee) === myName) {
        find(
          "MED",
          "tickets",
          "Creator can reassign ticket away from current assignee",
          `${foreign.t.id} was ${foreign.t.assignee} → ${myName}`,
          "agent",
          "G"
        );
        flowResult(
          "G",
          "Creator access to reassigned tickets",
          "wrong",
          "creator retained full mutate incl. steal-assignee; product may want note-only after handoff"
        );
        // restore
        await api(`/api/tickets/${encodeURIComponent(foreign.t.id)}`, {
          method: "PUT",
          body: JSON.stringify({ assignee: foreign.t.assignee }),
        });
      } else if (put.status === 200) {
        pass("creator can update own-created reassigned ticket (status)");
        flowResult("G", "Creator access to reassigned tickets", "ok", "status update ok; steal blocked or unchanged");
      } else {
        find("MED", "tickets", "Creator cannot update reassigned ticket", String(put.status), "agent", "G");
        flowResult("G", "Creator access to reassigned tickets", "bug", `PUT ${put.status}`);
      }
    }
  }

  // ─── FLOW H: Cross-org isolation ───
  console.log("\n=== FLOW H: cross-org isolation ===");
  {
    const jane = await login(USERS.admin);
    const janeOrg = jane.body?.user?.organizationId;
    const janeTickets = await api("/api/tickets?scope=org");
    const agent = await login(USERS.agent);
    const agentOrg = agent.body?.user?.organizationId;
    if (!janeOrg || !agentOrg || janeOrg === agentOrg) {
      flowResult("H", "Cross-org isolation", "skip", "same org or missing");
    } else {
      const janeList = Array.isArray(janeTickets.body) ? janeTickets.body : [];
      let victim = null;
      for (const t of janeList.slice(0, 30)) {
        const probe = await api(`/api/tickets/${encodeURIComponent(t.id)}`);
        if (probe.status === 404 || probe.status === 403) {
          victim = t;
          break;
        }
        if (probe.status === 200 && String(probe.body?.subject) === String(t.subject)) {
          find("CRITICAL", "idor", "Agent reads other-org ticket", t.id, "agent", "H");
          victim = null;
          break;
        }
      }
      if (victim) {
        const marker = `FLOW_H_${Date.now()}`;
        const put = await api(`/api/tickets/${encodeURIComponent(victim.id)}`, {
          method: "PUT",
          body: JSON.stringify({ subject: marker }),
        });
        await login(USERS.admin);
        const again = await api("/api/tickets?scope=org");
        const row = (again.body || []).find((t) => t.id === victim.id);
        if (row && row.subject === marker) {
          find("CRITICAL", "idor", "Agent mutated other-org ticket", victim.id, "agent", "H");
          flowResult("H", "Cross-org isolation", "bug", "mutate leaked");
        } else {
          pass(`cross-org ok (put=${put.status}, Jane subject intact)`);
          flowResult("H", "Cross-org isolation", "ok", "org-scoped; ticket_number collisions handled");
        }
      } else if (!findings.some((f) => f.flow === "H" && f.sev === "CRITICAL")) {
        flowResult("H", "Cross-org isolation", "ok", "no exclusive victim; no subject match IDOR");
      }
    }
  }

  // ─── FLOW I: Customers directory read-only ───
  console.log("\n=== FLOW I: customers directory ===");
  {
    await login(USERS.agent);
    const list = await api("/api/customers");
    if (list.status !== 200) find("HIGH", "customers", "Agent customers list failed", String(list.status), "agent", "I");
    else pass(`customers n=${(list.body || []).length}`);
    const post = await api("/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "X", email: `x_${Date.now()}@e.com`, status: "Active" }),
    });
    if (post.status === 201) {
      find("MED", "customers", "Customers POST still allowed (UI read-only)", "", "agent", "I");
      flowResult("I", "Customers directory", "wrong", "POST still creates; UI is read-only directory");
    } else if (post.status === 403 || post.status === 404 || post.status === 405) {
      pass(`customers POST blocked ${post.status}`);
      flowResult("I", "Customers directory", "ok", "read-only");
    } else {
      find("MED", "customers", `Unexpected customers POST ${post.status}`, JSON.stringify(post.body), "agent", "I");
      flowResult("I", "Customers directory", "wrong", `POST ${post.status}`);
    }

    await login(USERS.resolver);
    const r = await api("/api/customers");
    if (r.status !== 403) {
      find("MED", "customers", "Resolver customers should be 403", String(r.status), "resolver", "I");
    } else pass("resolver customers 403");
  }

  // ─── FLOW J: Macros RBAC ───
  console.log("\n=== FLOW J: macros ===");
  {
    await login(USERS.agent);
    const m = await api("/api/macros");
    if (m.status !== 200) find("HIGH", "macros", "Agent macros GET failed", String(m.status), "agent", "J");
    else pass(`macros n=${(m.body || []).length}`);
    await login(USERS.resolver);
    const rm = await api("/api/macros");
    const rpm = await api("/api/macros", {
      method: "POST",
      body: JSON.stringify({ name: "x", body: "y" }),
    });
    if (rm.status !== 403) find("MED", "macros", "Resolver macros GET should 403", String(rm.status), "resolver", "J");
    else pass("resolver macros GET 403");
    if (rpm.status !== 403) find("HIGH", "macros", "Resolver macros POST should 403", String(rpm.status), "resolver", "J");
    else pass("resolver macros POST 403");
    flowResult("J", "Macros RBAC", findings.some((f) => f.flow === "J") ? "bug" : "ok", "");
  }

  // ─── FLOW K: UI-actions vs chat (count should not filter) ───
  console.log("\n=== FLOW K: coworker ui-actions ===");
  {
    await login(USERS.agent);
    const q = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({ message: "how many open tickets are there?", pageLabel: "My Tickets" }),
    });
    if (q.status !== 200) {
      find("HIGH", "coworker", "ui-actions failed", String(q.status), "agent", "K");
      flowResult("K", "Coworker ui-actions counts", "bug", String(q.status));
    } else {
      const filters = (q.body?.actions || []).filter((a) => a.type === "set_filter");
      if (filters.length) {
        find("MED", "coworker", "Count question produced filter actions", JSON.stringify(filters), "agent", "K");
        flowResult("K", "Coworker ui-actions counts", "wrong", "count intent applied set_filter");
      } else {
        pass("count → no filters");
        flowResult("K", "Coworker ui-actions counts", "ok", "");
      }
    }
  }

  // ─── FLOW L: SLA dueAt on new ticket ───
  console.log("\n=== FLOW L: SLA dueAt ===");
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
        subject: `SLA ${Date.now()}`,
        description: "Check dueAt is set for open ticket",
        priority: "medium",
      }),
    });
    if (cr.status !== 201) {
      find("HIGH", "sla", "Create for SLA failed", String(cr.status), "agent", "L");
      flowResult("L", "SLA dueAt on create", "bug", String(cr.status));
    } else {
      let due = cr.body?.dueAt;
      if (!due) {
        const again = await api(`/api/tickets/${encodeURIComponent(cr.body.id)}`);
        due = again.body?.dueAt;
      }
      if (!due && cr.body?.status !== "Resolved") {
        find("MED", "sla", "New ticket missing dueAt", cr.body.id, "agent", "L");
        flowResult("L", "SLA dueAt on create", "wrong", "dueAt absent on open ticket");
      } else {
        pass(`dueAt=${due}`);
        flowResult("L", "SLA dueAt on create", "ok", String(due));
      }
    }
  }

  // ─── FLOW M: ticket_number uniqueness across orgs ───
  console.log("\n=== FLOW M: ticket_number uniqueness across orgs ===");
  {
    const jane = await login(USERS.admin);
    const jOrg = jane.body?.user?.organizationId;
    const agent = await login(USERS.agent);
    const aOrg = agent.body?.user?.organizationId;
    if (!jOrg || !aOrg || jOrg === aOrg) {
      flowResult("M", "Ticket number uniqueness", "skip", "same org");
    } else {
      await login(USERS.admin);
      const janeCust = await ensureDirectoryCustomer();
      const jCreate = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          customerId: janeCust.id || undefined,
          customerName: janeCust.name,
          customerEmail: janeCust.email || undefined,
          customerPhone: janeCust.phone || undefined,
          subject: `Flow M Jane ${Date.now()}`,
          description: "Cross-org ticket number uniqueness check (admin org)",
          priority: "low",
        }),
      });
      await login(USERS.agent);
      const agentCust = await ensureDirectoryCustomer();
      const aCreate = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          customerId: agentCust.id || undefined,
          customerName: agentCust.name,
          customerEmail: agentCust.email || undefined,
          customerPhone: agentCust.phone || undefined,
          subject: `Flow M Agent ${Date.now()}`,
          description: "Cross-org ticket number uniqueness check (agent org)",
          priority: "low",
        }),
      });
      if (jCreate.status !== 201 || aCreate.status !== 201) {
        find(
          "HIGH",
          "tickets",
          "Flow M create failed",
          `jane=${jCreate.status} agent=${aCreate.status}`,
          "admin",
          "M"
        );
        flowResult("M", "Ticket number uniqueness", "bug", "create failed");
      } else if (jCreate.body?.id && jCreate.body.id === aCreate.body?.id) {
        find(
          "CRITICAL",
          "tickets",
          "New tickets share ticket_number across orgs",
          String(jCreate.body.id),
          "admin",
          "M"
        );
        flowResult("M", "Ticket number uniqueness", "bug", `both got ${jCreate.body.id}`);
      } else {
        const probe = await api(`/api/tickets/${encodeURIComponent(jCreate.body.id)}`);
        if (
          probe.status === 200 &&
          String(probe.body?.subject || "") === String(jCreate.body?.subject || "")
        ) {
          find(
            "CRITICAL",
            "idor",
            "Agent can read other-org ticket by shared number",
            jCreate.body.id,
            "agent",
            "M"
          );
          flowResult("M", "Ticket number uniqueness", "bug", "cross-org read via id");
        } else {
          pass(`unique ids jane=${jCreate.body.id} agent=${aCreate.body.id}`);
          flowResult(
            "M",
            "Ticket number uniqueness",
            "ok",
            `global sequence · ${jCreate.body.id} ≠ ${aCreate.body.id}`
          );
        }
      }
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
    flows,
    flowSummary: {
      ok: flows.filter((f) => f.status === "ok").length,
      bug: flows.filter((f) => f.status === "bug").length,
      wrong: flows.filter((f) => f.status === "wrong").length,
      skip: flows.filter((f) => f.status === "skip").length,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log("\n======== FLOW BUG HUNT SUMMARY ========");
  console.log(JSON.stringify(bySev));
  console.log(`Passed checks: ${checks.length}`);
  console.log(`Findings: ${findings.length}`);
  console.log(`Flows: ok=${report.flowSummary.ok} bug=${report.flowSummary.bug} wrong=${report.flowSummary.wrong} skip=${report.flowSummary.skip}`);
  console.log(`Report: ${OUT}`);
  const hard = bySev.CRITICAL + bySev.HIGH;
  process.exit(hard > 0 ? 2 : findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
