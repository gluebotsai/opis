/**
 * Saved campaign templates (Phase 1 — localStorage).
 * Split by primaryChannel; channel popups show approved only.
 */

import type { CampaignChannelId } from "@/lib/campaign-channels";
import { channelLabel } from "@/lib/campaign-channels";

export type TemplateApprovalStatus = "draft" | "approved";

export type CampaignTemplate = {
  id: string;
  name: string;
  description: string;
  goal: string;
  /** Channel this template belongs to (filter key for popups) */
  primaryChannel: CampaignChannelId;
  /** DLT Template ID / WhatsApp template name when regulated */
  externalTemplateId: string;
  channels: string[];
  audience: string;
  flowSteps: string[];
  starterMessage: string;
  approvalStatus: TemplateApprovalStatus;
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "worktual.campaignTemplates.v2";

type Seed = Omit<CampaignTemplate, "id" | "createdAt" | "updatedAt">;

const SEED_TEMPLATES: Seed[] = [
  {
    name: "Welcome nurture",
    description: "Email welcome + form handoff",
    goal: "Lead generation",
    primaryChannel: "email",
    externalTemplateId: "",
    channels: ["Email"],
    audience: "New leads (last 30 days)",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Form submit → CRM lead handoff",
    ],
    starterMessage:
      "Started from Welcome nurture (Email). Tell me what to change.",
    approvalStatus: "approved",
    bodyPreview: "Hi {{name}}, welcome — here’s how to get started…",
  },
  {
    name: "Webinar invite",
    description: "Email invite sequence",
    goal: "Webinar registrations",
    primaryChannel: "email",
    externalTemplateId: "",
    channels: ["Email"],
    audience: "Engaged contacts",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Webinar registration / attend",
    ],
    starterMessage: "Started from Webinar invite (Email).",
    approvalStatus: "approved",
    bodyPreview: "You’re invited to our webinar on {{date}}…",
  },
  {
    name: "Cart recovery WA",
    description: "WhatsApp cart nudge",
    goal: "Sales / conversions",
    primaryChannel: "whatsapp",
    externalTemplateId: "cart_recovery_en",
    channels: ["WhatsApp"],
    audience: "Cart abandoners (segment)",
    flowSteps: [
      "Audience enters campaign",
      "First touch: WhatsApp",
      "Offer redeem / purchase",
    ],
    starterMessage: "Started from approved WhatsApp template cart_recovery_en.",
    approvalStatus: "approved",
    bodyPreview: "Hi {{1}}, you left items in your cart. Complete order?",
  },
  {
    name: "OTP login",
    description: "Transactional SMS OTP",
    goal: "Transactional",
    primaryChannel: "sms",
    externalTemplateId: "OTP_LOGIN_01",
    channels: ["SMS"],
    audience: "Active users",
    flowSteps: ["Send OTP SMS", "Verify"],
    starterMessage: "Started from DLT-approved SMS OTP_LOGIN_01.",
    approvalStatus: "approved",
    bodyPreview: "Your OTP is {{1}}. Valid for 10 mins. - Brand",
  },
  {
    name: "Promo flash sale",
    description: "Promotional SMS",
    goal: "Sales / conversions",
    primaryChannel: "sms",
    externalTemplateId: "PROMO_SALE_12",
    channels: ["SMS"],
    audience: "Opted-in promo segment",
    flowSteps: ["Audience scrub", "Send promo SMS"],
    starterMessage: "Started from DLT-approved SMS PROMO_SALE_12.",
    approvalStatus: "approved",
    bodyPreview: "Flash sale! Get {{1}}% off till {{2}}. Shop now.",
  },
  {
    name: "Browser deal alert",
    description: "Web push promo",
    goal: "Engagement",
    primaryChannel: "web_push",
    externalTemplateId: "",
    channels: ["Web Push"],
    audience: "Subscribed browsers",
    flowSteps: ["Audience enters", "Web push"],
    starterMessage: "Started from Web Push deal alert.",
    approvalStatus: "approved",
    bodyPreview: "Limited deal — tap to view",
  },
  {
    name: "App restock",
    description: "App push restock notice",
    goal: "Engagement",
    primaryChannel: "app_push",
    externalTemplateId: "",
    channels: ["App Push"],
    audience: "App users with wishlist",
    flowSteps: ["Audience enters", "App push"],
    starterMessage: "Started from App Push restock template.",
    approvalStatus: "approved",
    bodyPreview: "{{item}} is back in stock",
  },
];

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function seedIfEmpty(): CampaignTemplate[] {
  const now = new Date().toISOString();
  return SEED_TEMPLATES.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
}

function readAll(): CampaignTemplate[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seedIfEmpty();
      writeAll(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as CampaignTemplate[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = seedIfEmpty();
      writeAll(seeded);
      return seeded;
    }
    return parsed;
  } catch {
    return [];
  }
}

function writeAll(templates: CampaignTemplate[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function listCampaignTemplates(): CampaignTemplate[] {
  return readAll().sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function listApprovedTemplatesForChannel(
  channelId: CampaignChannelId,
): CampaignTemplate[] {
  return listCampaignTemplates().filter(
    (t) =>
      t.primaryChannel === channelId && t.approvalStatus === "approved",
  );
}

export function getCampaignTemplate(id: string): CampaignTemplate | null {
  return readAll().find((t) => t.id === id) ?? null;
}

export function upsertCampaignTemplate(template: CampaignTemplate): void {
  const all = readAll();
  const i = all.findIndex((t) => t.id === template.id);
  if (i >= 0) all[i] = template;
  else all.unshift(template);
  writeAll(all);
}

export function deleteCampaignTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}

export function createCampaignTemplate(
  partial?: Partial<CampaignTemplate>,
): CampaignTemplate {
  const now = new Date().toISOString();
  const primaryChannel: CampaignChannelId =
    partial?.primaryChannel ?? "email";
  const label = channelLabel(primaryChannel);
  return {
    id: crypto.randomUUID(),
    name: "Untitled template",
    description: "",
    goal: "Engagement",
    primaryChannel,
    externalTemplateId: "",
    channels: [label],
    audience: "All contacts",
    flowSteps: [`Audience enters campaign`, `First touch: ${label}`],
    starterMessage: `Started from your ${label} template. Tell me what to change.`,
    approvalStatus: "approved",
    bodyPreview: "",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
