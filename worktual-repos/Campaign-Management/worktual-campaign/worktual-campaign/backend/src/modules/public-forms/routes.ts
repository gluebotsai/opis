import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  requireSession,
  validateSession,
} from "../../middlewares/authendication.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import {
  bumpOpportunityOpenBySlugDao,
  upsertPublicFormFromPublishDao,
} from "../../dao/opportunity-events.js";
import {
  addPublicFormReply,
  getPublicForm,
  listPublicFormReplies,
  savePublicForm,
  type PublicFormField,
  type PublicFormRecord,
  type PublicFormTheme,
} from "./store.js";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function publicFormView(row: PublicFormRecord) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    thankYouMessage: row.thankYouMessage,
    status: row.status,
    formFields: row.formFields,
    theme: row.theme,
  };
}

export default async function publicFormRoutes(server: FastifyInstance) {
  server.post(
    "/publish",
    { preValidation: [validateSession] },
    async (request, reply) => {
      const session = requireSession(request);
      const body = asRecord(request.body);
      const id = str(body.id).trim();
      const slug = str(body.slug).trim().toLowerCase();
      if (!id || !slug) {
        throw new AppError("Form id and slug are required.", 400);
      }
      const existing = await getPublicForm(slug);
      if (existing && existing.id !== id) {
        throw new AppError("That public URL is already in use.", 409);
      }
      const themeRaw = asRecord(body.theme);
      const fieldsRaw = Array.isArray(body.formFields)
        ? (body.formFields as unknown[])
        : [];
      const formFields: PublicFormField[] = fieldsRaw.map((item, idx) => {
        const f = asRecord(item);
        return {
          id: str(f.id, `field-${idx}`),
          label: str(f.label, "Field"),
          type: str(f.type, "text"),
          required: Boolean(f.required),
          placeholder: str(f.placeholder) || undefined,
          defaultValue: str(f.defaultValue) || undefined,
        };
      });
      const theme: PublicFormTheme = {
        primaryColor: str(themeRaw.primaryColor, "#5b4bdb"),
        backgroundColor: str(themeRaw.backgroundColor, "#f3f4f6"),
        surfaceColor: str(themeRaw.surfaceColor, "#ffffff"),
        textColor: str(themeRaw.textColor, "#111827"),
        mutedColor: str(themeRaw.mutedColor, "#6b7280"),
        buttonText: str(themeRaw.buttonText, "Submit"),
        logoUrl: str(themeRaw.logoUrl),
        borderRadiusPx: Number(themeRaw.borderRadiusPx) || 12,
        spacingScale: Number(themeRaw.spacingScale) || 1,
        fontFamily: str(themeRaw.fontFamily, "Inter, system-ui, sans-serif"),
      };
      const now = new Date().toISOString();
      const record: PublicFormRecord = {
        id,
        slug,
        organizationId: session.organizationId,
        title: str(body.title, "Untitled form"),
        description: str(body.description),
        thankYouMessage: str(
          body.thankYouMessage,
          "Thanks — we received your submission.",
        ),
        status: str(body.status, "active"),
        formFields,
        theme,
        publishedAt: existing?.publishedAt || now,
        updatedAt: now,
      };
      await savePublicForm(record);
      await upsertPublicFormFromPublishDao(session, record);
      return sendSuccess(reply, "Form published", {
        form: publicFormView(record),
      });
    },
  );

  server.post("/:slug/open", async (request, reply) => {
    const slug = str((request.params as { slug?: string }).slug).trim();
    const row = await getPublicForm(slug);
    if (!row || row.status === "ended") {
      throw new AppError("Form not found", 404);
    }
    await bumpOpportunityOpenBySlugDao(slug);
    return sendSuccess(reply, "Form open recorded", { ok: true });
  });

  server.get("/:slug", async (request, reply) => {
    const slug = str((request.params as { slug?: string }).slug).trim();
    const row = await getPublicForm(slug);
    if (!row || row.status === "ended") {
      throw new AppError("Form not found", 404);
    }
    return sendSuccess(reply, "Public form", { form: publicFormView(row) });
  });

  server.post("/:slug/replies", async (request, reply) => {
    const slug = str((request.params as { slug?: string }).slug).trim();
    const row = await getPublicForm(slug);
    if (!row || row.status === "ended") {
      throw new AppError("Form not found", 404);
    }
    const body = asRecord(request.body);
    const rawAnswers = asRecord(body.answers);
    const rawFields = asRecord(body.fields);
    const answers: Record<string, string> = {};
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAnswers)) {
      if (typeof v === "string") answers[k] = v.trim().slice(0, 2000);
    }
    for (const [k, v] of Object.entries(rawFields)) {
      if (typeof v === "string") fields[k] = v.trim().slice(0, 2000);
    }
    for (const field of row.formFields) {
      const value = (fields[field.id] || answers[field.label] || "").trim();
      if (field.required && !value) {
        throw new AppError(`${field.label} is required.`, 400);
      }
      if (!fields[field.id] && value) fields[field.id] = value;
      if (!answers[field.label] && value) answers[field.label] = value;
    }
    const saved = await addPublicFormReply(slug, {
      id: randomUUID(),
      formId: row.id,
      formSlug: row.slug,
      answers,
      fields,
      createdAt: new Date().toISOString(),
    });
    return sendSuccess(reply, "Form reply saved", { reply: saved }, 201);
  });

  server.get(
    "/:slug/replies",
    { preValidation: [validateSession] },
    async (request, reply) => {
      requireSession(request);
      const slug = str((request.params as { slug?: string }).slug).trim();
      const row = await getPublicForm(slug);
      if (!row) throw new AppError("Form not found", 404);
      const replies = await listPublicFormReplies(slug);
      return sendSuccess(reply, "Form replies", {
        replies,
        count: replies.length,
      });
    },
  );
}
