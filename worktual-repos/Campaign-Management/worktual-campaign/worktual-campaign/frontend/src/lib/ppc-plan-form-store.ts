/**
 * Local drafts of manually filled PPC plan forms (Meta / Google).
 */

import type {
  PpcKeyword,
  PpcNetwork,
  PpcTemplatePlan,
} from "@/lib/ppc-templates-store";
import { packStorageKey } from "@/lib/industry-packs";

const STORAGE_KEY_BASE = "worktual.ppc.planFormDrafts.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

export type PpcPlanFormDraft = {
  id: string;
  name: string;
  network: PpcNetwork;
  plan: PpcTemplatePlan;
  createdAt: string;
  updatedAt: string;
};

function readAll(): PpcPlanFormDraft[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PpcPlanFormDraft[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PpcPlanFormDraft[]) {
  localStorage.setItem(storageKey(), JSON.stringify(rows));
}

export function listPpcPlanFormDrafts(network?: PpcNetwork): PpcPlanFormDraft[] {
  const rows = readAll().sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  if (!network) return rows;
  return rows.filter((r) => r.network === network);
}

export function savePpcPlanFormDraft(input: {
  id?: string;
  name: string;
  network: PpcNetwork;
  plan: PpcTemplatePlan;
}): PpcPlanFormDraft {
  const now = new Date().toISOString();
  const rows = readAll();
  const id = input.id || crypto.randomUUID();
  const existing = rows.find((r) => r.id === id);
  const row: PpcPlanFormDraft = {
    id,
    name: input.name.trim() || `Untitled ${input.network} plan`,
    network: input.network,
    plan: { ...input.plan, network: input.network },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = [row, ...rows.filter((r) => r.id !== id)];
  writeAll(next);
  return row;
}

export function deletePpcPlanFormDraft(id: string) {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function getPpcPlanFormDraft(id: string): PpcPlanFormDraft | undefined {
  return readAll().find((r) => r.id === id);
}

/** Build a compact summary for seeding AI chat from a filled form. */
export function summarizePpcPlanForChat(plan: PpcTemplatePlan): string {
  const lines: string[] = [
    `Create a PPC plan for ${plan.network === "google" ? "Google" : "Meta"} only.`,
    "Do not ask for email, SMS, WhatsApp, or other channels — keep channels = ppc only.",
    "Skip CRM contact filtering; use the targeting fields below for the ad audience.",
  ];
  if (plan.objective) lines.push(`Objective: ${plan.objective}`);
  if (plan.campaign_type) lines.push(`Campaign type: ${plan.campaign_type}`);
  if (plan.creative_format) lines.push(`Creative format: ${plan.creative_format}`);
  if (plan.placements?.length) {
    lines.push(`Placements: ${plan.placements.join(", ")}`);
  }
  if (plan.headlines?.length) {
    lines.push(`Headlines: ${plan.headlines.join(" | ")}`);
  }
  if (plan.primary_text) lines.push(`Primary text: ${plan.primary_text}`);
  if (plan.descriptions) lines.push(`Descriptions: ${plan.descriptions}`);
  if (plan.cta) lines.push(`CTA: ${plan.cta}`);
  if (plan.landing_url) lines.push(`Landing URL: ${plan.landing_url}`);
  if (plan.daily_budget) {
    lines.push(`Daily budget: ${plan.currency || "INR"} ${plan.daily_budget}`);
  }
  if (plan.geo?.length) lines.push(`Geo: ${plan.geo.join(", ")}`);
  if (plan.audience_notes) lines.push(`Audience notes: ${plan.audience_notes}`);
  if (plan.keywords?.length) {
    const kw = plan.keywords
      .map((k: PpcKeyword) =>
        k.match ? `${k.text} (${k.match})` : k.text,
      )
      .join(", ");
    lines.push(`Keywords: ${kw}`);
  }
  if (plan.media?.type || plan.media?.url) {
    lines.push(
      `Media: ${plan.media.type || "asset"}${plan.media.url ? ` ${plan.media.url}` : ""} (placeholder)`,
    );
  }
  lines.push('When ready, confirm and CREATE_TEMPLATES for ppc only.');
  return lines.join("\n");
}
