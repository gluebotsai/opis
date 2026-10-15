import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { resolveWhatsAppChannelConfigId } from "../../dao/whatsapp-channel-config.js";
import { socialUploadWhatsAppMedia } from "../../services/social-whatsapp.js";
import { requireSession } from "../../middlewares/authendication.js";
import { forwardUploadViaDirectOrigin } from "../../helpers/media-remote-publish.js";
import {
  isLoopbackOrLanHost,
  mediaAllowLocalPublish,
  mediaPublicUploadOrigin,
  publicMediaOrigin,
  publicizeMediaUrl,
  resolveLocalMediaAbsoluteUrl,
} from "../../helpers/media-public-url.js";
import { env } from "../../config/env.js";

const MAX_BYTES = 3 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uploadBody = z.object({
  data_url: z.string().min(20).max(5_500_000),
});

const whatsappUploadBody = z
  .object({
    image_url: z.string().url().max(4096).optional(),
    data_url: z.string().min(20).max(5_500_000).optional(),
  })
  .refine((body) => Boolean(body.image_url || body.data_url), {
    message: "image_url or data_url is required",
  });

function uploadsDir() {
  return path.join(process.cwd(), "uploads");
}

function requestHost(request: FastifyRequest): string {
  const xf = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    ?.trim();
  const host = xf || String(request.headers.host || "").trim();
  return host.split(":")[0]?.toLowerCase() || "";
}

/** Host header only — nginx may set X-Forwarded-Host to the SPA while API serves media. */
function directRequestHost(request: FastifyRequest): string {
  const host = String(request.headers.host || "").trim();
  return host.split(":")[0]?.toLowerCase() || "";
}

function publicMediaHostname(): string {
  try {
    return new URL(publicMediaOrigin()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True when this process is the public media API (avoid false forward + 503). */
function isOnPublicMediaOrigin(request: FastifyRequest): boolean {
  const publicHost = publicMediaHostname();
  if (!publicHost) return false;
  const req = requestHost(request);
  const direct = directRequestHost(request);
  if (req === publicHost || direct === publicHost) return true;
  try {
    const uploadHost = new URL(mediaPublicUploadOrigin()).hostname.toLowerCase();
    if (uploadHost && (req === uploadHost || direct === uploadHost)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Dev LAN: store on this API when API_PUBLIC_URL matches request host. */
function allowsLocalMediaStore(request: FastifyRequest): boolean {
  if (!mediaAllowLocalPublish()) return false;
  if (isOnPublicMediaOrigin(request)) return true;
  const req = requestHost(request);
  const direct = directRequestHost(request);
  if (isLoopbackOrLanHost(req) || isLoopbackOrLanHost(direct)) return true;
  const raw = String(env.apiPublicUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!raw) return false;
  try {
    const cfgHost = new URL(
      raw.endsWith("/api") ? raw.slice(0, -4) : raw,
    ).hostname.toLowerCase();
    if (!cfgHost) return false;
    return req === cfgHost || direct === cfgHost;
  } catch {
    return false;
  }
}

function hasValidInternalServiceKey(request: FastifyRequest): boolean {
  const expected = env.social.internalServiceKey?.trim() || "";
  if (!expected) return false;
  const provided = String(
    request.headers["x-internal-service-key"] || "",
  ).trim();
  return provided === expected;
}

/**
 * When local API differs from rebuild public host, upload bytes there so
 * launched email / remote clients can fetch `/api/media/{id}`.
 */
async function forwardUploadToPublic(
  dataUrl: string,
  authHeader: string | undefined,
  request: FastifyRequest,
): Promise<{ url: string; media_id: string } | null> {
  const origin = mediaPublicUploadOrigin();
  const publicHost = (() => {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  // Already on the public media API (Host may match when X-Forwarded-Host is the SPA).
  if (!publicHost || isOnPublicMediaOrigin(request)) return null;
  const reqHost = requestHost(request);
  if (reqHost === publicHost) return null;

  const uploadUrl = `${origin}/api/media/upload`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers.Authorization = authHeader;
  const internalKey = env.social.internalServiceKey?.trim() || "";
  if (internalKey) headers["X-Internal-Service-Key"] = internalKey;
  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ data_url: dataUrl }),
    });
    if (!res.ok) {
      request.log.warn(
        { status: res.status, uploadUrl },
        "forwardUploadToPublic failed",
      );
      const direct = await forwardUploadViaDirectOrigin(
        dataUrl,
        authHeader,
        String(request.userSession?.organizationId || "").trim() || undefined,
      );
      if (direct?.url) return direct;
      return null;
    }
    const body = (await res.json()) as {
      data?: { url?: string; media_id?: string };
      url?: string;
      media_id?: string;
    };
    const data = body.data && typeof body.data === "object" ? body.data : body;
    const rawUrl = String(data.url || "").trim();
    const mediaId = String(data.media_id || "").trim();
    if (!rawUrl) return null;
    const abs = rawUrl.startsWith("http")
      ? rawUrl
      : `${origin}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
    return { url: abs, media_id: mediaId || abs.split("/").pop() || "" };
  } catch (err) {
    request.log.warn({ err, uploadUrl }, "forwardUploadToPublic network error");
    const direct = await forwardUploadViaDirectOrigin(
      dataUrl,
      authHeader,
      String(request.userSession?.organizationId || "").trim() || undefined,
    );
    if (direct?.url) return direct;
    return null;
  }
}

function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function parseDataUrl(raw: string): Buffer {
  const trimmed = raw.trim();
  const match = trimmed.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/s);
  const b64 = match ? match[1] : trimmed.replace(/^data:[^;]+;base64,/, "");
  try {
    return Buffer.from(b64.replace(/\s/g, ""), "base64");
  } catch {
    throw new AppError("Could not read image data");
  }
}

export async function uploadMediaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = uploadBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError("data_url (image) is required");
  }
  const buf = parseDataUrl(body.data.data_url);
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    throw new AppError("Image must be under 3 MB");
  }
  if (!sniffImage(buf)) {
    throw new AppError(
      "File is not a JPEG, PNG, GIF, or WebP image (extension is optional)",
    );
  }

  const authHeader = request.headers.authorization
    ? String(request.headers.authorization)
    : undefined;
  const onPublic = isOnPublicMediaOrigin(request);
  const trustedInternal = hasValidInternalServiceKey(request);
  const localStore = allowsLocalMediaStore(request);
  let forwarded = onPublic
    ? null
    : await forwardUploadToPublic(body.data.data_url, authHeader, request);
  if (!forwarded?.url && !onPublic && env.media.publicDirectOrigin) {
    forwarded = await forwardUploadViaDirectOrigin(
      body.data.data_url,
      authHeader,
      String(request.userSession?.organizationId || "").trim() || undefined,
    );
  }

  /** Mirror bytes under the public media id so LAN chat previews (/api/media via Vite) work. */
  async function mirrorLocal(mediaId: string): Promise<void> {
    if (!ID_RE.test(mediaId)) return;
    try {
      const dir = uploadsDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, mediaId), buf);
    } catch {
      /* best-effort — rebuild URL still returned for email/agents */
    }
  }

  function mediaIdFromForwarded(
    url: string,
    mediaId: string | undefined,
  ): string {
    const direct = String(mediaId || "").trim();
    if (ID_RE.test(direct)) return direct;
    try {
      const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
      return ID_RE.test(last) ? last : "";
    } catch {
      return "";
    }
  }

  if (forwarded?.url) {
    const mediaId = mediaIdFromForwarded(forwarded.url, forwarded.media_id);
    if (mediaId) await mirrorLocal(mediaId);
    return sendSuccess(reply, RESPONSE.mediaUploaded, {
      url: publicizeMediaUrl(forwarded.url),
      media_id: mediaId || forwarded.media_id,
    });
  }

  const publicHost = publicMediaHostname();
  if (publicHost && !onPublic && !trustedInternal && !localStore) {
    throw new AppError(
      "The image could not be published for email (public media host did not accept the upload). Try again — inbox clients cannot load images from this machine.",
      503,
    );
  }

  const id = crypto.randomUUID();
  await mirrorLocal(id);
  const rel = `/api/media/${id}`;
  return sendSuccess(reply, RESPONSE.mediaUploaded, {
    url: resolveLocalMediaAbsoluteUrl(request, rel),
    media_id: id,
  });
}

export async function getMediaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const mediaId = String(
    (request.params as { mediaId?: string }).mediaId || "",
  ).trim();
  if (!ID_RE.test(mediaId)) {
    throw new AppError(RESPONSE.mediaNotFound, 404);
  }
  const filePath = path.join(uploadsDir(), mediaId);
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    throw new AppError(RESPONSE.mediaNotFound, 404);
  }
  const ctype = sniffImage(buf) || "application/octet-stream";
  reply.header("Cache-Control", "public, max-age=31536000, immutable");
  return reply.type(ctype).send(buf);
}

async function imageBufferFromBody(body: {
  image_url?: string;
  data_url?: string;
}): Promise<{ buf: Buffer; mime: string }> {
  let buf: Buffer;
  if (body.data_url) {
    buf = parseDataUrl(body.data_url);
  } else if (body.image_url) {
    let res: Response;
    try {
      res = await fetch(body.image_url);
    } catch (err) {
      throw new AppError(
        `Could not fetch image URL: ${
          err instanceof Error ? err.message : "network error"
        }`,
      );
    }
    if (!res.ok) {
      throw new AppError(`Could not fetch image URL (HTTP ${res.status})`);
    }
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    throw new AppError("image_url or data_url is required");
  }
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    throw new AppError("Image must be under 3 MB");
  }
  const mime = sniffImage(buf) || "image/png";
  if (!sniffImage(buf)) {
    throw new AppError(
      "File is not a JPEG, PNG, GIF, or WebP image (extension is optional)",
    );
  }
  return { buf, mime };
}

/** Upload template image to Meta for WhatsApp IMAGE headers (returns media handle). */
export async function uploadWhatsAppMetaMediaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = whatsappUploadBody.parse(request.body ?? {});
  const { buf, mime } = await imageBufferFromBody(body);
  const channelConfigId = await resolveWhatsAppChannelConfigId(
    session.organizationId,
  );
  const uploaded = await socialUploadWhatsAppMedia({
    channelConfigId,
    mimeType: mime,
    dataBase64: buf.toString("base64"),
  });
  return sendSuccess(reply, RESPONSE.success_message, {
    handle: uploaded.handle,
  });
}
