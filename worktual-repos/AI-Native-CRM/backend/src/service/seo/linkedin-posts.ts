/**
 * LinkedIn personal-profile posting (Posts + Images APIs).
 * Tokens from Onboarding connected-apps API (or legacy setup_app_connections fallback).
 *
 * Required MyAccounts scopes: openid profile w_member_social
 */

export const LINKEDIN_MEMBER_SCOPES = [
  "openid",
  "profile",
  "w_member_social",
] as const;

const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const IMAGES_INIT_URL =
  "https://api.linkedin.com/rest/images?action=initializeUpload";

const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif"]);

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type LinkedInImage = {
  bytes: Buffer;
  mime: string;
};

export type LinkedInPublishResult = {
  externalId: string | null;
  error: string | null;
  needsReauth?: boolean;
};

export function linkedinApiVersion(): string {
  const raw = process.env.LINKEDIN_API_VERSION?.trim() || "202608";
  return /^\d{6}$/.test(raw) ? raw : "202608";
}

export function linkedinRestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": linkedinApiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

export function personUrnFromSub(sub: string | null | undefined): string | null {
  const id = String(sub || "").trim();
  if (!id) return null;
  if (id.startsWith("urn:li:person:")) return id;
  if (id.startsWith("urn:li:")) return null;
  return `urn:li:person:${id}`;
}

export function storedLinkedInPersonUrn(conn: {
  externalAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const meta = conn.metadata || {};
  const candidates = [
    meta.personUrn,
    meta.authorUrn,
    meta.linkedinPersonUrn,
    meta.memberUrn,
    conn.externalAccountId,
  ];
  for (const raw of candidates) {
    const value = raw == null ? "" : String(raw).trim();
    if (!value) continue;
    if (value.startsWith("urn:li:person:")) return value;
  }
  return null;
}

/** true/false when scopes are recorded; null if Accounts left scopes empty. */
export function linkedinMemberScopesOk(
  scopes: string | null | undefined,
): boolean | null {
  const raw = (scopes || "").trim();
  if (!raw) return null;
  const parts = new Set(
    raw
      .toLowerCase()
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return parts.has("w_member_social");
}

export function linkedinMissingScopeMessage(): string {
  return (
    "This LinkedIn connection is missing w_member_social. In MyAccounts, reconnect " +
    `with scopes: ${LINKEDIN_MEMBER_SCOPES.join(", ")}.`
  );
}

export function plainLinkedInCommentary(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 3000);
}

export function isLinkedInImageMime(mime: string): boolean {
  return ALLOWED_IMAGE_MIME.has(mime.toLowerCase().split(";")[0]?.trim() || "");
}

export function linkedinTextPostBody(author: string, commentary: string) {
  return {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [] as string[],
      thirdPartyDistributionChannels: [] as string[],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

export function linkedinImagePostBody(
  author: string,
  commentary: string,
  imageUrn: string,
  title: string,
) {
  return {
    ...linkedinTextPostBody(author, commentary),
    content: {
      media: {
        title: title.slice(0, 200) || "Post",
        id: imageUrn,
      },
    },
  };
}

function linkedinErrorMessage(
  status: number,
  data: Record<string, unknown>,
): string {
  const message =
    (typeof data.message === "string" && data.message) ||
    (typeof data.error === "string" && data.error) ||
    "";
  if (status === 401) {
    return "LinkedIn access token is invalid or expired. Reconnect LinkedIn in MyAccounts.";
  }
  if (status === 403) {
    return linkedinMissingScopeMessage();
  }
  if (status === 429) {
    return "LinkedIn rate-limited this publish. Wait and retry once.";
  }
  return message || `LinkedIn publish failed (HTTP ${status})`;
}

function restliId(res: Response, data: Record<string, unknown>): string | null {
  const header =
    res.headers.get("x-restli-id") ||
    res.headers.get("X-RestLi-Id") ||
    res.headers.get("x-linkedin-id");
  if (header?.trim()) return header.trim();
  if (data.id != null) return String(data.id);
  return null;
}

function redactUploadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[upload-url]";
  }
}

function logLinkedIn(step: string, detail: Record<string, unknown>) {
  console.info(`[linkedin-posts] ${step}`, JSON.stringify(detail));
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { message: text.slice(0, 240) };
  }
}

export async function fetchLinkedInPersonUrn(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ urn: string | null; error: string | null; needsReauth?: boolean }> {
  const res = await fetchImpl(USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const data = await readJson(res);
  logLinkedIn("userinfo", { status: res.status, hasSub: Boolean(data.sub) });
  if (res.status === 401) {
    return {
      urn: null,
      error: linkedinErrorMessage(401, data),
      needsReauth: true,
    };
  }
  if (!res.ok) {
    return {
      urn: null,
      error: linkedinErrorMessage(res.status, data),
      needsReauth: res.status === 403,
    };
  }
  const urn = personUrnFromSub(String(data.sub || ""));
  if (!urn) {
    return {
      urn: null,
      error: "LinkedIn userinfo did not return a member id (sub).",
    };
  }
  return { urn, error: null };
}

async function initializeImageUpload(
  token: string,
  owner: string,
  fetchImpl: FetchLike,
): Promise<{ uploadUrl: string; imageUrn: string } | { error: string }> {
  const payload = { initializeUploadRequest: { owner } };
  logLinkedIn("images.initializeUpload.request", { owner });
  const res = await fetchImpl(IMAGES_INIT_URL, {
    method: "POST",
    headers: linkedinRestHeaders(token),
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  const value =
    data.value && typeof data.value === "object"
      ? (data.value as Record<string, unknown>)
      : data;
  const uploadUrl = String(value.uploadUrl || "").trim();
  const imageUrn = String(value.image || "").trim();
  logLinkedIn("images.initializeUpload.response", {
    status: res.status,
    uploadUrl: uploadUrl ? redactUploadUrl(uploadUrl) : null,
    image: imageUrn || null,
  });
  if (!res.ok || !uploadUrl || !imageUrn) {
    return { error: linkedinErrorMessage(res.status, data) };
  }
  return { uploadUrl, imageUrn };
}

async function uploadImageBytes(
  token: string,
  uploadUrl: string,
  image: LinkedInImage,
  fetchImpl: FetchLike,
): Promise<{ error: string | null }> {
  const mime = image.mime.toLowerCase().includes("gif")
    ? "image/gif"
    : image.mime.toLowerCase().includes("jpeg") ||
        image.mime.toLowerCase().includes("jpg")
      ? "image/jpeg"
      : "image/png";
  logLinkedIn("images.upload.request", {
    uploadUrl: redactUploadUrl(uploadUrl),
    bytes: image.bytes.length,
    contentType: mime,
  });
  const res = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mime,
    },
    body: new Uint8Array(image.bytes),
  });
  logLinkedIn("images.upload.response", { status: res.status });
  if (![200, 201, 204].includes(res.status)) {
    const data = await readJson(res);
    return { error: linkedinErrorMessage(res.status, data) };
  }
  return { error: null };
}

async function createLinkedInPost(
  token: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<LinkedInPublishResult> {
  logLinkedIn("posts.create.request", { author: body.author, hasMedia: Boolean(body.content) });
  const res = await fetchImpl(POSTS_URL, {
    method: "POST",
    headers: linkedinRestHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  const externalId = restliId(res, data);
  logLinkedIn("posts.create.response", {
    status: res.status,
    restliId: externalId,
  });
  if (res.status !== 201 && !res.ok) {
    return {
      externalId: null,
      error: linkedinErrorMessage(res.status, data),
      needsReauth: res.status === 401 || res.status === 403,
    };
  }
  return { externalId, error: null };
}

export async function publishLinkedInMemberPost(input: {
  token: string;
  text: string;
  image?: LinkedInImage | null;
  storedAuthorUrn?: string | null;
  scopes?: string | null;
  fetchImpl?: FetchLike;
}): Promise<LinkedInPublishResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const commentary = plainLinkedInCommentary(input.text);
  if (!commentary) {
    return { externalId: null, error: "Post copy is empty" };
  }
  const scopesOk = linkedinMemberScopesOk(input.scopes);
  if (scopesOk === false) {
    return {
      externalId: null,
      error: linkedinMissingScopeMessage(),
      needsReauth: true,
    };
  }

  let author = personUrnFromSub(input.storedAuthorUrn);
  if (!author) {
    const info = await fetchLinkedInPersonUrn(input.token, fetchImpl);
    if (info.error || !info.urn) {
      return {
        externalId: null,
        error: info.error || "Could not resolve LinkedIn member URN.",
        needsReauth: info.needsReauth,
      };
    }
    author = info.urn;
  }

  const image =
    input.image && isLinkedInImageMime(input.image.mime) ? input.image : null;

  if (image) {
    const init = await initializeImageUpload(input.token, author, fetchImpl);
    if ("error" in init) {
      return { externalId: null, error: init.error };
    }
    const uploaded = await uploadImageBytes(
      input.token,
      init.uploadUrl,
      image,
      fetchImpl,
    );
    if (uploaded.error) {
      return { externalId: null, error: uploaded.error };
    }
    const title = commentary.split("\n")[0]?.slice(0, 80) || "Post";
    return createLinkedInPost(
      input.token,
      linkedinImagePostBody(author, commentary, init.imageUrn, title),
      fetchImpl,
    );
  }

  return createLinkedInPost(
    input.token,
    linkedinTextPostBody(author, commentary),
    fetchImpl,
  );
}
