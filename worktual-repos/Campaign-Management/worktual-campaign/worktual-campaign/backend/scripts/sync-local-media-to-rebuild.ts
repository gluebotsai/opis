/**
 * Push local uploads/{uuid} bytes to the public media API (rebuild by default).
 * Requires INTERNAL_SERVICE_KEY accepted on the target API (see validateSessionOrInternalServiceKey).
 *
 *   npx tsx scripts/sync-local-media-to-rebuild.ts --id 41649a98-7e2f-451d-bc39-f55e26d29d5f
 */
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../src/config/env.js";
import { mediaPublicUploadOrigin } from "../src/helpers/media-public-url.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return "";
}

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  const id = arg("id");
  if (!ID_RE.test(id)) throw new Error("--id must be a media uuid");
  const key = env.social.internalServiceKey?.trim() || "";
  if (!key) throw new Error("INTERNAL_SERVICE_KEY is not set in backend/.env");

  const filePath = path.join(process.cwd(), "uploads", id);
  const buf = await fs.readFile(filePath);
  const b64 = buf.toString("base64");
  const sniff = buf[0] === 0xff ? "jpeg" : "png";
  const data_url = `data:image/${sniff};base64,${b64}`;

  const origin = mediaPublicUploadOrigin();
  const url = `${origin}/api/media/upload`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({ data_url }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload to ${url} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  console.log(text);
  const check = await fetch(`${origin}/api/media/${id}`);
  console.log(
    JSON.stringify({
      origin,
      mediaId: id,
      publicGetStatus: check.status,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
