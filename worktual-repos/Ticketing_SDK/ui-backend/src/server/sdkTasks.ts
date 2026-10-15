/**
 * Partner named tasks. The browser button sends `sdk_task`.
 * Express pins the registered Harness task; Super does not re-route it.
 * Keep ids aligned with ai-agents/app/sdk_tasks.py and packages/ticketing-sdk.
 */

export type SdkNamedTaskId =
  | "ticket.summarize"
  | "ticket.classify"
  | "ticket.draftReply"
  | "ticket.similar"
  | "ticket.kb"
  | "intake.deflect"
  | "analytics.ask"
  | "analytics.why"
  | "ticket.list"
  | "ticket.create"
  | "ticket.assign"
  | "ticket.resolveSuggest"
  | "ticket.quality"
  | "sla.advise"
  | "ticket.workload";

export type SdkNamedTaskSpec = {
  id: SdkNamedTaskId;
  harnessTaskId: string;
  skill: string;
  needsTicket: boolean;
  needsMessage: boolean;
  defaultMessage: string;
};

const TASKS: Record<SdkNamedTaskId, Omit<SdkNamedTaskSpec, "id">> = {
  "ticket.summarize": {
    harnessTaskId: "ticket.investigation.summary",
    skill: "ticket-investigation-summary",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Summarize this ticket.",
  },
  "ticket.classify": {
    harnessTaskId: "ticket.classify.prioritize",
    skill: "ticket-classify-prioritize",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Classify and prioritize this ticket.",
  },
  "ticket.draftReply": {
    harnessTaskId: "reply.draft",
    skill: "reply-draft",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Draft a customer reply for this ticket. Do not send it.",
  },
  "ticket.similar": {
    harnessTaskId: "ticket.detect.similar",
    skill: "ticket-detect-similar",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Find similar tickets. Recommend only. Do not merge or update.",
  },
  "ticket.kb": {
    harnessTaskId: "knowledge.recommend.resolution",
    skill: "knowledge-recommend-resolution",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Recommend published knowledge articles for this ticket. Do not change the ticket.",
  },
  "intake.deflect": {
    harnessTaskId: "intake.self.service.deflection",
    skill: "intake-self-service-deflection",
    needsTicket: false,
    needsMessage: true,
    defaultMessage: "",
  },
  "analytics.ask": {
    harnessTaskId: "analytics.query",
    skill: "analytics-query",
    needsTicket: false,
    needsMessage: true,
    defaultMessage: "",
  },
  "analytics.why": {
    harnessTaskId: "analytics.root.cause",
    skill: "analytics-root-cause",
    needsTicket: false,
    needsMessage: true,
    defaultMessage: "",
  },
  "ticket.list": {
    harnessTaskId: "ticket.read.search",
    skill: "ticket-read-search",
    needsTicket: false,
    needsMessage: true,
    defaultMessage: "",
  },
  "ticket.create": {
    harnessTaskId: "ticket.create",
    skill: "ticket-create",
    needsTicket: false,
    needsMessage: true,
    defaultMessage: "",
  },
  "ticket.assign": {
    harnessTaskId: "ticket.assign.best",
    skill: "ticket-assign-best",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Choose the best assignee for this ticket. Confirm if it already has an owner.",
  },
  "ticket.resolveSuggest": {
    harnessTaskId: "ticket.resolve.reopen",
    skill: "ticket-resolve-reopen",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Suggest resolve or reopen for this ticket. Do not change status until confirmed.",
  },
  "ticket.quality": {
    harnessTaskId: "ticket.resolution.quality",
    skill: "ticket-resolution-quality",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Review resolution quality for this ticket.",
  },
  "sla.advise": {
    harnessTaskId: "sla.monitor.escalate",
    skill: "sla-monitor-escalate",
    needsTicket: true,
    needsMessage: false,
    defaultMessage: "Explain SLA risk for this ticket. Escalate only with confirmation.",
  },
  "ticket.workload": {
    harnessTaskId: "routing.optimize.workload",
    skill: "routing-optimize-workload",
    needsTicket: false,
    needsMessage: false,
    defaultMessage: "Review open workload and recommend a balance. Do not reassign.",
  },
};

function httpError(status: number, code: string, error: string): Error {
  const err = new Error(error) as Error & { status?: number; code?: string };
  err.status = status;
  err.code = code;
  return err;
}

export function sdkNamedTask(raw: unknown): SdkNamedTaskSpec | null {
  const id = String(raw || "").trim() as SdkNamedTaskId;
  const spec = TASKS[id];
  if (!spec) return null;
  return { id, ...spec };
}

function ticketNumberFrom(body: Record<string, unknown> | undefined): string {
  if (!body) return "";
  const entity = body.focused_entity;
  if (entity && typeof entity === "object" && !Array.isArray(entity)) {
    const row = entity as Record<string, unknown>;
    const fromEntity = String(row.ticketNumber || row.ticket_number || row.id || "").trim();
    if (fromEntity) return fromEntity;
  }
  return String(body.entity_id || "").trim();
}

/** Validate a named task and pin it on session memory. Other turns pass through. */
export function prepareSdkNamedTask(input: {
  sessionMemory: Record<string, unknown>;
  body: Record<string, unknown> | undefined;
  message: string;
  locale?: unknown;
}): { sessionMemory: Record<string, unknown>; message: string } {
  const raw = String(input.body?.sdk_task || "").trim();
  if (!raw) return { sessionMemory: input.sessionMemory, message: input.message };
  const task = sdkNamedTask(raw);
  if (!task) throw httpError(400, "validation_error", "Unknown sdk_task");
  if (String(input.body?.sql || "").trim()) {
    throw httpError(400, "validation_error", "sql is not accepted");
  }
  const ticket = ticketNumberFrom(input.body);
  if (task.needsTicket && !ticket) {
    throw httpError(400, "missing_context", sdkErrorMessage("missing_context", input.locale));
  }
  const provided = input.message.trim();
  if ((task.needsMessage || task.id === "intake.deflect") && !provided) {
    throw httpError(400, "validation_error", "message is required");
  }
  const message = provided || task.defaultMessage;
  const harnessFields: Record<string, string> = {};
  if (ticket) harnessFields.ticket_number = ticket;
  if (task.id === "intake.deflect") harnessFields.query = message;
  return {
    message,
    sessionMemory: {
      ...input.sessionMemory,
      sdkTask: task.id,
      harnessTaskId: task.harnessTaskId,
      harnessFields,
    },
  };
}

const COMPONENT_RE = /^[a-z0-9-]{1,64}$/;

const WRITE_TASKS = new Set([
  "ticket.create",
  "ticket.assign",
  "ticket.resolveSuggest",
  "ticket.draftReply",
  "ticket.quality",
  "sla.advise",
]);

/** Partner-facing sentences. Unknown languages use English. Keep the client copies in sync. */
const SDK_ERROR_TEXT: Record<string, Record<string, string>> = {
  auth_required: {
    en: "Sign in to continue.",
    es: "Inicia sesión para continuar.",
    fr: "Connectez-vous pour continuer.",
    de: "Melden Sie sich an, um fortzufahren.",
    pt: "Inicie sessão para continuar.",
    hi: "जारी रखने के लिए साइन इन करें.",
    ar: "سجّل الدخول للمتابعة.",
  },
  session_expired: {
    en: "Session expired. Please sign in again.",
    es: "La sesión expiró. Vuelve a iniciar sesión.",
    fr: "La session a expiré. Veuillez vous reconnecter.",
    de: "Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
    pt: "A sessão expirou. Inicie sessão novamente.",
    hi: "सत्र समाप्त हो गया. कृपया फिर से साइन इन करें.",
    ar: "انتهت الجلسة. يُرجى تسجيل الدخول مرة أخرى.",
  },
  forbidden: {
    en: "This role cannot run this skill.",
    es: "Este rol no puede ejecutar esta habilidad.",
    fr: "Ce rôle ne peut pas exécuter cette compétence.",
    de: "Diese Rolle kann diese Fähigkeit nicht ausführen.",
    pt: "Esta função não pode executar esta competência.",
    hi: "यह भूमिका यह कौशल नहीं चला सकती.",
    ar: "لا يمكن لهذا الدور تشغيل هذه المهارة.",
  },
  quota_exceeded: {
    en: "This workspace has reached its AI turn limit. Try again shortly.",
    es: "Este espacio alcanzó el límite de turnos de IA. Inténtalo de nuevo en un momento.",
    fr: "Cet espace a atteint sa limite de tours d'IA. Réessayez dans un instant.",
    de: "Dieser Arbeitsbereich hat das KI-Turn-Limit erreicht. Bitte kurz warten und erneut versuchen.",
    pt: "Este espaço atingiu o limite de turnos de IA. Tente novamente em instantes.",
    hi: "यह कार्यक्षेत्र AI टर्न सीमा तक पहुँच गया है. थोड़ी देर बाद फिर कोशिश करें.",
    ar: "بلغ هذا النطاق حد أدوار الذكاء الاصطناعي. أعد المحاولة بعد قليل.",
  },
  customer_not_found: {
    en: "No matching customer was found.",
    es: "No se encontró un cliente coincidente.",
    fr: "Aucun client correspondant n'a été trouvé.",
    de: "Es wurde kein passender Kunde gefunden.",
    pt: "Nenhum cliente correspondente foi encontrado.",
    hi: "कोई मेल खाता ग्राहक नहीं मिला.",
    ar: "لم يُعثر على عميل مطابق.",
  },
  ticketing_not_purchased: {
    en: "This organization has not purchased Ticketing.",
    es: "Esta organización no ha adquirido Ticketing.",
    fr: "Cette organisation n'a pas acheté Ticketing.",
    de: "Diese Organisation hat Ticketing nicht erworben.",
    pt: "Esta organização não adquiriu o Ticketing.",
    hi: "इस संगठन ने Ticketing नहीं खरीदा है.",
    ar: "لم تشترِ هذه المؤسسة Ticketing.",
  },
  missing_context: {
    en: "A ticket is required for this skill.",
    es: "Se requiere un ticket para esta habilidad.",
    fr: "Un ticket est requis pour cette compétence.",
    de: "Für diese Fähigkeit ist ein Ticket erforderlich.",
    pt: "É necessário um ticket para esta competência.",
    hi: "इस कौशल के लिए एक टिकट ज़रूरी है.",
    ar: "هذه المهارة تتطلب تذكرة.",
  },
  temporarily_unavailable: {
    en: "This answer is temporarily unavailable.",
    es: "Esta respuesta no está disponible por el momento.",
    fr: "Cette réponse est temporairement indisponible.",
    de: "Diese Antwort ist vorübergehend nicht verfügbar.",
    pt: "Esta resposta está temporariamente indisponível.",
    hi: "यह उत्तर कुछ समय के लिए उपलब्ध नहीं है.",
    ar: "هذه الإجابة غير متاحة مؤقتاً.",
  },
  unsupported_operation: {
    en: "This request is not supported.",
    es: "Esta solicitud no está admitida.",
    fr: "Cette demande n'est pas prise en charge.",
    de: "Diese Anfrage wird nicht unterstützt.",
    pt: "Este pedido não é suportado.",
    hi: "यह अनुरोध समर्थित नहीं है.",
    ar: "هذا الطلب غير مدعوم.",
  },
};

/** Language subtag. Empty or unknown values become `en`. */
export function sdkLocaleTag(value: unknown): string {
  const lang = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0] || "en";
  return /^[a-z]{2,3}$/.test(lang) ? lang : "en";
}

function firstFilled(...values: unknown[]): unknown {
  for (const value of values) {
    if (String(value ?? "").trim()) return value;
  }
  return "en";
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Locale from the JSON body, then the query, then Accept-Language. */
export function sdkLocaleFromParts(input: {
  body?: unknown;
  query?: unknown;
  acceptLanguage?: unknown;
}): string {
  const body = asRecord(input.body);
  const query = asRecord(input.query);
  const header = headerText(input.acceptLanguage).split(",")[0];
  return sdkLocaleTag(firstFilled(body?.locale, body?.reply_locale, query?.locale, query?.lang, header));
}

/** True for `/api/sdk/*` or a call that sent the partner feature header. */
export function sdkPartnerCall(input: { path?: unknown; feature?: unknown }): boolean {
  const feature = headerText(input.feature).trim();
  if (feature) return true;
  const path = String(input.path || "").split("?")[0];
  return path === "/api/sdk" || path.startsWith("/api/sdk/");
}

/** Sentence for a partner error code. Unknown codes and languages use English. */
export function sdkErrorMessage(code: unknown, locale: unknown): string {
  const table = SDK_ERROR_TEXT[String(code || "").trim()];
  if (!table) return "Request failed.";
  return table[sdkLocaleTag(locale)] || table.en;
}

/** Locale sentence for a partner who is over the turn cap. Unknown languages use English. */
export function sdkQuotaMessage(locale: unknown): string {
  return sdkErrorMessage("quota_exceeded", locale);
}

const STAFF_ROLES = new Set(["admin", "agent", "resolver"]);
const READ_ROLES = new Set(["admin", "agent", "resolver", "viewer"]);

/** Customer and portal roles cannot run partner AI. Viewers cannot run write skills. */
export function sdkRoleDenied(role: unknown, sdkTask: unknown): boolean {
  const name = String(role || "").trim();
  const task = String(sdkTask || "").trim();
  if (!READ_ROLES.has(name)) return true;
  if (WRITE_TASKS.has(task) && !STAFF_ROLES.has(name)) return true;
  return false;
}

/**
 * Missing only when the accounts schema and the org row are present and Ticketing is not granted.
 * Anything we cannot prove stays unknown so a local install without MyAccount still runs.
 */
export function sdkGrantDecision(input: {
  schemaAvailable: boolean;
  organizationExists: boolean;
  granted: boolean;
}): "unknown" | "granted" | "missing" {
  if (!input.schemaAvailable || !input.organizationExists) return "unknown";
  return input.granted ? "granted" : "missing";
}

function stableCode(value: unknown): string | null {
  const code = String(value || "").trim();
  if (code === "unsupported_product") return "unsupported_operation";
  return SDK_ERROR_TEXT[code] ? code : null;
}

function customerMissing(value: unknown, depth = 0): boolean {
  if (depth > 5 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => customerMissing(item, depth + 1));
  const row = value as Record<string, unknown>;
  if (row.customer_not_found === true || row.customerNotFound === true) return true;
  for (const key of ["ticket_draft", "ticketDraft", "draft", "collected", "durable", "lastToolOutcome", "last_tool_outcome"]) {
    if (key in row && customerMissing(row[key], depth + 1)) return true;
  }
  return false;
}

/** Stable code on a co-worker payload, or null when the turn is an ordinary answer. */
export function sdkTurnErrorCode(payload: {
  code?: unknown;
  data?: unknown;
  sessionMemoryPatch?: unknown;
}): string | null {
  const data = asRecord(payload.data);
  const refusal = asRecord(data?.refusal);
  return (
    stableCode(payload.code) ||
    stableCode(data?.code) ||
    stableCode(refusal?.code) ||
    (customerMissing(data) || customerMissing(payload.sessionMemoryPatch) ? "customer_not_found" : null)
  );
}

/** Partner turns replace the model sentence with the locale catalog. Staff payloads stay as they are. */
export function stampSdkTurn<T extends Record<string, unknown>>(partner: boolean, locale: unknown, payload: T): T {
  if (!partner) return payload;
  const code = sdkTurnErrorCode({
    code: payload.code,
    data: payload.data,
    sessionMemoryPatch: payload.sessionMemoryPatch,
  });
  if (!code) return payload;
  const message = sdkErrorMessage(code, locale);
  const data = asRecord(payload.data);
  return {
    ...payload,
    assistantText: message,
    reply: message,
    code,
    data: { ...(data || {}), code },
  };
}

/**
 * Turn rate is a rolling minute. Concurrent is how many of this org's calls are in flight.
 * A limit of 0 or less means that cap is off.
 */
export function sdkQuotaDecision(input: {
  recentTurns: number;
  inFlight: number;
  ratePerMinute: number;
  concurrent: number;
}): { ok: true } | { ok: false; reason: "rate" | "concurrent" } {
  const rate = Number(input.ratePerMinute) || 0;
  const concurrent = Number(input.concurrent) || 0;
  if (rate > 0 && input.recentTurns >= rate) return { ok: false, reason: "rate" };
  if (concurrent > 0 && input.inFlight >= concurrent) return { ok: false, reason: "concurrent" };
  return { ok: true };
}

/** Widget calls send `ui` and a component tag. Anything else is a headless call. */
export function sdkUsageContext(input: { surface?: unknown; component?: unknown }): {
  surface: "ui" | "headless";
  component: string | null;
} {
  const surface = String(input.surface || "").trim().toLowerCase() === "ui" ? "ui" : "headless";
  const component = String(input.component || "").trim().toLowerCase();
  return {
    surface,
    component: COMPONENT_RE.test(component) ? component : null,
  };
}

/** Catalog skill for a button, otherwise the skill the co-worker reported. */
export function sdkUsageSkill(input: { sdkTask?: unknown; reportedSkill?: unknown }): string | null {
  const named = sdkNamedTask(input.sdkTask);
  if (named) return named.skill;
  const reported = String(input.reportedSkill || "").trim();
  return reported || null;
}

/** Drop blank skills and sum counts. Logins have no skill and stay out of this list. */
export function sdkSkillBreakdown(
  rows: Array<{ skill?: string | null; count?: number | string | null }>
): Array<{ skill: string; count: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const skill = String(row.skill || "").trim();
    const count = Number(row.count || 0);
    if (!skill || !Number.isFinite(count) || count <= 0) continue;
    totals.set(skill, (totals.get(skill) || 0) + count);
  }
  return [...totals.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

export type SdkQuotaTier = { ratePerMinute: number; concurrent: number };

/** `org:rate:concurrent` pairs. `0` on a slot means that cap is off for the org. */
export function sdkQuotaTierMap(raw: unknown): Record<string, SdkQuotaTier> {
  const out: Record<string, SdkQuotaTier> = {};
  for (const part of String(raw || "").split(",")) {
    const bits = part.trim().split(":");
    if (bits.length !== 3) continue;
    const org = bits[0].trim();
    const rate = Number(bits[1].trim());
    const concurrent = Number(bits[2].trim());
    if (!/^\d+$/.test(org)) continue;
    if (!Number.isInteger(rate) || rate < 0 || !Number.isInteger(concurrent) || concurrent < 0) continue;
    out[org] = { ratePerMinute: rate, concurrent };
  }
  return out;
}

/**
 * A stored row is explicit, including `0` (that cap is off).
 * No row uses the env map, then the process-wide env pair.
 */
export function sdkQuotaLimits(input: {
  organizationId: string;
  envRate: number;
  envConcurrent: number;
  configured?: Record<string, SdkQuotaTier> | null;
  stored?: { ratePerMinute: number; concurrent: number } | null;
}): SdkQuotaTier {
  if (input.stored) {
    return {
      ratePerMinute: Math.max(0, Math.floor(Number(input.stored.ratePerMinute) || 0)),
      concurrent: Math.max(0, Math.floor(Number(input.stored.concurrent) || 0)),
    };
  }
  const configured = input.configured?.[String(input.organizationId || "").trim()];
  if (configured) return { ratePerMinute: configured.ratePerMinute, concurrent: configured.concurrent };
  return {
    ratePerMinute: Math.max(0, Math.floor(Number(input.envRate) || 0)),
    concurrent: Math.max(0, Math.floor(Number(input.envConcurrent) || 0)),
  };
}

/** AI features count one agent turn. Auth and quota rows do not. */
export function sdkUsageMeter(feature: unknown, confirmRequired: boolean): { agentTurns: number; confirmRequired: boolean } {
  const ai = String(feature || "").startsWith("ai.");
  return { agentTurns: ai ? 1 : 0, confirmRequired: ai && confirmRequired };
}

/** A proposal that will not auto-apply, or a high-risk proposal, needs confirmation. */
export function sdkConfirmRequired(body: unknown): boolean {
  const record = asRecord(body);
  if (!record) return false;
  const proposals = Array.isArray(record.toolProposals) ? record.toolProposals : [];
  for (const item of proposals) {
    const proposal = asRecord(item);
    if (!proposal) continue;
    if (proposal.auto === false || proposal.risk === "high") return true;
  }
  return false;
}

export type SdkRoutingTrace = { agents: string[]; routes: Array<{ from: string; to: string }> };

/** Keep agent names and route endpoints. Drop query text and tool arguments. */
export function sdkRoutingTrace(value: unknown): SdkRoutingTrace | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const agents = Array.isArray(raw.agents)
    ? raw.agents.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const routes: Array<{ from: string; to: string }> = [];
  if (Array.isArray(raw.routes)) {
    for (const item of raw.routes) {
      const row = asRecord(item);
      if (!row) continue;
      const to = String(row.to || "").trim();
      if (!to) continue;
      routes.push({ from: String(row.from || "").trim(), to });
    }
  }
  if (!agents.length && !routes.length) return null;
  return { agents, routes };
}

export function sdkDebugRequested(input: { path?: unknown; feature?: unknown; debug?: unknown }): boolean {
  return sdkPartnerCall({ path: input.path, feature: input.feature }) && input.debug === true;
}

/** Partner calls keep a sanitized trace. Staff payloads lose it. */
export function applySdkTrace<T extends Record<string, unknown>>(partner: boolean, payload: T): T {
  const data = asRecord(payload.data);
  const trace = sdkRoutingTrace(payload.trace) || sdkRoutingTrace(data?.trace);
  if (!partner) {
    if (!data || !("trace" in data)) {
      if (!("trace" in payload)) return payload;
      const rest = { ...payload };
      delete rest.trace;
      return rest;
    }
    const next = { ...data };
    delete next.trace;
    const rest = { ...payload, data: next };
    delete rest.trace;
    return rest;
  }
  if (!trace) return payload;
  return { ...payload, trace, data: { ...(data || {}), trace } };
}

/** Script tag and iframe for a public help widget. The page holds `wgt_…`, never the org API key. */
export function sdkWidgetEmbed(host: string, publicId: string): { script: string; iframe: string } {
  const origin = String(host || "").trim().replace(/\/$/, "");
  const id = String(publicId || "").trim();
  return {
    script: `<script src="${origin}/embed/worktual-help.js" data-widget-id="${id}" async></script>`,
    iframe: `<iframe src="${origin}/embed/help.html?id=${encodeURIComponent(id)}" title="Help" style="border:0;width:380px;height:640px"></iframe>`,
  };
}
