/**
 * Publish uploads/{id} to rebuild using a Campaign SPA JWT (shared JWT_SECRET with prod).
 *
 *   npx tsx scripts/publish-local-media-jwt.ts --id 41649a98-7e2f-451d-bc39-f55e26d29d5f
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createSigner } from "fast-jwt";
import { env } from "../src/config/env.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery } from "../src/plugins/account-pool.js";
import { mediaPublicUploadOrigin } from "../src/helpers/media-public-url.js";
import { accountPool } from "../src/plugins/account-pool.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return "";
}

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function tokenForOrg(orgId: string): Promise<string> {
  const emailHint = arg("email").toLowerCase();
  let userId = arg("user");
  if (!userId && emailHint) {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT id::text AS id FROM accounts.setup_users
       WHERE organization_id::text = $1 AND lower(work_email) = $2 AND lower(status) = 'active'
       LIMIT 1`,
      [orgId, emailHint],
    );
    userId = rows[0]?.id?.trim() || "";
  }
  if (!userId) {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT id::text AS id FROM accounts.setup_users
       WHERE organization_id::text = $1 AND lower(status) = 'active'
       ORDER BY id ASC LIMIT 1`,
      [orgId],
    );
    userId = rows[0]?.id?.trim() || "";
  }
  if (!userId) throw new Error(`No active user for org ${orgId}`);
  const session = await getSessionUserById(userId);
  if (!session) throw new Error(`Session user ${userId} not found`);
  const sign = createSigner({
    key: env.jwtSecret,
    expiresIn: 60 * 60 * 1000,
  });
  return sign({
    sub: session.id,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    branchId: session.branchId,
    mode: session.mode,
    industry: session.industry,
  });
}

async function main() {
  const id = arg("id");
  if (!ID_RE.test(id)) throw new Error("--id must be a media uuid");
  const org = arg("org") || "1000";
  const filePath = path.join(process.cwd(), "uploads", id);
  const buf = await fs.readFile(filePath);
  const b64 = buf.toString("base64");
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
  const data_url = `data:${mime};base64,${b64}`;

  const origin = mediaPublicUploadOrigin();
  const token = await tokenForOrg(org);
  const url = `${origin}/api/media/upload`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data_url }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as {
    data?: { url?: string; media_id?: string };
    url?: string;
    media_id?: string;
  };
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const mediaId = String(data.media_id || "").trim();
  const publicUrl = String(data.url || "").trim();
  const abs =
    publicUrl.startsWith("http") ? publicUrl : `${origin}${publicUrl.startsWith("/") ? publicUrl : `/api/media/${mediaId}`}`;
  const check = await fetch(abs);
  console.log(
    JSON.stringify(
      {
        sourceLocalId: id,
        uploadOrigin: origin,
        media_id: mediaId,
        publicUrl: abs,
        publicGetStatus: check.status,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await accountPool.end().catch(() => undefined);
  });
