import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Mail,
  MessageCircle,
  Megaphone,
  Smartphone,
  TabletSmartphone,
} from "lucide-react";

export type CampaignChannelId =
  | "email"
  | "whatsapp"
  | "sms"
  | "web_push"
  | "app_push"
  | "ppc";

export type CampaignChannel = {
  id: CampaignChannelId;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Needs DLT / Meta-style external approval before send */
  regulated: boolean;
};

/** Parked in UI for now — keep code; do not offer in create / config / library. */
export const PARKED_CHANNEL_IDS = new Set<CampaignChannelId>(["sms", "ppc"]);

/** My Accounts owns channel setup — hide Campaign Configuration UI until re-enabled. */
export const CONFIGURATION_UI_HIDDEN = true;

export function isConfigurationUiHidden(): boolean {
  return CONFIGURATION_UI_HIDDEN;
}

export function isChannelParked(id: string): boolean {
  const n = id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (n === "sms" || n === "ppc" || n === "ads") return true;
  return PARKED_CHANNEL_IDS.has(n as CampaignChannelId);
}

/** Configuration grid: hide SMS/PPC + Instagram / Meta (other). Keep WhatsApp. */
export function isConfigChannelHidden(id: string): boolean {
  const n = id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (isChannelParked(n)) return true;
  if (n === "meta_instagram" || n === "instagram") return true;
  if (n === "meta_other" || n === "social") return true;
  if (n === "meta" && n !== "meta_whatsapp") return true;
  if (n === "email_phase2") return true;
  return false;
}

export const CAMPAIGN_CHANNELS: CampaignChannel[] = [
  {
    id: "email",
    label: "Email",
    hint: "Templates & past",
    icon: Mail,
    regulated: false,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "Approved only",
    icon: MessageCircle,
    regulated: true,
  },
  {
    id: "sms",
    label: "SMS",
    hint: "DLT approved",
    icon: Smartphone,
    regulated: true,
  },
  {
    id: "web_push",
    label: "Web Push",
    hint: "Browser alerts",
    icon: Bell,
    regulated: false,
  },
  {
    id: "app_push",
    label: "App Push",
    hint: "Mobile alerts",
    icon: TabletSmartphone,
    regulated: false,
  },
  {
    id: "ppc",
    label: "PPC",
    hint: "Meta / Google plan",
    icon: Megaphone,
    regulated: false,
  },
];

export const VISIBLE_CAMPAIGN_CHANNELS: CampaignChannel[] =
  CAMPAIGN_CHANNELS.filter((c) => !PARKED_CHANNEL_IDS.has(c.id));

export function getCampaignChannel(
  id: CampaignChannelId,
): CampaignChannel | undefined {
  return CAMPAIGN_CHANNELS.find((c) => c.id === id);
}

export function channelLabel(id: CampaignChannelId): string {
  return getCampaignChannel(id)?.label ?? id;
}

/** Agent / send API channel keys. */
export type AgentChannelId =
  | "email"
  | "sms"
  | "whatsapp"
  | "push"
  | "web"
  | "ppc";

const AGENT_CHANNEL_SET = new Set<string>([
  "email",
  "sms",
  "whatsapp",
  "push",
  "web",
  "ppc",
]);

/** Config API id → create-campaign UI chip id. */
export function configChannelToUiId(
  configChannel: string,
): CampaignChannelId | null {
  const c = configChannel.trim().toLowerCase();
  if (c === "email") return "email";
  if (c === "sms") return "sms";
  if (c === "meta_whatsapp" || c === "whatsapp") return "whatsapp";
  if (c === "web_push" || c === "web") return "web_push";
  if (c === "app_push" || c === "push") return "app_push";
  if (c === "ppc" || c === "ads") return "ppc";
  return null;
}

/** UI / labels / config → agent channel key (email, push, web, …). */
export function toAgentChannelId(raw: string): AgentChannelId | null {
  const n = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const map: Record<string, AgentChannelId> = {
    email: "email",
    mail: "email",
    sms: "sms",
    whatsapp: "whatsapp",
    wa: "whatsapp",
    meta_whatsapp: "whatsapp",
    push: "push",
    app_push: "push",
    app_push_notification: "push",
    mobile_push: "push",
    web: "web",
    web_push: "web",
    browser_push: "web",
    ppc: "ppc",
    ads: "ppc",
  };
  const hit = map[n];
  if (hit) return hit;
  if (AGENT_CHANNEL_SET.has(n)) return n as AgentChannelId;
  return null;
}

export function normalizeChannelsToAgentIds(raw: string[]): AgentChannelId[] {
  const out: AgentChannelId[] = [];
  for (const item of raw) {
    const id = toAgentChannelId(item);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Agent key → overview chip id. */
export function agentChannelToUiId(
  agentId: string,
): CampaignChannelId | null {
  const a = toAgentChannelId(agentId);
  if (!a) return null;
  if (a === "push") return "app_push";
  if (a === "web") return "web_push";
  if (a === "email" || a === "sms" || a === "whatsapp" || a === "ppc") {
    return a;
  }
  return null;
}
