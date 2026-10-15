/**
 * Published public forms + replies (server-backed so LAN /f/:slug works).
 */

import { apiGet, apiPost } from "@/services/api";
import type {
  FormFieldDef,
  FormTheme,
  OpportunityEvent,
} from "@/lib/opportunity-events-store";
import type { FormSubmission } from "@/lib/form-submissions-store";

export type PublicFormView = {
  id: string;
  slug: string;
  title: string;
  description: string;
  thankYouMessage: string;
  status: string;
  formFields: FormFieldDef[];
  theme: FormTheme;
};

type ApiFormBody = { form?: PublicFormView };
type ApiRepliesBody = { replies?: FormSubmission[] };

function publicFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function recordPublicFormOpen(slug: string): Promise<void> {
  const res = await publicFetch(
    `/api/public/forms/${encodeURIComponent(slug)}/open`,
    { method: "POST" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error("Could not record form open");
  }
}

export async function fetchPublicForm(
  slug: string,
): Promise<PublicFormView | null> {
  const res = await publicFetch(`/api/public/forms/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load form");
  const body = (await res.json()) as ApiFormBody;
  return body.form || null;
}

export async function submitPublicFormReply(input: {
  slug: string;
  answers: Record<string, string>;
  fields: Record<string, string>;
}): Promise<FormSubmission> {
  const res = await publicFetch(
    `/api/public/forms/${encodeURIComponent(input.slug)}/replies`,
    {
      method: "POST",
      body: JSON.stringify({
        answers: input.answers,
        fields: input.fields,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    reply?: FormSubmission;
  };
  if (!res.ok) {
    throw new Error(body.message || "Could not save form reply");
  }
  if (!body.reply) {
    throw new Error("Could not save form reply");
  }
  return body.reply;
}

export async function publishPublicForm(
  event: OpportunityEvent,
): Promise<PublicFormView> {
  if (!event.publicSlug) {
    throw new Error("Form has no public URL yet");
  }
  const { data } = await apiPost<ApiFormBody>("/public/forms/publish", {
    id: event.id,
    slug: event.publicSlug,
    title: event.title,
    description: event.description,
    thankYouMessage: event.thankYouMessage,
    status: event.status,
    formFields: event.formFields,
    theme: event.theme,
  });
  if (!data.form) throw new Error("Publish did not return a form");
  return data.form;
}

export async function fetchPublicFormReplies(
  slug: string,
): Promise<FormSubmission[]> {
  const { data } = await apiGet<ApiRepliesBody>(
    `/public/forms/${encodeURIComponent(slug)}/replies`,
  );
  return Array.isArray(data.replies) ? data.replies : [];
}

export function publicFormToEvent(
  form: PublicFormView,
): Pick<
  OpportunityEvent,
  | "id"
  | "kind"
  | "title"
  | "description"
  | "thankYouMessage"
  | "status"
  | "formFields"
  | "theme"
  | "publicSlug"
> {
  return {
    id: form.id,
    kind: "form",
    title: form.title,
    description: form.description,
    thankYouMessage: form.thankYouMessage,
    status: form.status === "ended" ? "ended" : "active",
    formFields: form.formFields || [],
    theme: form.theme,
    publicSlug: form.slug,
  };
}
