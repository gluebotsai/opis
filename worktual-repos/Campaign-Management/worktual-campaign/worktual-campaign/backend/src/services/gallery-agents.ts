/**
 * Call campaign agents HTTP for Template Gallery bootstrap.
 * Decision + generation live in Python (`/gallery/worker/process-job-chunk`).
 * Legacy `/gallery/bootstrap/chunk` kept for smoke tests / partial calls.
 */

export type GalleryIdeaRow = {
  idea_key: string;
  title: string;
  summary: string;
  goal: string;
};

export type GalleryTemplateRow = {
  gallery_key: string;
  name: string;
  description?: string;
  goal?: string;
  primary_channel: string;
  body_preview?: string;
  content_body?: string;
  preview_image?: string | null;
  preview?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

function agentsBaseUrl(): string {
  const fromEnv =
    process.env.AGENTS_INTERNAL_URL?.trim() ||
    process.env.AGENTS_URL?.trim() ||
    "";
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Docker Compose service name when AGENTS_INTERNAL_URL is unset
  if (process.env.NODE_ENV === "production") {
    return "http://agents:8005";
  }
  return "http://127.0.0.1:8005";
}

export type GalleryWorkerMutation =
  | { op: "purge_legacy"; organization_id: string }
  | {
      op: "upsert_idea";
      organization_id: string;
      idea_key: string;
      title: string;
      summary?: string;
      goal?: string;
      industry?: string;
      industry_type?: string;
      pack_id?: string;
      sort_order?: number;
    }
  | {
      op: "upsert_template";
      organization_id: string;
      gallery_key: string;
      name: string;
      description?: string;
      goal?: string;
      primary_channel: string;
      channels?: string[];
      body_preview?: string;
      content_body?: string;
      preview_image?: string | null;
      preview?: Record<string, unknown> | null;
      fields?: Record<string, unknown> | null;
      metadata?: Record<string, unknown>;
    }
  | {
      op: "update_job";
      job_id: string;
      status?: string;
      error_message?: string | null;
      progress?: Record<string, unknown>;
    };

export type GalleryWorkerChunkResult = {
  ok: boolean;
  error?: string;
  mutations: GalleryWorkerMutation[];
  logs?: Array<{ level?: string; msg?: string; data?: unknown }>;
};

async function postAgentsJson(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<Record<string, unknown>> {
  const url = `${agentsBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok === false) {
      throw new Error(
        String(data.error || data.message || `Agents ${path} (${res.status})`),
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Python-owned gallery tick: decisions + LLM/image generation. */
export async function processGalleryJobChunkViaAgents(input: {
  job: Record<string, unknown>;
  org: Record<string, unknown>;
  orgCtx: Record<string, unknown>;
  ideas: unknown[];
  templates: unknown[];
  authToken?: string;
  templatesPerTick?: number;
}): Promise<GalleryWorkerChunkResult> {
  try {
    const data = await postAgentsJson("/gallery/worker/process-job-chunk", {
      job: input.job,
      org: input.org,
      org_ctx: input.orgCtx,
      ideas: input.ideas,
      templates: input.templates,
      auth_token: input.authToken || "",
      templates_per_tick: input.templatesPerTick ?? 2,
    });
    const mutations = Array.isArray(data.mutations)
      ? (data.mutations as GalleryWorkerMutation[])
      : [];
    const logs = Array.isArray(data.logs)
      ? (data.logs as GalleryWorkerChunkResult["logs"])
      : [];
    return { ok: true, mutations, logs };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not reach agents for gallery worker chunk",
      mutations: [],
    };
  }
}

async function postGalleryChunk(body: Record<string, unknown>) {
  try {
    const data = await postAgentsJson("/gallery/bootstrap/chunk", body);
    if (body.step === "ideas") {
      const ideas = data.ideas;
      if (!Array.isArray(ideas) || ideas.length === 0) {
        return {
          ok: false as const,
          error: String(
            data.error || "Agents returned no gallery campaign ideas",
          ),
        };
      }
    }
    return { ok: true as const, data };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error
          ? err.message
          : "Could not reach agents for gallery bootstrap",
    };
  }
}

export async function generateGalleryIdeasViaAgents(input: {
  org: Record<string, unknown>;
  ideasNeeded: number;
  existingTitles: string[];
}) {
  return postGalleryChunk({
    step: "ideas",
    org: input.org,
    ideas_needed: input.ideasNeeded,
    existing_titles: input.existingTitles,
  });
}

export async function generateGalleryIdeaImageViaAgents(input: {
  org: Record<string, unknown>;
  idea: Record<string, unknown>;
  authToken?: string;
}) {
  return postGalleryChunk({
    step: "idea_image",
    org: input.org,
    idea: input.idea,
    auth_token: input.authToken || "",
  });
}

export async function syncGalleryWebPushImageViaAgents(input: {
  org: Record<string, unknown>;
  idea: Record<string, unknown>;
  fields: Record<string, unknown>;
  preview?: Record<string, unknown> | null;
  emailImageUrl: string;
  variantIndex: number;
}) {
  return postGalleryChunk({
    step: "sync_web_push_image",
    org: input.org,
    idea: input.idea,
    fields: input.fields,
    preview: input.preview || null,
    email_image_url: input.emailImageUrl,
    variant_index: input.variantIndex,
  });
}

export async function attachGalleryEmailImageViaAgents(input: {
  org: Record<string, unknown>;
  idea: Record<string, unknown>;
  fields: Record<string, unknown>;
  variantIndex: number;
  authToken?: string;
}) {
  return postGalleryChunk({
    step: "attach_image",
    org: input.org,
    idea: input.idea,
    fields: input.fields,
    variant_index: input.variantIndex,
    auth_token: input.authToken || "",
  });
}

export async function generateOneGalleryTemplateViaAgents(input: {
  org: Record<string, unknown>;
  idea: Record<string, unknown>;
  spec: Record<string, unknown>;
  existingGalleryKeys: string[];
  batchId: string;
  authToken?: string;
  priorGalleryTemplates?: Array<Record<string, unknown>>;
  forceRegen?: boolean;
}) {
  return postGalleryChunk({
    step: "one_template",
    org: input.org,
    idea: input.idea,
    spec: input.spec,
    existing_gallery_keys: input.existingGalleryKeys,
    batch_id: input.batchId,
    auth_token: input.authToken || "",
    prior_gallery_templates: input.priorGalleryTemplates || [],
    force_regen: input.forceRegen === true,
  });
}
