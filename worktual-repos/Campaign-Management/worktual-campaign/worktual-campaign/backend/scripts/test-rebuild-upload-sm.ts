import fs from "node:fs";
import { createSigner } from "fast-jwt";
import { env } from "../src/config/env.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery, accountPool } from "../src/plugins/account-pool.js";

async function main() {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id FROM accounts.setup_users WHERE organization_id::text = $1 AND lower(status)=$2 ORDER BY id LIMIT 1`,
    ["1000", "active"],
  );
  const session = await getSessionUserById(rows[0]!.id);
  const sign = createSigner({ key: env.jwtSecret, expiresIn: 3600000 });
  const token = sign({
    sub: session!.id,
    email: session!.email,
    role: session!.role,
    organizationId: session!.organizationId,
    branchId: session!.branchId,
    mode: session!.mode,
    industry: session!.industry,
  });
  const buf = fs.readFileSync("/tmp/hero-sm.jpg");
  const data_url = `data:image/jpeg;base64,${buf.toString("base64")}`;
  console.log("payload chars", data_url.length);
  const res = await fetch("https://rebuild-campaign-api.worktual.com/api/media/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data_url }),
  });
  console.log("status", res.status, (await res.text()).slice(0, 500));
}

main()
  .finally(() => accountPool.end().catch(() => undefined))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
