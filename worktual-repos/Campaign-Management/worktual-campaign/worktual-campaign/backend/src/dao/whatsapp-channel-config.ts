/**
 * Resolve WhatsApp channelConfigId (accounts.setup_channel_configs bigint id as string).
 * Prefer the org's Accounts WhatsApp/social row; fall back to WHATSAPP_CHANNEL_CONFIG_ID.
 * Never expose the id to the frontend.
 */

import { env } from "../config/env.js";
import { accountQuery } from "../plugins/account-pool.js";
import { accountOrgParam } from "../helpers/account-ids.js";
import { AppError } from "../helpers/response-builders.js";

type ConfigRow = {
  id: string;
  channel_type: string;
  status: string;
  name: string;
};

/** CCaaS rows are often channel_type `social` with a WhatsApp name (e.g. Booxoo-whatsapp). */
const WHATSAPP_CONFIG_SQL = `
  SELECT id, channel_type, status, name
  FROM accounts.setup_channel_configs
  WHERE organization_id::text = $1::text
    AND (
      lower(channel_type) IN ('whatsapp', 'meta_whatsapp')
      OR (
        lower(channel_type) = 'social'
        AND lower(coalesce(name, '')) LIKE '%whatsapp%'
      )
    )
  ORDER BY
    CASE WHEN lower(status) = 'active' THEN 0
         WHEN lower(status) = 'pending' THEN 1
         ELSE 2 END,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST`;

export async function resolveWhatsAppChannelConfigId(
  organizationId: string,
): Promise<string> {
  const { rows } = await accountQuery<ConfigRow>(WHATSAPP_CONFIG_SQL, [
    accountOrgParam(organizationId),
  ]);

  if (rows.length) {
    const active = rows.find((r) => String(r.status).toLowerCase() === "active");
    return (active || rows[0]).id;
  }

  const staticId = env.social.whatsappChannelConfigId?.trim();
  if (staticId) {
    return staticId;
  }

  throw new AppError(
    "WhatsApp is not configured for this organization. Connect WhatsApp in My Account (Channel Setup), or set WHATSAPP_CHANNEL_CONFIG_ID on the Campaign backend.",
    400,
    "WHATSAPP_NOT_CONFIGURED",
  );
}
