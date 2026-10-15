/**
 * Org-level LinkedIn / Facebook / Instagram publish.
 * Meta: accounts.setup_channel_configs + setup_social_configs (CRM product).
 * LinkedIn: onboarding / setup_app_connections fallback.
 */

import {
  getSocialAppConnection,
  type SocialPublishPlatform,
} from "@/dao/account/setup-app-connections";
import type { Prisma } from "@prisma/client";
import {
  getSeoSocialPost,
  upsertSeoSocialPost,
  type SeoSocialPostRow,
} from "@/dao/seo/seo-store";
import {
  copyImageBytes,
  signSocialImageUrl,
} from "@/service/seo/social-image-public";
import {
  publishLinkedInMemberPost,
  storedLinkedInPersonUrn,
} from "@/service/seo/linkedin-posts";

const CONNECT_MSG =
  "Connect LinkedIn, Facebook, or Instagram for this organization in MyAccounts / Accounts, then retry Publish.";

function persistFields(post: SeoSocialPostRow) {
  return {
    organizationId: post.organizationId,
    id: post.id,
    userId: post.userId,
    contentId: post.contentId,
    platform: post.platform,
    postType: post.postType,
    copy: post.copy as Prisma.InputJsonValue,
    status: post.status,
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    externalPostId: post.externalPostId,
    lastError: post.lastError,
    accountsConnectionId: post.accountsConnectionId,
  };
}

function copyText(copy: unknown): string {
  if (!copy || typeof copy !== "object") return "";
  const rec = copy as Record<string, unknown>;
  return String(
    rec.caption || rec.text || rec.body || rec.message || "",
  ).trim();
}

function metaPageId(conn: {
  externalAccountId: string | null;
  metadata: Record<string, unknown> | null;
}): string | null {
  const meta = conn.metadata || {};
  const id =
    meta.pageId ||
    meta.page_id ||
    meta.facebookPageId ||
    conn.externalAccountId;
  return id ? String(id) : null;
}

function igUserId(conn: {
  externalAccountId: string | null;
  metadata: Record<string, unknown> | null;
}): string | null {
  const meta = conn.metadata || {};
  const id =
    meta.igUserId ||
    meta.instagram_user_id ||
    meta.instagramUserId ||
    conn.externalAccountId;
  return id ? String(id) : null;
}

async function publishFacebook(
  token: string,
  pageId: string,
  text: string,
  image?: { bytes: Buffer; mime: string } | null,
): Promise<{ externalId: string | null; error: string | null }> {
  if (image) {
    const form = new FormData();
    form.set("message", text);
    form.set("access_token", token);
    form.set(
      "source",
      new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
      image.mime.includes("png") ? "post.png" : "post.jpg",
    );
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/photos`,
      { method: "POST", body: form },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error) {
      const err = data.error as Record<string, unknown> | undefined;
      return {
        externalId: null,
        error:
          typeof err?.message === "string"
            ? String(err.message)
            : `Facebook photo publish failed (HTTP ${res.status})`,
      };
    }
    return {
      externalId: data.id != null ? String(data.id) : null,
      error: null,
    };
  }
  const url = new URL(`https://graph.facebook.com/v21.0/${pageId}/feed`);
  url.searchParams.set("message", text);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) {
    const err = data.error as Record<string, unknown> | undefined;
    return {
      externalId: null,
      error:
        typeof err?.message === "string"
          ? String(err.message)
          : `Facebook publish failed (HTTP ${res.status})`,
    };
  }
  return {
    externalId: data.id != null ? String(data.id) : null,
    error: null,
  };
}

async function waitIgContainer(
  token: string,
  creationId: string,
): Promise<string | null> {
  for (let i = 0; i < 8; i += 1) {
    const url = new URL(`https://graph.facebook.com/v21.0/${creationId}`);
    url.searchParams.set("fields", "status_code");
    url.searchParams.set("access_token", token);
    const res = await fetch(url);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(data.status_code || "").toUpperCase();
    if (status === "FINISHED") return null;
    if (status === "ERROR") {
      return typeof data.status === "string"
        ? data.status
        : "Instagram media container failed.";
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function publishInstagram(
  token: string,
  igId: string,
  text: string,
  imageUrl: string | null,
): Promise<{ externalId: string | null; error: string | null }> {
  if (!imageUrl) {
    return {
      externalId: null,
      error:
        "Instagram feed posts need a public image. Generate Posts with a Gemini image, and publish from an HTTPS API host (ngrok/QA) so Instagram can fetch it.",
    };
  }
  const createUrl = new URL(`https://graph.facebook.com/v21.0/${igId}/media`);
  createUrl.searchParams.set("image_url", imageUrl);
  createUrl.searchParams.set("caption", text);
  createUrl.searchParams.set("access_token", token);
  const create = await fetch(createUrl, { method: "POST" });
  const created = (await create.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!create.ok || created.error) {
    const err = created.error as Record<string, unknown> | undefined;
    return {
      externalId: null,
      error:
        typeof err?.message === "string"
          ? String(err.message)
          : `Instagram media create failed (HTTP ${create.status})`,
    };
  }
  const creationId = created.id != null ? String(created.id) : "";
  if (!creationId) {
    return { externalId: null, error: "Instagram media container missing id." };
  }
  const waitErr = await waitIgContainer(token, creationId);
  if (waitErr) return { externalId: null, error: waitErr };
  const publishUrl = new URL(
    `https://graph.facebook.com/v21.0/${igId}/media_publish`,
  );
  publishUrl.searchParams.set("creation_id", creationId);
  publishUrl.searchParams.set("access_token", token);
  const pub = await fetch(publishUrl, { method: "POST" });
  const published = (await pub.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!pub.ok || published.error) {
    const err = published.error as Record<string, unknown> | undefined;
    return {
      externalId: null,
      error:
        typeof err?.message === "string"
          ? String(err.message)
          : `Instagram publish failed (HTTP ${pub.status})`,
    };
  }
  return {
    externalId: published.id != null ? String(published.id) : creationId,
    error: null,
  };
}

export async function publishSeoSocialPost(input: {
  organizationId: string;
  postId: string;
}): Promise<{
  ok: boolean;
  post: SeoSocialPostRow | null;
  error: string | null;
  code?: "NOT_CONNECTED" | "NEEDS_REAUTH" | "PUBLISH_FAILED" | "NOT_FOUND";
}> {
  const post = await getSeoSocialPost(input.organizationId, input.postId);
  if (!post) {
    return { ok: false, post: null, error: "Post not found", code: "NOT_FOUND" };
  }
  const platform = post.platform as SocialPublishPlatform;
  if (!["linkedin", "facebook", "instagram"].includes(platform)) {
    return {
      ok: false,
      post,
      error: "Unsupported platform",
      code: "PUBLISH_FAILED",
    };
  }
  const conn =
    (await getSocialAppConnection(input.organizationId, platform)) ||
    (platform === "instagram"
      ? await getSocialAppConnection(input.organizationId, "facebook")
      : null);
  if (!conn || !conn.accessToken) {
    const updated = await upsertSeoSocialPost({
      ...persistFields(post),
      status: "needs_reauth",
      lastError: CONNECT_MSG,
      accountsConnectionId: conn?.id ?? null,
    });
    return {
      ok: false,
      post: updated,
      error: CONNECT_MSG,
      code: "NOT_CONNECTED",
    };
  }
  const text = copyText(post.copy);
  if (!text) {
    return {
      ok: false,
      post,
      error: "Post copy is empty",
      code: "PUBLISH_FAILED",
    };
  }

  const image = copyImageBytes(post.copy);
  let result: { externalId: string | null; error: string | null; needsReauth?: boolean };
  if (platform === "linkedin") {
    result = await publishLinkedInMemberPost({
      token: conn.accessToken,
      text,
      image,
      storedAuthorUrn: storedLinkedInPersonUrn(conn),
      scopes: conn.scopes,
    });
  } else if (platform === "facebook") {
    const pageId = metaPageId(conn);
    if (!pageId) {
      result = {
        externalId: null,
        error: "Facebook Page id is missing on the Accounts connection.",
      };
    } else {
      result = await publishFacebook(conn.accessToken, pageId, text, image);
    }
  } else {
    const igId = igUserId(conn);
    if (!igId) {
      result = {
        externalId: null,
        error: "Instagram user id is missing on the Accounts connection.",
      };
    } else {
      if (!copyImageBytes(post.copy)) {
        result = {
          externalId: null,
          error:
            "This Instagram post has no image. Click Generate Posts again so Gemini can attach one.",
        };
      } else {
        const imageUrl = signSocialImageUrl(post.id);
        result = await publishInstagram(
          conn.accessToken,
          igId,
          text,
          imageUrl,
        );
      }
    }
  }

  if (result.error) {
    const needsReauth =
      result.needsReauth ||
      /reauth|expired|oauth|invalid.?token/i.test(result.error);
    const updated = await upsertSeoSocialPost({
      ...persistFields(post),
      status: needsReauth ? "needs_reauth" : "failed",
      lastError: result.error,
      accountsConnectionId: conn.id,
    });
    return {
      ok: false,
      post: updated,
      error: result.error,
      code: needsReauth ? "NEEDS_REAUTH" : "PUBLISH_FAILED",
    };
  }

  const updated = await upsertSeoSocialPost({
    ...persistFields(post),
    status: "published",
    publishedAt: new Date(),
    externalPostId: result.externalId,
    lastError: null,
    accountsConnectionId: conn.id,
  });
  return { ok: true, post: updated, error: null };
}
