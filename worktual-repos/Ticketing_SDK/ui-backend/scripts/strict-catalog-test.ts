/**
 * Strict regression for Priorities + SLA + Status catalog (today's work).
 * Run: DOTENV_CONFIG_PATH=../.env node --import tsx scripts/strict-catalog-test.ts
 * Expects server on PORT (default 3001).
 */
const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;
const ADMIN = {
  email: "jane.smith@worktual.com",
  password: "Worktual@123",
};
const AGENT = {
  email: "smohamedfazil16@gmail.com",
  password: "Worktual@123",
};

type Jar = { cookie: string; user: Record<string, unknown> };

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}

async function login(creds: { email: string; password: string }): Promise<Jar> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const raw = setCookie.length
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : String(res.headers.get("set-cookie") || "")
        .split(/,(?=[^;]+?=)/)
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
  if (!res.ok) {
    throw new Error(`login ${creds.email} failed ${res.status}: ${await res.text()}`);
  }
  const user = (await res.json()) as Record<string, unknown>;
  if (!raw) throw new Error(`login ${creds.email}: no cookie`);
  return { cookie: raw, user };
}

async function api(
  jar: Jar,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Cookie: jar.cookie,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } catch (e) {
    return {
      status: 0,
      json: null,
      text: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureDirectoryCustomer(jar: Jar) {
  const listed = await api(jar, "GET", "/api/customers");
  const rows = Array.isArray(listed.json) ? listed.json : [];
  const hit = rows.find(
    (c: any) => (c?.email || c?.phone) && (c?.id || c?.customerId)
  );
  if (hit) {
    return {
      id: String(hit.id || hit.customerId || ""),
      name: String(hit.name || "Directory Customer"),
      email: String(hit.email || ""),
      phone: String(hit.phone || ""),
    };
  }
  const email = `dir.${Date.now()}@test.local`;
  const created = await api(jar, "POST", "/api/customers", {
    name: "Directory Customer",
    email,
    phone: "5550100123",
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(
      `directory customer missing (list ${listed.status}, create ${created.status})`
    );
  }
  const c = created.json || {};
  return {
    id: String(c.id || c.customerId || ""),
    name: String(c.name || "Directory Customer"),
    email: String(c.email || email),
    phone: String(c.phone || "5550100123"),
  };
}

async function main() {
  console.log(`\n=== Strict catalog test @ ${BASE} ===\n`);

  let admin: Jar;
  let agent: Jar;
  try {
    admin = await login(ADMIN);
    pass("admin login", String(admin.user.role));
  } catch (e) {
    fail("admin login", String(e));
    summarize();
    process.exit(1);
  }
  try {
    agent = await login(AGENT);
    pass("agent login", String(agent.user.role));
  } catch (e) {
    fail("agent login", String(e));
    summarize();
    process.exit(1);
  }

  // Preflight: re-enable all catalog rows (prior aborted runs may have left toggles off)
  {
    const prios = await api(admin, "GET", "/api/priorities?all=1");
    for (const p of prios.json || []) {
      if (!p.active) {
        await api(admin, "PATCH", `/api/priorities/${p.id}`, { active: true });
      }
    }
    const stats = await api(admin, "GET", "/api/statuses?all=1");
    for (const s of stats.json || []) {
      if (!s.active && s.status !== "On Hold") {
        await api(admin, "PATCH", `/api/statuses/${s.id}`, { active: true });
      }
    }
    pass("preflight re-enable catalog rows");
  }

  // ---- Priorities defaults from DB ----
  {
    const r = await api(admin, "GET", "/api/priorities?all=1");
    if (r.status !== 200 || !Array.isArray(r.json)) {
      fail("GET priorities all", `${r.status} ${r.text}`);
    } else {
      const keys = r.json.map((p: any) => p.priority);
      const system = r.json.filter((p: any) => p.isSystem);
      const need = ["urgent", "high", "medium", "low"];
      const missing = need.filter((k) => !keys.includes(k));
      if (missing.length) fail("priority defaults present", `missing ${missing}`);
      else if (system.length < 4)
        fail("priority system rows", `only ${system.length}`);
      else {
        const med = r.json.find((p: any) => p.priority === "medium");
        if (!med?.resolutionHours || med.resolutionHours <= 0)
          fail("SLA hours from DB", JSON.stringify(med));
        else
          pass(
            "priority defaults + SLA from DB",
            `medium=${med.resolutionHours}h, n=${r.json.length}`
          );
      }
    }
  }

  // ---- Status defaults from DB; no On Hold ----
  {
    const r = await api(admin, "GET", "/api/statuses?all=1");
    if (r.status !== 200 || !Array.isArray(r.json)) {
      fail("GET statuses all", `${r.status} ${r.text}`);
    } else {
      const keys = r.json.map((s: any) => s.status);
      if (keys.includes("On Hold")) fail("On Hold removed", "still in catalog");
      else {
        const need = ["Open", "In Progress", "Reopened", "Resolved", "Closed", "Overdue"];
        const missing = need.filter((k) => !keys.includes(k));
        if (missing.length) fail("status defaults present", `missing ${missing}`);
        else {
          const pending = r.json.find((s: any) => s.status === "In Progress");
          if (pending?.displayName !== "In Progress")
            fail("In Progress display from DB", JSON.stringify(pending));
          else
            pass(
              "status defaults from DB (no On Hold)",
              keys.join(",")
            );
        }
      }
    }
  }

  // ---- Agent cannot mutate ----
  {
    const p = await api(agent, "POST", "/api/priorities", {
      displayName: "AgentHackPrio",
      resolutionHours: 9,
    });
    const s = await api(agent, "POST", "/api/statuses", {
      displayName: "AgentHackStatus",
    });
    if (p.status === 403 && s.status === 403)
      pass("agent forbidden on POST priorities/statuses");
    else
      fail(
        "agent forbidden on POST",
        `prio=${p.status} status=${s.status}`
      );
  }

  // ---- Admin create custom priority + SLA ----
  const stamp = Date.now();
  let customPrio: any = null;
  {
    const r = await api(admin, "POST", "/api/priorities", {
      displayName: `StrictPrio ${stamp}`,
      resolutionHours: 11,
    });
    if (r.status !== 201 || !r.json?.id) {
      fail("create custom priority", `${r.status} ${r.text}`);
    } else {
      customPrio = r.json;
      if (r.json.resolutionHours !== 11 || r.json.isSystem)
        fail("custom priority shape", JSON.stringify(r.json));
      else pass("create custom priority", `${r.json.priority} ${r.json.resolutionHours}h`);
    }
  }

  // ---- Patch SLA hours ----
  if (customPrio) {
    const r = await api(admin, "PATCH", `/api/priorities/${customPrio.id}`, {
      resolutionHours: 17,
    });
    if (r.status !== 200 || r.json?.resolutionHours !== 17)
      fail("patch SLA hours", `${r.status} ${r.text}`);
    else pass("patch SLA hours", "17h");
  }

  // ---- Admin create custom status ----
  let customStatus: any = null;
  {
    const r = await api(admin, "POST", "/api/statuses", {
      displayName: `StrictStatus ${stamp}`,
    });
    if (r.status !== 201 || !r.json?.id) {
      fail("create custom status", `${r.status} ${r.text}`);
    } else {
      customStatus = r.json;
      if (r.json.isSystem || r.json.isTerminal)
        fail("custom status flags", JSON.stringify(r.json));
      else pass("create custom status", r.json.status);
    }
  }

  // ---- Active-only GET hides inactive ----
  if (customStatus) {
    await api(admin, "PATCH", `/api/statuses/${customStatus.id}`, {
      active: false,
    });
    const activeOnly = await api(admin, "GET", "/api/statuses");
    const all = await api(admin, "GET", "/api/statuses?all=1");
    const inActive = (activeOnly.json || []).some(
      (s: any) => s.id === customStatus.id
    );
    const inAll = (all.json || []).some((s: any) => s.id === customStatus.id);
    if (!inActive && inAll) pass("inactive status hidden from active list");
    else
      fail(
        "inactive status list filter",
        `activeHas=${inActive} allHas=${inAll}`
      );
    await api(admin, "PATCH", `/api/statuses/${customStatus.id}`, {
      active: true,
    });
  }

  // ---- Ticket create with custom priority → due_at hours ----
  let ticketId: string | null = null;
  if (customPrio) {
    const before = Date.now();
    const cust = await ensureDirectoryCustomer(admin);
    const r = await api(admin, "POST", "/api/tickets", {
      subject: `Strict catalog ticket ${stamp}`,
      description: "catalog e2e",
      customerId: cust.id || undefined,
      customerName: cust.name,
      customerEmail: cust.email || undefined,
      customerPhone: cust.phone || undefined,
      channel: "Web",
      priority: customPrio.priority,
      status: "Open",
      assignee: "Unassigned",
    });
    if (r.status !== 200 && r.status !== 201) {
      fail("create ticket custom priority", `${r.status} ${r.text}`);
    } else {
      ticketId = r.json?.id || r.json?.ticketId || null;
      // fetch list or ticket
      const list = await api(admin, "GET", "/api/tickets?scope=all");
      const t = Array.isArray(list.json)
        ? list.json.find(
            (x: any) =>
              x.subject === `Strict catalog ticket ${stamp}` ||
              x.id === ticketId
          )
        : list.json?.tickets?.find?.(
            (x: any) => x.subject === `Strict catalog ticket ${stamp}`
          );
      if (!t) {
        fail("find created ticket", `id=${ticketId}`);
      } else {
        ticketId = t.id;
        const due = t.dueAt ? new Date(t.dueAt).getTime() : NaN;
        const hours = (due - before) / 3600000;
        // patched to 17h; allow clock skew
        if (!Number.isFinite(hours) || hours < 16 || hours > 18.5)
          fail("due_at from custom SLA", `hours≈${hours} dueAt=${t.dueAt}`);
        else pass("due_at from custom SLA hours", `≈${hours.toFixed(2)}h`);
        if (t.priority !== customPrio.priority)
          fail("ticket stores custom priority key", t.priority);
        else pass("ticket stores custom priority key", t.priority);
      }
    }
  }

  // ---- Ticket update to custom status ----
  if (ticketId && customStatus) {
    const r = await api(admin, "PUT", `/api/tickets/${encodeURIComponent(ticketId)}`, {
      status: customStatus.status,
    });
    if (r.status !== 200) fail("update ticket custom status", `${r.status} ${r.text}`);
    else {
      const st = r.json?.status || r.json?.ticket?.status;
      if (st !== customStatus.status)
        fail("ticket status after update", JSON.stringify(r.json));
      else pass("update ticket to custom status", st);
    }
  }

  // ---- Reject inactive status on update ----
  if (ticketId && customStatus) {
    await api(admin, "PATCH", `/api/statuses/${customStatus.id}`, {
      active: false,
    });
    const r = await api(admin, "PUT", `/api/tickets/${encodeURIComponent(ticketId)}`, {
      status: customStatus.status,
    });
    if (r.status === 400) pass("reject inactive status on ticket update");
    else fail("reject inactive status", `${r.status} ${r.text}`);
    // restore ticket to Open + re-enable status for cleanup path
    await api(admin, "PATCH", `/api/statuses/${customStatus.id}`, {
      active: true,
    });
    await api(admin, "PUT", `/api/tickets/${encodeURIComponent(ticketId)}`, {
      status: "Open",
    });
  }

  // ---- Reject inactive priority on update ----
  if (ticketId && customPrio) {
    await api(admin, "PATCH", `/api/priorities/${customPrio.id}`, {
      active: false,
    });
    const r = await api(admin, "PUT", `/api/tickets/${encodeURIComponent(ticketId)}`, {
      priority: customPrio.priority,
    });
    if (r.status === 400) pass("reject inactive priority on ticket update");
    else fail("reject inactive priority", `${r.status} ${r.text}`);
    await api(admin, "PATCH", `/api/priorities/${customPrio.id}`, {
      active: true,
    });
  }

  // ---- Cannot rename system priority/status ----
  {
    const prios = await api(admin, "GET", "/api/priorities?all=1");
    const sysP = (prios.json || []).find((p: any) => p.priority === "medium");
    if (sysP) {
      const r = await api(admin, "PATCH", `/api/priorities/${sysP.id}`, {
        displayName: "Hacked",
      });
      if (r.status === 400) pass("block rename system priority");
      else fail("block rename system priority", `${r.status} ${r.text}`);
    }
    const stats = await api(admin, "GET", "/api/statuses?all=1");
    const sysS = (stats.json || []).find((s: any) => s.status === "Open");
    if (sysS) {
      const r = await api(admin, "PATCH", `/api/statuses/${sysS.id}`, {
        displayName: "Hacked",
      });
      if (r.status === 400) pass("block rename system status");
      else fail("block rename system status", `${r.status} ${r.text}`);
    }
  }

  // ---- Cannot DELETE system status ----
  {
    const stats = await api(admin, "GET", "/api/statuses?all=1");
    const sysS = (stats.json || []).find((s: any) => s.status === "Open");
    if (sysS) {
      const r = await api(admin, "DELETE", `/api/statuses/${sysS.id}`);
      if (r.status === 400) pass("block delete system status");
      else fail("block delete system status", `${r.status} ${r.text}`);
    }
  }

  // ---- Last non-terminal status guard ----
  {
    const stats = await api(admin, "GET", "/api/statuses?all=1");
    const nonTerm = (stats.json || []).filter(
      (s: any) => s.active && !s.isTerminal && s.status !== "Resolved"
    );
    // disable all but one, then try disable last
    const keep = nonTerm[0];
    const others = nonTerm.slice(1);
    for (const s of others) {
      await api(admin, "PATCH", `/api/statuses/${s.id}`, { active: false });
    }
    if (keep) {
      const r = await api(admin, "PATCH", `/api/statuses/${keep.id}`, {
        active: false,
      });
      if (r.status === 400) pass("guard last non-terminal status");
      else fail("guard last non-terminal status", `${r.status} ${r.text}`);
    }
    // restore
    for (const s of nonTerm) {
      await api(admin, "PATCH", `/api/statuses/${s.id}`, { active: true });
    }
  }

  // ---- Last priority guard ----
  {
    const prios = await api(admin, "GET", "/api/priorities?all=1");
    const active = (prios.json || []).filter((p: any) => p.active);
    const keep = active[0];
    const others = active.slice(1);
    for (const p of others) {
      await api(admin, "PATCH", `/api/priorities/${p.id}`, { active: false });
    }
    if (keep) {
      const r = await api(admin, "PATCH", `/api/priorities/${keep.id}`, {
        active: false,
      });
      if (r.status === 400) pass("guard last active priority");
      else fail("guard last active priority", `${r.status} ${r.text}`);
    }
    for (const p of active) {
      await api(admin, "PATCH", `/api/priorities/${p.id}`, { active: true });
    }
  }

  // ---- Resolve sets resolved_at ----
  if (ticketId) {
    const r = await api(admin, "PUT", `/api/tickets/${encodeURIComponent(ticketId)}`, {
      status: "Resolved",
    });
    const resolvedAt = r.json?.resolvedAt || r.json?.ticket?.resolvedAt;
    if (r.status === 200 && resolvedAt) pass("Resolved sets resolvedAt", resolvedAt);
    else fail("Resolved sets resolvedAt", `${r.status} ${r.text}`);
  }

  // ---- Soft-delete customs ----
  if (customPrio) {
    const r = await api(admin, "DELETE", `/api/priorities/${customPrio.id}`);
    if (r.status === 200 && r.json?.active === false)
      pass("soft-delete custom priority");
    else fail("soft-delete custom priority", `${r.status} ${r.text}`);
  }
  if (customStatus) {
    const r = await api(admin, "DELETE", `/api/statuses/${customStatus.id}`);
    if (r.status === 200 && r.json?.active === false)
      pass("soft-delete custom status");
    else fail("soft-delete custom status", `${r.status} ${r.text}`);
  }

  // ---- Active lists exclude soft-deleted ----
  {
    const p = await api(admin, "GET", "/api/priorities");
    const s = await api(admin, "GET", "/api/statuses");
    const pHas = (p.json || []).some((x: any) => x.id === customPrio?.id);
    const sHas = (s.json || []).some((x: any) => x.id === customStatus?.id);
    if (!pHas && !sHas) pass("active lists exclude soft-deleted customs");
    else fail("active lists exclude soft-deleted", `p=${pHas} s=${sHas}`);
  }

  summarize();
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===\n`
  );
  if (failed.length) {
    for (const f of failed) console.error(` • ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
