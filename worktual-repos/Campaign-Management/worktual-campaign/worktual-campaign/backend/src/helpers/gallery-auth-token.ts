/** Short-lived JWT for gallery worker media uploads (requires authenticated session). */

import { createSigner } from "fast-jwt";
import { env } from "../config/env.js";
import { getSessionUserById } from "../dao/auth.js";
import { accountQuery } from "../plugins/account-pool.js";

const signGalleryToken = createSigner({
  key: env.jwtSecret,
  expiresIn: 60 * 60 * 1000,
});

export async function resolveGalleryAuthToken(
  organizationId: string,
): Promise<string> {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id
     FROM accounts.setup_users
     WHERE organization_id::text = $1
       AND lower(status) = 'active'
     ORDER BY id ASC
     LIMIT 1`,
    [organizationId],
  );
  const userId = rows[0]?.id?.trim();
  if (!userId) return "";

  const session = await getSessionUserById(userId);
  if (!session) return "";

  return signGalleryToken({
    sub: session.id,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    branchId: session.branchId,
    mode: session.mode,
    industry: session.industry,
  });
}
