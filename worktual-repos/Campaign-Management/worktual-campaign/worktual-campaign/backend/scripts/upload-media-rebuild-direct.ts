/**
 * Upload to production backend disk via server IP + Host header (bypasses nginx 502 on large JSON).
 * Bytes land in rebuild server's uploads/ and are served at https://rebuild-campaign-api.worktual.com/api/media/{id}
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSigner } from "fast-jwt";
import { env } from "../src/config/env.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery, accountPool } from "../src/plugins/account-pool.js";

const execFileAsync = promisify(execFile);
const PUBLIC_HOST = "rebuild-campaign-api.worktual.com";
const DIRECT_ORIGIN = "http://82.113.92.49:3001";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return "";
}

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function maybeCompress(filePath: string): Promise<{ buf: Buffer; mime: string }> {
  let buf = await fs.readFile(filePath);
  if (buf.length <= 450_000) {
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
    return { buf, mime };
  }
  if (process.platform === "darwin") {
    const tmpIn = `/tmp/media-in-${Date.now()}.png`;
    const tmpOut = `/tmp/media-out-${Date.now()}.jpg`;
    await fs.writeFile(tmpIn, buf);
    await execFileAsync("sips", ["-Z", "1200", tmpIn, "--out", tmpOut, "-s", "format", "jpeg"]);
    buf = await fs.readFile(tmpOut);
    await fs.unlink(tmpIn).catch(() => undefined);
    await fs.unlink(tmpOut).catch(() => undefined);
    return { buf, mime: "image/jpeg" };
  }
  return { buf, mime: "image/png" };
}

async function bearer(): Promise<string> {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id FROM accounts.setup_users
     WHERE organization_id::text = $1 AND lower(work_email) = $2 AND lower(status) = 'active' LIMIT 1`,
    ["1000", "yaswanthmg1@gmail.com"],
  );
  const userId = rows[0]?.id;
  if (!userId) throw new Error("User not found");
  const session = await getSessionUserById(userId);
  if (!session) throw new Error("Session not found");
  const sign = createSigner({ key: env.jwtSecret, expiresIn: 60 * 60 * 1000 });
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
  const localId = arg("id");
  if (!ID_RE.test(localId)) throw new Error("--id required (local uploads uuid)");
  const filePath = path.join(process.cwd(), "uploads", localId);
  const { buf, mime } = await maybeCompress(filePath);
  const data_url = `data:${mime};base64,${buf.toString("base64")}`;
  const token = await bearer();
  const body = JSON.stringify({ data_url });
  const text = await new Promise<string>((resolve, reject) => {
    import("node:http").then(({ request }) => {
      const req = request(
        {
          hostname: "82.113.92.49",
          port: 3001,
          path: "/api/media/upload",
          method: "POST",
          headers: {
            Host: PUBLIC_HOST,
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            const out = Buffer.concat(chunks).toString("utf8");
            if ((res.statusCode || 0) >= 400) {
              reject(new Error(`Upload ${res.statusCode}: ${out.slice(0, 400)}`));
              return;
            }
            resolve(out);
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  });
  const parsed = JSON.parse(text) as {
    data?: { url?: string; media_id?: string };
    media_id?: string;
    url?: string;
  };
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const mediaId = String(data.media_id || "").trim();
  const publicUrl = `https://${PUBLIC_HOST}/api/media/${mediaId}`;
  const check = await fetch(publicUrl);
  console.log(JSON.stringify({ localId, mediaId, publicUrl, publicGetStatus: check.status }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => accountPool.end().catch(() => undefined));
