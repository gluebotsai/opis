/**
 * SMS (DLT) + WhatsApp (Meta) approval templates.
 * Local until backend / social-service wiring; locked after submit.
 */

import { packStorageKey } from "@/lib/industry-packs";

export type RegulatedChannel = "sms" | "whatsapp";

/** draft = editable; pending/approved/rejected = locked fields */
export type RegulatedApprovalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected";

export type RegulatedTemplate = {
  id: string;
  channel: RegulatedChannel;
  name: string;
  /** DLT ID (SMS) or Meta template name/id (WhatsApp) */
  externalId: string;
  language: string;
  category: string;
  body: string;
  header: string;
  footer: string;
  /** WhatsApp button labels, comma-separated or one per line in UI */
  buttons: string;
  status: RegulatedApprovalStatus;
  rejectedReason: string;
  createdAt: string;
  updatedAt: string;
  /** Set when moved out of draft (submit / upload approved) */
  submittedAt: string | null;
};

const STORAGE_KEY_BASE = "worktual.regulatedTemplates.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): RegulatedTemplate[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RegulatedTemplate[];
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: RegulatedTemplate[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(rows));
}

function normalize(row: RegulatedTemplate): RegulatedTemplate {
  return {
    ...row,
    externalId: row.externalId || "",
    language: row.language || "en",
    category: row.category || "",
    body: row.body || "",
    header: row.header || "",
    footer: row.footer || "",
    buttons: row.buttons || "",
    rejectedReason: row.rejectedReason || "",
    submittedAt: row.submittedAt ?? null,
  };
}

export function isRegulatedLocked(row: RegulatedTemplate): boolean {
  return row.status !== "draft";
}

export function listRegulatedTemplates(
  channel?: RegulatedChannel,
): RegulatedTemplate[] {
  const rows = readAll();
  const filtered = channel
    ? rows.filter((r) => r.channel === channel)
    : rows;
  return filtered.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function getRegulatedTemplate(id: string): RegulatedTemplate | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function createRegulatedTemplate(
  partial: Omit<
    RegulatedTemplate,
    "id" | "createdAt" | "updatedAt" | "submittedAt"
  > & { submittedAt?: string | null },
): RegulatedTemplate {
  const now = new Date().toISOString();
  const row: RegulatedTemplate = normalize({
    ...partial,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    submittedAt: partial.submittedAt ?? null,
  });
  writeAll([row, ...readAll()]);
  return row;
}

export function updateRegulatedTemplate(
  id: string,
  patch: Partial<RegulatedTemplate>,
): RegulatedTemplate | null {
  const all = readAll();
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const current = all[i];
  if (isRegulatedLocked(current)) {
    // Only status / rejection reason may change after submit.
    const allowed: Partial<RegulatedTemplate> = {};
    if (patch.status !== undefined) allowed.status = patch.status;
    if (patch.rejectedReason !== undefined) {
      allowed.rejectedReason = patch.rejectedReason;
    }
    all[i] = normalize({
      ...current,
      ...allowed,
      updatedAt: new Date().toISOString(),
    });
  } else {
    all[i] = normalize({
      ...current,
      ...patch,
      id: current.id,
      channel: current.channel,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }
  writeAll(all);
  return all[i];
}

/** Move draft → pending (waiting approval). Locks fields. */
export function submitRegulatedForApproval(id: string): RegulatedTemplate | null {
  const row = getRegulatedTemplate(id);
  if (!row || row.status !== "draft") return null;
  const now = new Date().toISOString();
  return updateRegulatedTemplateUnlocked(id, {
    status: "pending",
    submittedAt: now,
    updatedAt: now,
  });
}

/** Register as already approved (SMS upload / known Meta ID). Locks fields. */
export function registerRegulatedApproved(
  partial: Omit<
    RegulatedTemplate,
    "id" | "createdAt" | "updatedAt" | "submittedAt" | "status" | "rejectedReason"
  >,
): RegulatedTemplate {
  const now = new Date().toISOString();
  return createRegulatedTemplate({
    ...partial,
    status: "approved",
    rejectedReason: "",
    submittedAt: now,
  });
}

function updateRegulatedTemplateUnlocked(
  id: string,
  patch: Partial<RegulatedTemplate>,
): RegulatedTemplate | null {
  const all = readAll();
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) return null;
  all[i] = normalize({
    ...all[i],
    ...patch,
    id: all[i].id,
    channel: all[i].channel,
    createdAt: all[i].createdAt,
    updatedAt: new Date().toISOString(),
  });
  writeAll(all);
  return all[i];
}

export function setRegulatedStatus(
  id: string,
  status: RegulatedApprovalStatus,
  rejectedReason = "",
): RegulatedTemplate | null {
  const row = getRegulatedTemplate(id);
  if (!row) return null;
  if (row.status === "draft" && status !== "draft") {
    return updateRegulatedTemplateUnlocked(id, {
      status,
      rejectedReason: status === "rejected" ? rejectedReason : "",
      submittedAt: row.submittedAt || new Date().toISOString(),
    });
  }
  return updateRegulatedTemplate(id, {
    status,
    rejectedReason: status === "rejected" ? rejectedReason : "",
  });
}

export function deleteRegulatedTemplate(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function whatsappNameValid(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name.trim());
}
