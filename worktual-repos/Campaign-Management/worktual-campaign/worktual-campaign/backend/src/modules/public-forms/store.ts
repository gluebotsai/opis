import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addFormSubmissionDao,
  getOpportunityEventBySlugDao,
  listFormSubmissionsBySlugDao,
} from "../../dao/opportunity-events.js";
import { cacheGet, cacheSet } from "../../plugins/redis.js";

export type PublicFormField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
};

export type PublicFormTheme = {
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

export type PublicFormRecord = {
  id: string;
  slug: string;
  organizationId: string;
  title: string;
  description: string;
  thankYouMessage: string;
  status: string;
  formFields: PublicFormField[];
  theme: PublicFormTheme;
  publishedAt: string;
  updatedAt: string;
};

export type PublicFormReply = {
  id: string;
  formId: string;
  formSlug: string;
  answers: Record<string, string>;
  fields: Record<string, string>;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data", "public-forms");

function safeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function formPath(slug: string) {
  return path.join(DATA_DIR, `${safeSlug(slug)}.json`);
}

function repliesPath(slug: string) {
  return path.join(DATA_DIR, `${safeSlug(slug)}.replies.json`);
}

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function savePublicForm(row: PublicFormRecord): Promise<void> {
  const slug = safeSlug(row.slug);
  const next = { ...row, slug };
  await ensureDir();
  await writeFile(formPath(slug), JSON.stringify(next, null, 2), "utf8");
  await cacheSet(`public-form:${slug}`, JSON.stringify(next));
}

function eventPayloadToPublicForm(
  ev: Record<string, unknown>,
  slug: string,
): PublicFormRecord | null {
  const id = String(ev.id || "").trim();
  if (!id) return null;
  const themeRaw =
    ev.theme && typeof ev.theme === "object"
      ? (ev.theme as Record<string, unknown>)
      : {};
  const fieldsRaw = Array.isArray(ev.formFields) ? ev.formFields : [];
  return {
    id,
    slug,
    organizationId: String(ev.organizationId || ""),
    title: String(ev.title || "Untitled form"),
    description: String(ev.description || ""),
    thankYouMessage: String(
      ev.thankYouMessage || "Thanks — we received your submission.",
    ),
    status: String(ev.status || "active"),
    formFields: fieldsRaw as PublicFormField[],
    theme: {
      primaryColor: String(themeRaw.primaryColor || "#5b4bdb"),
      backgroundColor: String(themeRaw.backgroundColor || "#f3f4f6"),
      surfaceColor: String(themeRaw.surfaceColor || "#ffffff"),
      textColor: String(themeRaw.textColor || "#111827"),
      mutedColor: String(themeRaw.mutedColor || "#6b7280"),
      buttonText: String(themeRaw.buttonText || "Submit"),
      logoUrl: String(themeRaw.logoUrl || ""),
      borderRadiusPx: Number(themeRaw.borderRadiusPx) || 12,
      spacingScale: Number(themeRaw.spacingScale) || 1,
      fontFamily: String(themeRaw.fontFamily || "Inter, system-ui, sans-serif"),
    },
    publishedAt: String(ev.launchedAt || ev.createdAt || new Date().toISOString()),
    updatedAt: String(ev.updatedAt || new Date().toISOString()),
  };
}

export async function getPublicForm(
  slug: string,
): Promise<PublicFormRecord | null> {
  const key = safeSlug(slug);
  if (!key) return null;
  try {
    const fromDb = await getOpportunityEventBySlugDao(key);
    if (fromDb && String(fromDb.kind || "") === "form") {
      const mapped = eventPayloadToPublicForm(fromDb, key);
      if (mapped) {
        await cacheSet(`public-form:${key}`, JSON.stringify(mapped));
        return mapped;
      }
    }
  } catch {
    /* fall through to legacy file store */
  }
  const cached = await cacheGet(`public-form:${key}`);
  if (cached) {
    try {
      return JSON.parse(cached) as PublicFormRecord;
    } catch {
      /* fall through */
    }
  }
  const row = await readJson<PublicFormRecord | null>(formPath(key), null);
  if (row) await cacheSet(`public-form:${key}`, JSON.stringify(row));
  return row;
}

export async function listPublicFormReplies(
  slug: string,
): Promise<PublicFormReply[]> {
  const key = safeSlug(slug);
  const rows = await readJson<PublicFormReply[]>(repliesPath(key), []);
  try {
    const fromDb = await listFormSubmissionsBySlugDao(key);
    const byId = new Map<string, PublicFormReply>();
    for (const r of rows) byId.set(r.id, r);
    for (const r of fromDb) {
      byId.set(r.id, {
        id: r.id,
        formId: r.formId,
        formSlug: r.formSlug,
        answers: r.answers,
        fields: r.fields,
        createdAt: r.createdAt,
      });
    }
    return [...byId.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } catch {
    return rows.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}

export async function addPublicFormReply(
  slug: string,
  reply: PublicFormReply,
): Promise<PublicFormReply> {
  const key = safeSlug(slug);
  const event = await getOpportunityEventBySlugDao(key);
  if (event?.id && event.organizationId) {
    try {
      const saved = await addFormSubmissionDao({
        organizationId: BigInt(String(event.organizationId)),
        eventPublicId: String(event.id),
        formSlug: key,
        reply: {
          id: reply.id,
          answers: reply.answers,
          fields: reply.fields,
          createdAt: reply.createdAt,
        },
      });
      return {
        id: saved.id,
        formId: saved.formId,
        formSlug: saved.formSlug,
        answers: saved.answers,
        fields: saved.fields,
        createdAt: saved.createdAt,
      };
    } catch {
      /* fall through to legacy file store */
    }
  }
  await ensureDir();
  const rows = await readJson<PublicFormReply[]>(repliesPath(key), []);
  const next = [reply, ...rows].slice(0, 2000);
  await writeFile(repliesPath(key), JSON.stringify(next, null, 2), "utf8");
  return reply;
}
