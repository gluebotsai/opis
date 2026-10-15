import type { LucideIcon } from "lucide-react";
import { Bell, Mail, MessageCircle, Smartphone, TabletSmartphone } from "lucide-react";

export type CampaignChannelId =
  | "email"
  | "whatsapp"
  | "sms"
  | "web_push"
  | "app_push";

export type CampaignChannel = {
  id: CampaignChannelId;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Needs DLT / Meta-style external approval before send */
  regulated: boolean;
};

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
];

export function getCampaignChannel(
  id: CampaignChannelId,
): CampaignChannel | undefined {
  return CAMPAIGN_CHANNELS.find((c) => c.id === id);
}

export function channelLabel(id: CampaignChannelId): string {
  return getCampaignChannel(id)?.label ?? id;
}
