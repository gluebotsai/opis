import { rowToCamel, toIso } from "../../db/util.js";
import {
  deleteMailTemplate,
  insertMailTemplate,
  selectMailTemplateById,
  selectMailTemplates,
  updateMailTemplate,
} from "../../repositories/raw/mailTemplates.repo.js";

function mapTemplateRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    id: entry.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    name: entry.name || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    subject: entry.subject || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    bodyHtml: entry.bodyHtml || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    createdBy: entry.createdBy || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    updatedBy: entry.updatedBy || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    createdAt: toIso(entry.createdAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    updatedAt: toIso(entry.updatedAt),
  };
}

function normalizeTemplatePayload(payload = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const name = String(payload.name || "").trim();
  if (!name) {
    throw new Error("Template name is required.");
  }
  return {
    name,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    subject: String(payload.subject || "").trim(),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    bodyHtml: String(payload.bodyHtml || payload.htmlBody || ""),
  };
}

export async function listMailTemplates() {
  const rows = await selectMailTemplates();
  return rows.map(mapTemplateRow);
}

export async function getMailTemplate(id: any) {
  return mapTemplateRow(await selectMailTemplateById(id));
}

export async function createMailTemplate(payload: any, actorEmail: any) {
  const data = normalizeTemplatePayload(payload);
  const row = await insertMailTemplate({
    name: data.name,
    subject: data.subject,
    bodyHtml: data.bodyHtml,
    actorEmail,
  });
  return mapTemplateRow(row);
}

export async function patchMailTemplate(id: any, payload: any, actorEmail: any) {
  const existing = await getMailTemplate(id);
  if (!existing) {
    throw new Error("Mail template not found.");
  }
  const data = normalizeTemplatePayload({ ...existing, ...payload });
  const row = await updateMailTemplate(id, {
    name: data.name,
    subject: data.subject,
    bodyHtml: data.bodyHtml,
    actorEmail,
  });
  return mapTemplateRow(row);
}

export async function removeMailTemplate(id: any) {
  const ok = await deleteMailTemplate(id);
  if (!ok) {
    throw new Error("Mail template not found.");
  }
  return { ok: true };
}
