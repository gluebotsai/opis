/**
 * Form submissions cache — source of truth is /api/public/forms/:slug/replies (DB).
 */

import { packStorageKey } from "@/lib/industry-packs";

export type FormSubmission = {
  id: string;
  formId: string;
  formSlug: string;
  answers: Record<string, string>;
  /** Field-id keyed values — used to replay a reply onto the form. */
  fields?: Record<string, string>;
  createdAt: string;
};

const STORAGE_KEY_BASE = "worktual.formSubmissions.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): FormSubmission[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FormSubmission[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: FormSubmission[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(rows.slice(0, 500)));
}

export function listFormSubmissions(
  formId: string,
  slug?: string | null,
): FormSubmission[] {
  const id = formId.trim();
  const s = slug?.trim().toLowerCase() || "";
  return readAll()
    .filter(
      (row) =>
        row.formId === id || (s && row.formSlug.toLowerCase() === s),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

/** Cache a submission returned from the public forms API (counts updated server-side). */
export function createFormSubmission(input: {
  id?: string;
  formId: string;
  formSlug: string;
  answers: Record<string, string>;
  fields?: Record<string, string>;
  createdAt?: string;
}): FormSubmission {
  const row: FormSubmission = {
    id: input.id || crypto.randomUUID(),
    formId: input.formId,
    formSlug: input.formSlug,
    answers: input.answers,
    fields: input.fields,
    createdAt: input.createdAt || new Date().toISOString(),
  };
  upsertFormSubmissions([row]);
  return row;
}

export function upsertFormSubmissions(rows: FormSubmission[]): void {
  if (rows.length === 0) return;
  const all = readAll();
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const row of rows) {
    byId.set(row.id, row);
  }
  writeAll(
    [...byId.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );
}
