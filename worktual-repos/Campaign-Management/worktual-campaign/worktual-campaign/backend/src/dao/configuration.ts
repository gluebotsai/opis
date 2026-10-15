// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { accountQuery } from "../plugins/account-pool.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { accountOrgParam } from "../helpers/account-ids.js";
import { AppError } from "../helpers/response-builders.js";
import {
  CONFIG_CHANNELS,
  HIDDEN_CONFIG_CHANNEL_IDS,
  type ConfigChannelId,
} from "../helpers/config-channels.js";

export type ChannelConfigRow = {
  id: string;
  organization_id: string;
  channel_type: string;
  name: string;
  status: string;
  product_ids: unknown;
  created_at: string | null;
  updated_at: string | null;
};

/** Map Worktual channel_type → our Config UI channel ids. */
function mapChannelType(channelType: string): ConfigChannelId | null {
  const t = channelType.trim().toLowerCase();
  if (t === "email") return "email";
  if (t === "sms") return "sms";
  if (t === "web_chat" || t === "web" || t === "web_push") return "web_push";
  if (t === "app_push" || t === "push") return "app_push";
  if (t === "whatsapp" || t === "meta_whatsapp") return "meta_whatsapp";
  if (t === "instagram" || t === "meta_instagram") return "meta_instagram";
  if (t === "social" || t === "meta" || t === "meta_other") return "meta_other";
  if (t === "ppc" || t === "ads") return "ppc";
  return null;
}

function statusFromRows(
  rows: ChannelConfigRow[],
): "not_started" | "in_progress" | "ready" | "blocked" {
  if (!rows.length) return "not_started";
  if (
    rows.some((r) => {
      const s = String(r.status).toLowerCase();
      return (
        s === "active" ||
        s === "ready" ||
        s === "connected" ||
        s === "verified" ||
        s === "configured" ||
        s === "enabled"
      );
    })
  ) {
    return "ready";
  }
  if (rows.some((r) => String(r.status).toLowerCase() === "pending")) {
    return "in_progress";
  }
  return "blocked";
}

/**
 * Read-only channel overview from accounts.setup_channel_configs.
 * Never writes to accounts tables.
 */
export async function listChannelProfilesDao(session: CampaignSessionUser) {
  const { rows } = await accountQuery<ChannelConfigRow>(
    `SELECT id, organization_id, channel_type, name, status, product_ids,
            created_at::text, updated_at::text
     FROM accounts.setup_channel_configs
     WHERE organization_id::text = $1::text
     ORDER BY channel_type, name`,
    [accountOrgParam(session.organizationId)],
  );

  const byUi = new Map<string, ChannelConfigRow[]>();
  for (const row of rows) {
    const ui = mapChannelType(row.channel_type);
    if (!ui) continue;
    const list = byUi.get(ui) || [];
    list.push(row);
    byUi.set(ui, list);
  }

  return CONFIG_CHANNELS.filter(
    (ch) => !HIDDEN_CONFIG_CHANNEL_IDS.has(ch.id),
  ).map((ch) => {
    const matched = byUi.get(ch.id) || [];
    return {
      channel: ch.id,
      label: ch.label,
      group: ch.group,
      status: statusFromRows(matched),
      implemented: true,
      read_only: true,
      source: "accounts.setup_channel_configs",
      configs: matched.map((r) => ({
        id: r.id,
        channel_type: r.channel_type,
        name: r.name,
        status: r.status,
        updated_at: r.updated_at,
      })),
      updated_at: matched[0]?.updated_at ?? null,
    };
  });
}

export async function getChannelConfigDetailDao(
  session: CampaignSessionUser,
  channel: string,
) {
  const known = CONFIG_CHANNELS.find((c) => c.id === channel);
  if (!known) throw new AppError("Unknown configuration channel.", 404);

  const all = await listChannelProfilesDao(session);
  const row = all.find((c) => c.channel === channel);
  return {
    channel: known.id,
    label: known.label,
    group: known.group,
    read_only: true,
    message:
      "Channel configuration is managed in Accounts setup. Campaign shows status only.",
    ...(row || {
      status: "not_started",
      configs: [],
    }),
  };
}

export function assertKnownChannel(channel: string): ConfigChannelId {
  const found = CONFIG_CHANNELS.find((c) => c.id === channel);
  if (!found) throw new AppError("Unknown configuration channel.", 404);
  return found.id;
}
