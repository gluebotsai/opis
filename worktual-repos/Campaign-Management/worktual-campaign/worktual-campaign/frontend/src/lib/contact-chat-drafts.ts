/**
 * Contact chat drafts (Phase 1 — localStorage).
 * Chat extracts contact fields; final save goes to my_account_qa via API.
 */

import { packStorageKey } from "@/lib/industry-packs";
import { titleCasePersonName } from "@/lib/contact-validation";

export type ContactChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type ContactChatFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
};

export type ContactChatDraft = {
  id: string;
  title: string;
  fields: ContactChatFields;
  messages: ContactChatMessage[];
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
  createdContactId: string | null;
};

const STORAGE_KEY_BASE = "worktual.contactChatDrafts.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): ContactChatDraft[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContactChatDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: ContactChatDraft[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(drafts));
}

export function createEmptyContactDraft(
  partial?: Partial<ContactChatDraft>,
): ContactChatDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New contact chat",
    fields: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      companyName: "",
    },
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Describe the contact in chat — for example: “Add Priya, email priya@acme.com” or “Add Priya, phone +91 9876543210.” I need a first name and an email or phone with country code. Last name, company, and city are optional.",
        createdAt: now,
      },
    ],
    dirty: false,
    createdAt: now,
    updatedAt: now,
    createdContactId: null,
    ...partial,
  };
}

export function getContactDraft(id: string): ContactChatDraft | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function upsertContactDraft(draft: ContactChatDraft): void {
  const all = readAll();
  const i = all.findIndex((d) => d.id === draft.id);
  if (i >= 0) all[i] = draft;
  else all.unshift(draft);
  writeAll(all);
}

export function deleteContactDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m?.[0]?.toLowerCase() ?? null;
}

function extractPhone(text: string): string | null {
  const m = text.match(
    /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/,
  );
  if (!m) return null;
  const digits = m[0].replace(/[^\d+]/g, "");
  return digits.length >= 8 ? m[0].trim() : null;
}

function extractName(text: string): { firstName: string; lastName: string } {
  const cleaned = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(
      /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/g,
      " ",
    )
    .replace(/\b(add|create|contact|email|phone|mobile|company|at|is|named|name)\b/gi, " ")
    .replace(/[,.;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const labeled = text.match(
    /(?:name|named|contact)\s*[:\-]?\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i,
  );
  const source = labeled?.[1]?.trim() || cleaned;
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 3);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) {
    return { firstName: titleCasePersonName(parts[0]), lastName: "" };
  }
  return {
    firstName: titleCasePersonName(parts[0]),
    lastName: titleCasePersonName(parts.slice(1).join(" ")),
  };
}

function extractCompany(text: string): string | null {
  const m = text.match(
    /(?:company|org(?:anisation|anization)?|works?\s+at|from)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 .&'-]{1,60})/i,
  );
  return m?.[1]?.trim().replace(/[.,;]+$/, "") ?? null;
}

export function mergeFieldsFromPrompt(
  fields: ContactChatFields,
  text: string,
): ContactChatFields {
  const next = { ...fields };
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const company = extractCompany(text);
  const { firstName, lastName } = extractName(text);

  if (email) next.email = email;
  if (phone) next.phone = phone;
  if (company) next.companyName = company;
  if (firstName && !next.firstName) next.firstName = firstName;
  else if (firstName && /name|named|contact|add|create/i.test(text)) {
    next.firstName = firstName;
    if (lastName) next.lastName = lastName;
  } else if (firstName && !email && !phone) {
    next.firstName = firstName;
    if (lastName) next.lastName = lastName;
  } else if (lastName && next.firstName && !next.lastName) {
    next.lastName = lastName;
  }

  // Explicit field updates: "email is x", "first name John"
  const firstOnly = text.match(/first\s*name\s*[:\-]?\s*([A-Za-z][A-Za-z.'-]*)/i);
  if (firstOnly?.[1]) next.firstName = firstOnly[1];
  const lastOnly = text.match(/last\s*name\s*[:\-]?\s*([A-Za-z][A-Za-z.'-]*)/i);
  if (lastOnly?.[1]) next.lastName = lastOnly[1];

  return next;
}

export function buildAssistantReply(fields: ContactChatFields): string {
  const missing: string[] = [];
  if (!fields.firstName.trim()) missing.push("first name");
  if (!fields.email.trim() && !fields.phone.trim()) {
    missing.push("email or phone with country code");
  }

  const lines: string[] = [];
  const name = [fields.firstName, fields.lastName].filter(Boolean).join(" ");
  if (name) lines.push(`Name: ${name}`);
  if (fields.email.trim()) lines.push(`Email: ${fields.email.trim()}`);
  if (fields.phone.trim()) lines.push(`Phone: ${fields.phone.trim()}`);
  if (fields.companyName.trim()) lines.push(`Company: ${fields.companyName.trim()}`);

  const body = lines.length ? lines.join("\n") : "No fields filled yet.";

  if (missing.length) {
    return `Got it. Here’s what I have so far:\n${body}\n\nStill need: ${missing.join(" and ")}. Share those and say “create contact” when ready.`;
  }

  return `Looks ready:\n${body}\n\nClick “Create contact” below or type “create contact” to save.`;
}

export function applyUserPromptToContactDraft(
  draft: ContactChatDraft,
  text: string,
): ContactChatDraft {
  const now = new Date().toISOString();
  const fields = mergeFieldsFromPrompt(draft.fields, text);
  const title =
    [fields.firstName, fields.lastName].filter(Boolean).join(" ") ||
    fields.email ||
    draft.title;

  const userMsg: ContactChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    createdAt: now,
  };
  const assistantMsg: ContactChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: buildAssistantReply(fields),
    createdAt: now,
  };

  return {
    ...draft,
    title: title.slice(0, 72),
    fields,
    messages: [...draft.messages, userMsg, assistantMsg],
    dirty: true,
    updatedAt: now,
  };
}

export function isContactDraftReady(fields: ContactChatFields): boolean {
  return Boolean(
    fields.firstName.trim() &&
      (fields.email.trim() || fields.phone.trim()),
  );
}

export function wantsCreateIntent(text: string): boolean {
  return /\b(create|save|add)\b.*\bcontact\b|\bcontact\b.*\b(create|save|add)\b|\bsave\s*(it|contact)?\b/i.test(
    text,
  );
}
