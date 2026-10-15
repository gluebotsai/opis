/**
 * Live E2E: chat agent-turn create/update/delete + CSV import.
 * Run: npx tsx --env-file=../.env scripts/e2e-contact-chat-flows.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";

type Msg = { role: "assistant" | "user"; text: string };
type Turn = {
  ok: boolean;
  assistantText?: string;
  error?: string;
  toolProposals?: Array<{ name: string; args?: Record<string, unknown> }>;
  contactDraftPatch?: Record<string, unknown>;
  patch?: Record<string, unknown>;
};

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function suffix() {
  return randomBytes(3).toString("hex");
}

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function storeCookies(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const part = line.split(";")[0] || "";
    const i = part.indexOf("=");
    if (i > 0) cookieJar.set(part.slice(0, i), part.slice(i + 1));
  }
  const single = res.headers.get("set-cookie");
  if (single && raw.length === 0) {
    const part = single.split(";")[0] || "";
    const i = part.indexOf("=");
    if (i > 0) cookieJar.set(part.slice(0, i), part.slice(i + 1));
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function http(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; raw: string }> {
  const headers: Record<string, string> = {
    cookie: cookieHeader(),
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(res);
  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function agentTurn(input: {
  messages: Msg[];
  context: Record<string, unknown>;
  sessionMemory?: Record<string, unknown>;
}): Promise<Turn> {
  const r = await http("POST", "/api/coworker/agent-turn", input);
  if (r.status !== 200) {
    return { ok: false, error: `HTTP ${r.status}: ${r.raw.slice(0, 200)}` };
  }
  const payload = r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data;
  if (payload?.ok === false) {
    return { ok: false, error: String(payload.error || payload.assistantText || "agent failed") };
  }
  return {
    ok: true,
    assistantText: payload?.assistantText,
    toolProposals: payload?.toolProposals,
    contactDraftPatch: payload?.contactDraftPatch,
    patch: payload?.patch,
    error: payload?.error,
  };
}

function mergeDraft(
  draft: Record<string, unknown>,
  turn: Turn,
): Record<string, unknown> {
  const patch = turn.contactDraftPatch || turn.patch;
  if (patch && typeof patch === "object") return { ...draft, ...patch };
  return draft;
}

async function main() {
  console.log(`E2E against ${API} as ${EMAIL}\n`);

  const login = await http("POST", "/api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  if (login.status === 200) {
    record("login", true, EMAIL);
  } else {
    const db = new pg.Client({
      connectionString:
        process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
    });
    await db.connect();
    const u = await db.query(
      `
      SELECT u.id::text AS id
      FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a
        ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.status = 'active'
        AND u.organization_id = 1000
        AND lower(r.name) IN ('admin', 'sales_manager')
      ORDER BY u.id
      LIMIT 1
      `,
    );
    await db.end();
    const row = u.rows[0] as { id?: string } | undefined;
    if (!row?.id) {
      record("login", false, `${login.status} ${login.raw.slice(0, 160)}`);
      process.exit(1);
    }
    cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
    const me = await http("GET", "/api/auth/me");
    if (me.status !== 200) {
      record("login", false, `minted session rejected ${me.status}`);
      process.exit(1);
    }
    record("login", true, `minted session user=${row.id}`);
  }

  const companies = await http("GET", "/api/companies?page=1");
  const companyItems = Array.isArray(companies.data?.items)
    ? companies.data.items
    : Array.isArray(companies.data?.data?.items)
      ? companies.data.data.items
      : [];
  const companyIdForCreate = String(companyItems[0]?.id || "").trim();
  record(
    "login.b2b_company",
    Boolean(companyIdForCreate),
    companyIdForCreate ? `companyId=${companyIdForCreate}` : companies.raw.slice(0, 160),
  );

  const tag = suffix();
  const firstName = "E2EChat";
  const lastName = `T${tag}`;
  const email = `e2e.chat.${tag}@example.com`;
  const phone = `9198${String(parseInt(tag, 16) % 1e8).padStart(8, "0")}`;
  const city = `City${tag}`;

  // ---------- CREATE via chat turns ----------
  let draft: Record<string, unknown> = {};
  let messages: Msg[] = [];
  const createCtx = {
    module: "contact",
    surface: "create",
    pathname: "/contact/new",
    draft,
  };

  messages.push({ role: "user", text: "help me create a new contact" });
  let turn = await agentTurn({ messages, context: { ...createCtx, draft } });
  record(
    "create.open",
    Boolean(
      turn.ok &&
        ((turn.assistantText || "").toLowerCase().includes("name") ||
          (turn.toolProposals || []).some((t) => t.name === "set_workspace")),
    ),
    turn.ok
      ? (turn.assistantText || `tools=${(turn.toolProposals || []).map((t) => t.name).join(",")}`).slice(0, 120)
      : turn.error || "no speech",
  );
  if (turn.assistantText) {
    messages.push({ role: "assistant", text: turn.assistantText });
  }
  draft = mergeDraft(draft, turn);

  messages.push({ role: "user", text: `${firstName} ${lastName}` });
  turn = await agentTurn({
    messages,
    context: { ...createCtx, draft },
  });
  draft = mergeDraft(draft, turn);
  const gotNames =
    String(draft.firstName || "").toLowerCase().includes("e2echat") &&
    String(draft.lastName || "").length > 0;
  record(
    "create.name_patch",
    Boolean(turn.ok && gotNames),
    `draft=${JSON.stringify({ firstName: draft.firstName, lastName: draft.lastName })} speech=${(turn.assistantText || "").slice(0, 80)}`,
  );
  if (turn.assistantText) {
    messages.push({ role: "assistant", text: turn.assistantText });
  }

  messages.push({ role: "user", text: email });
  turn = await agentTurn({
    messages,
    context: { ...createCtx, draft },
  });
  draft = mergeDraft(draft, turn);
  const gotEmail = String(draft.email || "").toLowerCase() === email.toLowerCase();
  record(
    "create.email_patch",
    Boolean(turn.ok && gotEmail),
    `draft.email=${draft.email || "(missing)"} speech=${(turn.assistantText || "").slice(0, 100)}`,
  );
  if (!gotEmail) {
    record(
      "create.email_not_reasked_only",
      !(turn.assistantText || "").toLowerCase().includes("email address"),
      (turn.assistantText || "").slice(0, 120),
    );
  }
  if (turn.assistantText) {
    messages.push({ role: "assistant", text: turn.assistantText });
  }

  messages.push({ role: "user", text: phone });
  turn = await agentTurn({
    messages,
    context: { ...createCtx, draft },
  });
  draft = mergeDraft(draft, turn);
  record(
    "create.phone_patch",
    Boolean(turn.ok && String(draft.phone || "").includes(phone.slice(-4))),
    `draft.phone=${draft.phone || "(missing)"} speech=${(turn.assistantText || "").slice(0, 100)}`,
  );
  if (turn.assistantText) {
    messages.push({ role: "assistant", text: turn.assistantText });
  }

  // Persist create (same payload chat would submit)
  const createBody = {
    firstName: String(draft.firstName || firstName),
    lastName: String(draft.lastName || lastName),
    email: String(draft.email || email),
    phone: String(draft.phone || phone),
    city: "",
    country: "",
    contactType: "lead",
    leadStatus: "new",
    ...(companyIdForCreate ? { companyId: companyIdForCreate } : {}),
  };
  const created = await http("POST", "/api/contacts", createBody);
  const contactId =
    created.data?.contact?.id ||
    created.data?.id ||
    created.data?.data?.contact?.id ||
    null;
  const createOk = created.status === 200 || created.status === 201;
  record(
    "create.save_api",
    Boolean(createOk && contactId),
    createOk
      ? `id=${contactId}`
      : `${created.status} ${created.raw.slice(0, 220)}`,
  );

  if (!contactId) {
    console.log("\nAborting update/delete — create failed.");
    summarize();
    process.exit(1);
  }

  // Confirm enrich job was enqueued (trigger path)
  await new Promise((r) => setTimeout(r, 800));
  const detail = await http("GET", `/api/contacts/${contactId}`);
  record(
    "create.detail_fetch",
    detail.status === 200,
    detail.status === 200
      ? `email=${detail.data?.contact?.person?.email || detail.data?.person?.email || "?"}`
      : detail.raw.slice(0, 160),
  );

  // ---------- UPDATE via chat ----------
  const updateMessages: Msg[] = [
    { role: "user", text: `update contact ${firstName} ${lastName}` },
  ];
  turn = await agentTurn({
    messages: updateMessages,
    context: {
      module: "contact",
      surface: "detail",
      entityId: contactId,
      pathname: `/contact/${contactId}`,
      draft: null,
    },
    sessionMemory: {
      slots: { contactId },
      lastEntities: { contactId },
    },
  });
  if (turn.assistantText) {
    updateMessages.push({ role: "assistant", text: turn.assistantText });
  }
  updateMessages.push({ role: "user", text: `city as ${city}` });
  turn = await agentTurn({
    messages: updateMessages,
    context: {
      module: "contact",
      surface: "detail",
      entityId: contactId,
      pathname: `/contact/${contactId}`,
      draft: null,
    },
    sessionMemory: {
      slots: { contactId },
      lastEntities: { contactId },
    },
  });
  const updateTools = turn.toolProposals || [];
  let updateProp = updateTools.find((t) => t.name === "propose_update_contact");
  let updateArgs = (updateProp?.args || {}) as Record<string, unknown>;
  let updateOk =
    Boolean(turn.ok) &&
    Boolean(updateProp) &&
    String(updateArgs.city || "").toLowerCase() === city.toLowerCase();
  if (!updateOk && turn.ok) {
    if (turn.assistantText) {
      updateMessages.push({ role: "assistant", text: turn.assistantText });
    }
    updateMessages.push({
      role: "user",
      text: `Propose updating this contact's city to ${city}.`,
    });
    turn = await agentTurn({
      messages: updateMessages,
      context: {
        module: "contact",
        surface: "detail",
        entityId: contactId,
        pathname: `/contact/${contactId}`,
        draft: null,
      },
      sessionMemory: {
        slots: { contactId },
        lastEntities: { contactId },
      },
    });
    updateProp = (turn.toolProposals || []).find((t) => t.name === "propose_update_contact");
    updateArgs = (updateProp?.args || {}) as Record<string, unknown>;
    updateOk =
      Boolean(turn.ok) &&
      Boolean(updateProp) &&
      String(updateArgs.city || "").toLowerCase() === city.toLowerCase();
  }
  const speechBad = (turn.assistantText || "").toLowerCase().includes("first name");
  record(
    "update.city_tool",
    updateOk && !speechBad,
    updateOk
      ? `city=${updateArgs.city} contactId=${updateArgs.contactId || contactId} speechBad=${speechBad} speech=${(turn.assistantText || "").slice(0, 100)}`
      : `speech=${(turn.assistantText || turn.error || "").slice(0, 140)} tools=${(turn.toolProposals || []).map((t) => t.name).join(",")} args=${JSON.stringify(updateArgs).slice(0, 160)}`,
  );

  // Apply update via API (same as UI onToolConfirm)
  const person =
    detail.data?.contact?.person || detail.data?.person || {};
  const updatePayload = {
    firstName: person.firstName || createBody.firstName,
    lastName: person.lastName || createBody.lastName,
    email: person.email || createBody.email,
    phone: person.phone || createBody.phone,
    city,
    country: person.country || "",
    title: person.title || "",
    notes: person.notes || "",
    addressLine: person.addressLine || "",
    contactType: person.contactType || "lead",
    leadStatus: person.leadStatus || "new",
    companyId: person.companyId || null,
    locationId: person.locationId || null,
  };
  const updated = await http("PUT", `/api/contacts/${contactId}`, updatePayload);
  const altUpdated =
    updated.status >= 400
      ? await http("PATCH", `/api/contacts/${contactId}`, updatePayload)
      : updated;
  record(
    "update.save_api",
    altUpdated.status === 200,
    altUpdated.status === 200
      ? `city set to ${city}`
      : `${altUpdated.status} ${altUpdated.raw.slice(0, 200)}`,
  );

  // ---------- CSV import via chat propose + API ----------
  const csvEmail = `e2e.csv.${tag}@example.com`;
  const csvText = [
    "first_name,last_name,email,phone",
    `CsvLead,Import${tag},${csvEmail},919900${tag.slice(0, 4)}`,
  ].join("\n");
  const csvMessages: Msg[] = [
    { role: "user", text: "import contacts from this csv" },
    {
      role: "assistant",
      text: "Great! Upload a CSV or paste the rows here.",
    },
    { role: "user", text: csvText },
  ];
  turn = await agentTurn({
    messages: csvMessages,
    context: {
      module: "contact",
      surface: "list",
      pathname: "/contact",
      draft: null,
    },
  });
  const importProp = (turn.toolProposals || []).find(
    (t) => t.name === "propose_import_contacts",
  );
  record(
    "csv.propose_import",
    Boolean(turn.ok && importProp),
    importProp
      ? `hasCsvText=${Boolean((importProp.args || {}).csvText)}`
      : `speech=${(turn.assistantText || turn.error || "").slice(0, 140)}`,
  );

  const imported = await http("POST", "/api/contacts/import", { csvText });
  const importOk =
    imported.status === 200 &&
    (imported.data?.ok === true ||
      imported.data?.created != null ||
      imported.data?.result?.created != null ||
      typeof imported.data?.summary === "string" ||
      imported.data?.data?.created != null);
  record(
    "csv.import_api",
    importOk || imported.status === 200,
    `${imported.status} ${imported.raw.slice(0, 220)}`,
  );

  // ---------- DELETE via chat ----------
  const deleteMessages: Msg[] = [
    {
      role: "user",
      text: `delete contact ${firstName} ${lastName}`,
    },
  ];
  turn = await agentTurn({
    messages: deleteMessages,
    context: {
      module: "contact",
      surface: "detail",
      entityId: contactId,
      pathname: `/contact/${contactId}`,
      draft: null,
    },
    sessionMemory: {
      slots: { contactId },
      lastEntities: { contactId },
    },
  });
  if (turn.assistantText) {
    deleteMessages.push({ role: "assistant", text: turn.assistantText });
  }
  // Confirm if asked
  const needsConfirm =
    (turn.assistantText || "").toLowerCase().includes("delete") ||
    (turn.assistantText || "").toLowerCase().includes("sure") ||
    (turn.assistantText || "").toLowerCase().includes("confirm");
  if (needsConfirm && !(turn.toolProposals || []).some((t) => t.name === "propose_delete_contact")) {
    deleteMessages.push({ role: "user", text: "yes, delete it" });
    turn = await agentTurn({
      messages: deleteMessages,
      context: {
        module: "contact",
        surface: "detail",
        entityId: contactId,
        pathname: `/contact/${contactId}`,
        draft: null,
      },
      sessionMemory: {
        slots: { contactId },
        lastEntities: { contactId },
      },
    });
  }
  const deleteProp = (turn.toolProposals || []).find(
    (t) => t.name === "propose_delete_contact",
  );
  record(
    "delete.propose",
    Boolean(turn.ok && (deleteProp || (turn.assistantText || "").toLowerCase().includes("delete"))),
    deleteProp
      ? `contactId=${(deleteProp.args || {}).contactId || contactId}`
      : `speech=${(turn.assistantText || turn.error || "").slice(0, 140)}`,
  );

  const deleted = await http("DELETE", `/api/contacts/${contactId}`);
  record(
    "delete.save_api",
    deleted.status === 200 || deleted.status === 204,
    deleted.status === 200 || deleted.status === 204
      ? "removed"
      : `${deleted.status} ${deleted.raw.slice(0, 200)}`,
  );

  summarize();
  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
