/**
 * Generate LinkedIn / Facebook / Instagram drafts from saved SEO content.
 * Captions + Gemini images run in ai-service. Never calls Semrush.
 */

const AI_BASE =
  process.env.AI_SERVICE_BASE_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const GENERATE_TIMEOUT_MS = 240_000;

const AI_UNAVAILABLE =
  "The AI service is unavailable. Start ai-service and try Generate Posts again.";

export type SocialGenerateResult = {
  ok: boolean;
  error: string | null;
  items: unknown[];
  counts: Record<string, number>;
  images: number;
  contentId: string | null;
};

const SOCIAL_DEFAULTS = {
  linkedin: 3,
  facebook: 3,
  instagram: 3,
} as const;

export type SocialGeneratePlatform = keyof typeof SOCIAL_DEFAULTS;

export function socialGenerateCounts(input: {
  platform?: string | null;
  linkedinCount?: number;
  facebookCount?: number;
  instagramCount?: number;
}): {
  linkedinCount: number;
  facebookCount: number;
  instagramCount: number;
} {
  const platform = String(input.platform || "")
    .trim()
    .toLowerCase();
  if (
    platform === "linkedin" ||
    platform === "facebook" ||
    platform === "instagram"
  ) {
    return {
      linkedinCount:
        platform === "linkedin"
          ? input.linkedinCount ?? SOCIAL_DEFAULTS.linkedin
          : 0,
      facebookCount:
        platform === "facebook"
          ? input.facebookCount ?? SOCIAL_DEFAULTS.facebook
          : 0,
      instagramCount:
        platform === "instagram"
          ? input.instagramCount ?? SOCIAL_DEFAULTS.instagram
          : 0,
    };
  }
  return {
    linkedinCount: input.linkedinCount ?? SOCIAL_DEFAULTS.linkedin,
    facebookCount: input.facebookCount ?? SOCIAL_DEFAULTS.facebook,
    instagramCount: input.instagramCount ?? SOCIAL_DEFAULTS.instagram,
  };
}

function unavailableResult(contentId: string, error = AI_UNAVAILABLE): SocialGenerateResult {
  return {
    ok: false,
    error,
    items: [],
    counts: {},
    images: 0,
    contentId,
  };
}

function isAiUnreachable(err: unknown): boolean {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /ECONNREFUSED|fetch failed|AbortError|TimeoutError|timed out/i.test(
    raw,
  );
}

function internalHeaders(): Record<string, string> {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) headers["x-internal-secret"] = secret;
  return headers;
}

export async function generateSeoSocialFromContent(input: {
  organizationId: string;
  userId?: string | null;
  contentId: string;
  platform?: string | null;
  linkedinCount?: number;
  facebookCount?: number;
  instagramCount?: number;
}): Promise<SocialGenerateResult> {
  const counts = socialGenerateCounts(input);
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/ai/v1/internal/seo/repurpose-social`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        organizationId: input.organizationId,
        contentId: input.contentId,
        userId: input.userId || undefined,
        platform: input.platform || undefined,
        linkedinCount: counts.linkedinCount,
        facebookCount: counts.facebookCount,
        instagramCount: counts.instagramCount,
      }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (err) {
    return unavailableResult(
      input.contentId,
      isAiUnreachable(err)
        ? AI_UNAVAILABLE
        : "Could not generate social posts right now. Try again.",
    );
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const nested =
    data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : data;
  const items = Array.isArray(nested.items)
    ? nested.items
    : Array.isArray(data.items)
      ? data.items
      : [];
  const resultCounts =
    nested.counts && typeof nested.counts === "object"
      ? (nested.counts as Record<string, number>)
      : {};
  const ok = nested.ok !== false && data.ok !== false && res.ok;
  if (!ok) {
    const remoteError =
      (typeof nested.error === "string" && nested.error) ||
      (typeof data.error === "string" && data.error) ||
      (typeof nested.message === "string" && nested.message) ||
      (typeof data.message === "string" && data.message) ||
      "";
    const sanitized =
      !remoteError || /internal server error|econnrefused/i.test(remoteError)
        ? res.status >= 500
          ? AI_UNAVAILABLE
          : "Could not generate social posts right now. Try again."
        : remoteError;
    return {
      ok: false,
      error: sanitized,
      items,
      counts: resultCounts,
      images: Number(nested.images ?? 0) || 0,
      contentId: input.contentId,
    };
  }
  return {
    ok: true,
    error: null,
    items,
    counts: resultCounts,
    images: Number(nested.images ?? 0) || 0,
    contentId:
      typeof nested.contentId === "string" ? nested.contentId : input.contentId,
  };
}
