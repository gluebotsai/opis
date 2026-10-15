/**
 * Opportunity / Events — Campaign DB is source of truth (tenant-scoped).
 * localStorage is a cache; pending drafts stay in memory until first persist.
 */

import { packStorageKey } from "@/lib/industry-packs";
import { publicAppPath } from "@/lib/public-app-url";
import { getToken } from "@/services/api";
import {
  deleteOpportunityEventApi,
  fetchOpportunityEvents,
  putOpportunityEvents,
} from "@/services/opportunity-events.api";

export type OpportunityKind =
  | "form"
  | "webinar"
  | "lifecycle_segment"
  | "product"
  | "external"
  | "seasonal"
  | "coupon";

export type OpportunityStatus = "draft" | "planned" | "active" | "ended";

export type FormFieldType = "text" | "email" | "tel" | "textarea";

export type FormFieldDef = {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  /** Prefill shown in preview / public form when the agent sets a value. */
  defaultValue?: string;
};

/** Visual theme for public form + preview (agent can design slowly). */
export type FormTheme = {
  primaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  buttonText: string;
  logoUrl: string;
  borderRadiusPx: number;
  spacingScale: number;
  fontFamily: string;
};

export type OpportunityEvent = {
  id: string;
  kind: OpportunityKind;
  title: string;
  description: string;
  status: OpportunityStatus;
  startsAt: string | null;
  endsAt: string | null;
  publicSlug: string | null;
  formFields: FormFieldDef[];
  thankYouMessage: string;
  theme: FormTheme;
  /** Set when launched from Create campaign — appears in Events monitoring */
  launchedAt: string | null;
  submissionCount: number;
  openCount: number;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY_BASE = "worktual.opportunityEvents.v3";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

export const DEFAULT_FORM_THEME: FormTheme = {
  primaryColor: "#5b4bdb",
  backgroundColor: "#f3f4f6",
  surfaceColor: "#ffffff",
  textColor: "#111827",
  mutedColor: "#6b7280",
  buttonText: "Submit",
  logoUrl: "",
  borderRadiusPx: 12,
  spacingScale: 1,
  fontFamily: "Inter, system-ui, sans-serif",
};

const KIND_LABELS: Record<OpportunityKind, string> = {
  form: "Form",
  webinar: "Webinar",
  lifecycle_segment: "Lifecycle",
  product: "Product",
  external: "External",
  seasonal: "Seasonal",
  coupon: "Coupon",
};

export function opportunityKindLabel(kind: OpportunityKind): string {
  return KIND_LABELS[kind] || kind;
}

/** Parked kinds stay typed; only Form is offered in create + tracking for now. */
const VISIBLE_OPPORTUNITY_KINDS: OpportunityKind[] = ["form"];

export function isOpportunityKindVisible(kind: OpportunityKind): boolean {
  return VISIBLE_OPPORTUNITY_KINDS.includes(kind);
}

export function listOpportunityKinds(): OpportunityKind[] {
  return [...VISIBLE_OPPORTUNITY_KINDS];
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function slugifyBase(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "form"
  );
}

function slugTaken(slug: string, exceptId?: string): boolean {
  const s = slug.toLowerCase();
  if (
    [...pendingEvents.values()].some(
      (r) => r.id !== exceptId && r.publicSlug?.toLowerCase() === s,
    )
  ) {
    return true;
  }
  return readAll().some(
    (r) => r.id !== exceptId && r.publicSlug?.toLowerCase() === s,
  );
}

/** Public slug is assigned only when the user confirms / launches the form. */
export function allocatePublicSlug(title: string, exceptId?: string): string {
  const base = slugifyBase(title);
  if (!slugTaken(base, exceptId)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!slugTaken(candidate, exceptId)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultFormFields(): FormFieldDef[] {
  return [
    {
      id: "field-name",
      label: "Full name",
      type: "text",
      required: true,
      placeholder: "Jane Smith",
    },
    {
      id: "field-email",
      label: "Work email",
      type: "email",
      required: true,
      placeholder: "jane@company.com",
    },
    {
      id: "field-company",
      label: "Company",
      type: "text",
      required: true,
      placeholder: "Acme Inc.",
    },
    {
      id: "field-role",
      label: "Role",
      type: "text",
      required: false,
      placeholder: "Marketing manager",
    },
  ];
}

function normalizeTheme(raw?: Partial<FormTheme> | null): FormTheme {
  return { ...DEFAULT_FORM_THEME, ...(raw || {}) };
}

function normalizeField(f: FormFieldDef | Record<string, unknown>): FormFieldDef {
  const typeRaw = String((f as FormFieldDef).type || "text");
  const type = (
    ["text", "email", "tel", "textarea"].includes(typeRaw) ? typeRaw : "text"
  ) as FormFieldType;
  const rec = f as Record<string, unknown>;
  const defaultRaw = rec.defaultValue ?? rec.default_value ?? rec.value;
  const defaultValue =
    typeof defaultRaw === "string" && defaultRaw.trim()
      ? defaultRaw.trim()
      : undefined;
  const placeholderRaw = rec.placeholder;
  const placeholder =
    typeof placeholderRaw === "string" && placeholderRaw.trim()
      ? placeholderRaw.trim()
      : defaultValue;
  return {
    id: String(rec.id || crypto.randomUUID()),
    label: String(rec.label || "Field"),
    type,
    required: Boolean(rec.required),
    placeholder,
    defaultValue,
  };
}

function normalizeEvent(row: OpportunityEvent): OpportunityEvent {
  const status =
    row.status === "planned" ||
    row.status === "active" ||
    row.status === "ended" ||
    row.status === "draft"
      ? row.status
      : "draft";
  return {
    ...row,
    status,
    theme: normalizeTheme(row.theme),
    formFields: Array.isArray(row.formFields)
      ? row.formFields.map((f) => normalizeField(f))
      : [],
    launchedAt: row.launchedAt ?? null,
    thankYouMessage: row.thankYouMessage || "",
    submissionCount: row.submissionCount || 0,
    openCount: row.openCount || 0,
  };
}

function readAll(): OpportunityEvent[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpportunityEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEvent);
  } catch {
    return [];
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistSkip = 0;
let persistQueued = false;
let hydratedFromServer = false;
let hydrateInFlight: Promise<OpportunityEvent[]> | null = null;

function schedulePersist(delayMs = 450) {
  if (persistSkip > 0) return;
  if (!hydratedFromServer) {
    persistQueued = true;
    return;
  }
  if (typeof window === "undefined") return;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistAllToServer();
  }, delayMs);
}

async function persistAllToServer() {
  if (!canUseStorage() || !getToken()) return;
  const pendingIds = new Set(pendingEvents.keys());
  const rows = [
    ...[...pendingEvents.values()].map(normalizeEvent),
    ...readAll().filter((r) => !pendingIds.has(r.id)),
  ];
  try {
    const saved = await putOpportunityEvents(rows);
    writeAll(saved, { persist: false });
  } catch {
    /* keep local cache; next mutate retries */
  }
}

export async function hydrateOpportunityEventsFromServer(): Promise<
  OpportunityEvent[]
> {
  if (hydrateInFlight) return hydrateInFlight;
  hydrateInFlight = (async () => {
    persistSkip += 1;
    let seedLocal = false;
    try {
      const remote = await fetchOpportunityEvents();
      const events = remote
        .filter((row) => row && typeof row === "object")
        .map((row) => normalizeEvent(row as OpportunityEvent));
      if (events.length > 0) {
        writeAll(events, { persist: false });
      } else if (readAll().length > 0) {
        seedLocal = true;
      }
    } catch {
      /* keep local cache */
    } finally {
      persistSkip = Math.max(0, persistSkip - 1);
      hydratedFromServer = true;
    }
    if (seedLocal) await persistAllToServer();
    if (persistQueued) {
      persistQueued = false;
      schedulePersist(0);
    }
    return listOpportunityEvents();
  })().finally(() => {
    hydrateInFlight = null;
  });
  return hydrateInFlight;
}

function writeAll(
  rows: OpportunityEvent[],
  opts?: { persist?: boolean },
) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(rows.map(normalizeEvent)));
  if (opts?.persist === false) return;
  schedulePersist();
}

/** In-memory only until the user edits or sends a chat message. */
const pendingEvents = new Map<string, OpportunityEvent>();

export function isPendingOpportunityEvent(id: string): boolean {
  return pendingEvents.has(id);
}

/** Drop an untouched draft (never persisted). */
export function discardPendingOpportunityEvent(id: string): void {
  pendingEvents.delete(id);
}

/** Save a deferred draft to local storage. */
export function persistOpportunityEvent(id: string): OpportunityEvent | null {
  const pending = pendingEvents.get(id);
  if (!pending) {
    return getOpportunityEvent(id);
  }
  pendingEvents.delete(id);
  const all = readAll();
  if (all.some((r) => r.id === id)) {
    return all.find((r) => r.id === id) ?? null;
  }
  writeAll([pending, ...all]);
  return pending;
}

export function listOpportunityEvents(
  kind?: OpportunityKind | "all",
): OpportunityEvent[] {
  let rows = readAll().filter((r) => isOpportunityKindVisible(r.kind));
  if (kind && kind !== "all") rows = rows.filter((r) => r.kind === kind);
  return rows.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/** Launched events for Events tracking / monitoring. */
export function listLaunchedEvents(): OpportunityEvent[] {
  return listOpportunityEvents().filter(
    (r) => Boolean(r.launchedAt) || r.status === "active" || r.status === "ended",
  );
}

/** Drafts being designed in Create campaign. */
export function listDraftEvents(): OpportunityEvent[] {
  return listOpportunityEvents().filter(
    (r) => !r.launchedAt && (r.status === "draft" || r.status === "planned"),
  );
}

export function getOpportunityEvent(id: string): OpportunityEvent | null {
  return pendingEvents.get(id) ?? readAll().find((r) => r.id === id) ?? null;
}

export function getOpportunityEventBySlug(
  slug: string,
): OpportunityEvent | null {
  const s = slug.trim().toLowerCase();
  const pending = [...pendingEvents.values()].find(
    (r) => r.kind === "form" && r.publicSlug?.toLowerCase() === s,
  );
  if (pending) return pending;
  return (
    readAll().find(
      (r) => r.kind === "form" && r.publicSlug?.toLowerCase() === s,
    ) ?? null
  );
}

export function formPublicUrl(slug: string): string {
  return publicAppPath(`/f/${slug}`);
}

export function createOpportunityEvent(
  input: {
    kind: OpportunityKind;
    title: string;
    description?: string;
    status?: OpportunityStatus;
  },
  options?: { deferPersist?: boolean },
): OpportunityEvent {
  const now = new Date().toISOString();
  const isForm = input.kind === "form";
  const row: OpportunityEvent = {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title.trim() || "Untitled event",
    description: (input.description || "").trim(),
    status: input.status || "draft",
    startsAt: now,
    endsAt: null,
    publicSlug: null,
    formFields: isForm ? defaultFormFields() : [],
    thankYouMessage: isForm
      ? "Thanks — we received your submission."
      : "",
    theme: { ...DEFAULT_FORM_THEME },
    launchedAt: null,
    submissionCount: 0,
    openCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (options?.deferPersist) {
    pendingEvents.set(row.id, row);
    return row;
  }
  writeAll([row, ...readAll()]);
  return row;
}

export function updateOpportunityEvent(
  id: string,
  patch: Partial<
    Pick<
      OpportunityEvent,
      | "title"
      | "description"
      | "status"
      | "startsAt"
      | "endsAt"
      | "formFields"
      | "thankYouMessage"
      | "publicSlug"
      | "theme"
      | "launchedAt"
    >
  >,
): OpportunityEvent | null {
  const pending = pendingEvents.get(id);
  if (pending) {
    const next = normalizeEvent({
      ...pending,
      ...patch,
      theme: patch.theme
        ? normalizeTheme({ ...pending.theme, ...patch.theme })
        : pending.theme,
      updatedAt: new Date().toISOString(),
    });
    pendingEvents.set(id, next);
    return next;
  }
  const all = readAll();
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const next = normalizeEvent({
    ...all[i],
    ...patch,
    theme: patch.theme
      ? normalizeTheme({ ...all[i].theme, ...patch.theme })
      : all[i].theme,
    updatedAt: new Date().toISOString(),
  });
  all[i] = next;
  writeAll(all);
  return next;
}

export function launchOpportunityEvent(id: string): OpportunityEvent | null {
  persistOpportunityEvent(id);
  const current = getOpportunityEvent(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const slug =
    current.kind === "form"
      ? current.publicSlug || allocatePublicSlug(current.title, current.id)
      : current.publicSlug;
  return updateOpportunityEvent(id, {
    status: "active",
    launchedAt: now,
    publicSlug: slug,
  });
}

export function deleteOpportunityEvent(id: string): void {
  pendingEvents.delete(id);
  writeAll(readAll().filter((r) => r.id !== id));
  if (getToken()) {
    void deleteOpportunityEventApi(id).catch(() => {});
  }
}

export function bumpFormOpen(slug: string): void {
  const key = slug.trim().toLowerCase();
  const all = readAll();
  const i = all.findIndex(
    (r) => r.kind === "form" && r.publicSlug?.toLowerCase() === key,
  );
  if (i >= 0) {
    all[i] = {
      ...all[i],
      openCount: (all[i].openCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    writeAll(all, { persist: false });
  }
  if (key) {
    void import("@/lib/public-forms").then(({ recordPublicFormOpen }) =>
      recordPublicFormOpen(key).catch(() => {}),
    );
  }
}

export function bumpFormSubmission(formId: string): void {
  const all = readAll();
  const i = all.findIndex((r) => r.id === formId);
  if (i < 0) return;
  all[i] = {
    ...all[i],
    submissionCount: (all[i].submissionCount || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
}

/** Apply agent design payload onto an event. */
export function applyFormDesignPayload(
  id: string,
  payload: Record<string, unknown>,
): OpportunityEvent | null {
  const row = getOpportunityEvent(id);
  if (!row) return null;
  persistOpportunityEvent(id);
  const patch: Parameters<typeof updateOpportunityEvent>[1] = {};
  if (typeof payload.title === "string") patch.title = payload.title;
  if (typeof payload.description === "string")
    patch.description = payload.description;
  if (typeof payload.thank_you_message === "string")
    patch.thankYouMessage = payload.thank_you_message;
  if (typeof payload.thankYouMessage === "string")
    patch.thankYouMessage = payload.thankYouMessage;
  if (Array.isArray(payload.fields) || Array.isArray(payload.formFields)) {
    const raw = (payload.fields || payload.formFields) as Array<
      Record<string, unknown>
    >;
    patch.formFields = raw.map((f, idx) =>
      normalizeField({
        id: String(f.id || `field-${idx}-${crypto.randomUUID().slice(0, 6)}`),
        label: String(f.label || "Field"),
        type: f.type,
        required: f.required,
        placeholder: f.placeholder,
        defaultValue: f.defaultValue ?? f.default_value ?? f.value,
      }),
    );
  }
  if (payload.theme && typeof payload.theme === "object") {
    patch.theme = normalizeTheme(payload.theme as Partial<FormTheme>);
  }
  if (typeof payload.button_text === "string") {
    patch.theme = normalizeTheme({
      ...row.theme,
      ...(patch.theme || {}),
      buttonText: payload.button_text,
    });
  }
  return updateOpportunityEvent(id, patch);
}
