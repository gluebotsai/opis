/**
 * Publish media to the public rebuild API when HTTPS/nginx forward fails (LAN dev).
 * Uses direct server IP + Host header so bytes land on prod uploads/.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { resolveGalleryAuthToken } from "./gallery-auth-token.js";
import { mediaPublicUploadOrigin, publicizeMediaUrl } from "./media-public-url.js";

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localUploadsDir(): string {
  return path.join(process.cwd(), "uploads");
}

function publicHostHeader(): string {
  const fromEnv = String(env.media.publicHostHeader || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return new URL(mediaPublicUploadOrigin()).hostname;
  } catch {
    return "rebuild-campaign-api.worktual.com";
  }
}

function parseForwardResponse(text: string): { url: string; media_id: string } | null {
  let parsed: {
    data?: { url?: string; media_id?: string };
    url?: string;
    media_id?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return null;
  }
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const mediaId = String(data.media_id || "").trim();
  const rawUrl = String(data.url || "").trim();
  if (!mediaId && !rawUrl) return null;
  const origin = mediaPublicUploadOrigin();
  const abs = rawUrl.startsWith("http")
    ? rawUrl
    : `${origin}${rawUrl.startsWith("/") ? rawUrl : `/api/media/${mediaId}`}`;
  return {
    url: publicizeMediaUrl(abs),
    media_id: mediaId || abs.split("/").filter(Boolean).pop() || "",
  };
}

/** POST JSON to prod backend bypassing edge nginx (large body / 502). */
export async function forwardUploadViaDirectOrigin(
  dataUrl: string,
  authHeader: string | undefined,
  organizationId?: string,
): Promise<{ url: string; media_id: string } | null> {
  const direct = String(env.media.publicDirectOrigin || "").trim().replace(/\/$/, "");
  if (!direct) return null;

  let hostHeader = publicHostHeader();
  let hostname = "127.0.0.1";
  let port = 3001;
  try {
    const u = new URL(direct);
    hostname = u.hostname;
    port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }

  let authorization = authHeader ? String(authHeader) : "";
  if (!authorization && organizationId) {
    const token = await resolveGalleryAuthToken(organizationId);
    if (token) authorization = `Bearer ${token}`;
  }
  if (!authorization) {
    const key = env.social.internalServiceKey?.trim() || "";
    if (!key) return null;
  }

  const body = JSON.stringify({ data_url: dataUrl });
  const headers: Record<string, string> = {
    Host: hostHeader,
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  };
  if (authorization) headers.Authorization = authorization;
  else {
    const key = env.social.internalServiceKey?.trim() || "";
    if (key) headers["X-Internal-Service-Key"] = key;
  }

  return new Promise((resolve) => {
    const req = http.request(
      { hostname, port, path: "/api/media/upload", method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) >= 400) {
            resolve(null);
            return;
          }
          resolve(parseForwardResponse(text));
        });
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(120_000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

export async function localMediaFileExists(mediaId: string): Promise<boolean> {
  if (!ID_RE.test(mediaId)) return false;
  try {
    await fs.access(path.join(localUploadsDir(), mediaId));
    return true;
  } catch {
    return false;
  }
}

async function readLocalAsDataUrl(mediaId: string): Promise<string | null> {
  if (!(await localMediaFileExists(mediaId))) return null;
  const buf = await fs.readFile(path.join(localUploadsDir(), mediaId));
  if (buf.length === 0) return null;
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Last-resort at send: push local bytes to rebuild and return public URL. */
export async function publishLocalMediaIdToPublicRemote(
  mediaId: string,
  organizationId: string,
): Promise<string | null> {
  const dataUrl = await readLocalAsDataUrl(mediaId);
  if (!dataUrl) return null;
  const forwarded = await forwardUploadViaDirectOrigin(
    dataUrl,
    undefined,
    organizationId,
  );
  if (!forwarded?.url) return null;
  try {
    const check = await fetch(forwarded.url, {
      method: "GET",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/*,*/*" },
    });
    if (!check.ok) return null;
  } catch {
    return null;
  }
  return forwarded.url;
}
