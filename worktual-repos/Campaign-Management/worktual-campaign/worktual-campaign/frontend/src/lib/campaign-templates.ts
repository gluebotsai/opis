/**
 * Marketing campaign templates — org-scoped DB library (API) with in-memory cache.
 */

import type { CampaignChannelId } from "@/lib/campaign-channels";
import { channelLabel } from "@/lib/campaign-channels";
import {
  bumpLibraryTemplateUsedApi,
  createLibraryTemplateApi,
  deleteLibraryTemplateApi,
  fetchLibraryTemplates,
  type LibraryTemplateDto,
  updateLibraryTemplateApi,
} from "@/services/libraryTemplates.api";

export type TemplateApprovalStatus = "draft" | "approved";

export type TemplatePreviewKind =
  | "email_hero"
  | "email_text"
  | "wa_media"
  | "wa_text"
  | "app_visual"
  | "app_text"
  | "web_visual"
  | "web_text"
  | "sms";

export type TemplatePreviewMeta = {
  kind: TemplatePreviewKind;
  visualKey: string;
  eyebrow?: string;
  headline: string;
  body: string;
  cta?: string;
  subject?: string;
  iconKey?: string;
  greeting?: string;
  bullets?: string[];
  closing?: string;
  brandName?: string;
  footer?: string;
  ctaHighlight?: string;
};

export type CampaignTemplate = {
  id: string;
  name: string;
  description: string;
  /** Style / tone / layout guidance from DB */
  styleNotes?: string;
  goal: string;
  primaryChannel: CampaignChannelId;
  externalTemplateId: string;
  channels: string[];
  audience: string;
  flowSteps: string[];
  starterMessage: string;
  approvalStatus: TemplateApprovalStatus;
  bodyPreview: string;
  /** Full content body from DB */
  contentBody?: string;
  usedCount: number;
  previewImage?: string | null;
  preview?: TemplatePreviewMeta | null;
  /** Structured agent fields — gallery + launch-ready previews */
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  source?: "system" | "user" | string;
  createdAt: string;
  updatedAt: string;
};

const CHANNELS: CampaignChannelId[] = [
  "email",
  "sms",
  "whatsapp",
  "web_push",
  "app_push",
  "ppc",
];

function asChannel(raw: string): CampaignChannelId {
  return (CHANNELS.includes(raw as CampaignChannelId)
    ? raw
    : "email") as CampaignChannelId;
}

function dtoToTemplate(row: LibraryTemplateDto): CampaignTemplate {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description || "",
    styleNotes: row.styleNotes || "",
    goal: row.goal || "Engagement",
    primaryChannel: asChannel(row.primaryChannel),
    externalTemplateId: row.externalTemplateId || "",
    channels: Array.isArray(row.channels) ? row.channels.map(String) : [],
    audience: row.audience || "All contacts",
    flowSteps: Array.isArray(row.flowSteps) ? row.flowSteps.map(String) : [],
    starterMessage: row.starterMessage || "",
    approvalStatus: row.approvalStatus === "draft" ? "draft" : "approved",
    bodyPreview: row.bodyPreview || "",
    contentBody: row.contentBody || "",
    usedCount: typeof row.usedCount === "number" ? row.usedCount : 0,
    previewImage: row.previewImage ?? null,
    preview: (row.preview as TemplatePreviewMeta | null) ?? null,
    fields:
      row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
        ? row.fields
        : null,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Gallery rows + user uploads only — never static catalog seeds. */
function isVisibleLibraryTemplate(row: CampaignTemplate): boolean {
  if (row.source === "system") return false;
  const meta = row.metadata || {};
  if (meta.uploaded === true || row.source === "user") return true;
  if (row.source === "generated") {
    return Boolean(String(meta.campaignIdeaKey || "").trim());
  }
  return Boolean(String(meta.campaignIdeaKey || "").trim());
}

let cache: CampaignTemplate[] = [];
let loadPromise: Promise<CampaignTemplate[]> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeCampaignTemplates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCampaignTemplatesSnapshot(): CampaignTemplate[] {
  return cache;
}

function setCache(rows: CampaignTemplate[]) {
  cache = rows
    .filter(isVisibleLibraryTemplate)
    .map(normalize)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  notify();
}

function normalize(row: CampaignTemplate): CampaignTemplate {
  return {
    ...row,
    usedCount: typeof row.usedCount === "number" ? row.usedCount : 0,
    previewImage: row.previewImage ?? null,
    preview: row.preview ?? null,
    fields: row.fields ?? null,
    bodyPreview: row.bodyPreview || row.description || "Sample marketing copy",
    styleNotes: row.styleNotes || "",
    contentBody: row.contentBody || "",
    metadata: row.metadata || {},
  };
}

/** Load (or refresh) templates for the logged-in org from the API. */
export async function loadCampaignTemplates(options?: {
  force?: boolean;
}): Promise<CampaignTemplate[]> {
  if (loadPromise && !options?.force) return loadPromise;
  loadPromise = (async () => {
    try {
      const rows = await fetchLibraryTemplates();
      setCache(rows.map(dtoToTemplate));
      return cache;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Sync read of last loaded cache (empty until loadCampaignTemplates). */
export function listCampaignTemplates(): CampaignTemplate[] {
  return cache;
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
  return cache.find((t) => t.id === id) ?? null;
}

export function upsertCampaignTemplate(template: CampaignTemplate): void {
  const next = [...cache];
  const i = next.findIndex((t) => t.id === template.id);
  if (i >= 0) next[i] = normalize(template);
  else next.unshift(normalize(template));
  setCache(next);
}

export async function deleteCampaignTemplate(id: string): Promise<void> {
  await deleteLibraryTemplateApi(id);
  setCache(cache.filter((t) => t.id !== id));
}

export function createCampaignTemplate(
  partial?: Partial<CampaignTemplate>,
): CampaignTemplate {
  const now = new Date().toISOString();
  const primaryChannel: CampaignChannelId =
    partial?.primaryChannel ?? "email";
  const label = channelLabel(primaryChannel);
  return {
    id: `local-${crypto.randomUUID()}`,
    name: "Untitled template",
    description: "",
    styleNotes: "",
    goal: "Engagement",
    primaryChannel,
    externalTemplateId: "",
    channels: [label],
    audience: "All contacts",
    flowSteps: [`Audience enters campaign`, `First touch: ${label}`],
    starterMessage: `Started from your ${label} template. Tell me what to change.`,
    approvalStatus: "approved",
    bodyPreview: "Sample marketing copy for this channel.",
    contentBody: "",
    usedCount: 0,
    previewImage: null,
    preview: null,
    metadata: {},
    source: "user",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Persist a new user template (upload / create) to the org library. */
export async function saveCampaignTemplate(
  partial: Partial<CampaignTemplate> & {
    name: string;
    primaryChannel: CampaignChannelId;
  },
): Promise<CampaignTemplate> {
  const label = channelLabel(partial.primaryChannel);
  const created = await createLibraryTemplateApi({
    name: partial.name,
    description: partial.description,
    styleNotes: partial.styleNotes,
    goal: partial.goal,
    primaryChannel: partial.primaryChannel,
    channels: partial.channels?.length ? partial.channels : [label],
    audience: partial.audience,
    flowSteps: partial.flowSteps,
    starterMessage: partial.starterMessage,
    approvalStatus: partial.approvalStatus,
    bodyPreview: partial.bodyPreview,
    contentBody: partial.contentBody || partial.bodyPreview,
    previewImage: partial.previewImage ?? null,
    preview: (partial.preview as Record<string, unknown> | null) ?? null,
    metadata: partial.metadata,
    externalTemplateId: partial.externalTemplateId,
  });
  const row = dtoToTemplate(created);
  upsertCampaignTemplate(row);
  return row;
}

export async function persistCampaignTemplateUpdate(
  id: string,
  patch: Partial<CampaignTemplate>,
): Promise<CampaignTemplate> {
  const updated = await updateLibraryTemplateApi(id, {
    name: patch.name,
    description: patch.description,
    styleNotes: patch.styleNotes,
    goal: patch.goal,
    primaryChannel: patch.primaryChannel,
    channels: patch.channels,
    audience: patch.audience,
    flowSteps: patch.flowSteps,
    starterMessage: patch.starterMessage,
    approvalStatus: patch.approvalStatus,
    bodyPreview: patch.bodyPreview,
    contentBody: patch.contentBody,
    previewImage: patch.previewImage,
    preview: (patch.preview as Record<string, unknown> | null) ?? undefined,
    metadata: patch.metadata,
    externalTemplateId: patch.externalTemplateId,
  });
  const row = dtoToTemplate(updated);
  upsertCampaignTemplate(row);
  return row;
}

export async function bumpTemplateUsedCount(id: string): Promise<void> {
  try {
    const updated = await bumpLibraryTemplateUsedApi(id);
    if (updated) upsertCampaignTemplate(dtoToTemplate(updated));
  } catch {
  const row = getCampaignTemplate(id);
  if (!row) return;
  upsertCampaignTemplate({
    ...row,
    usedCount: (row.usedCount || 0) + 1,
    updatedAt: new Date().toISOString(),
  });
  }
}

/** @deprecated Seeds live in DB; kept for callers that previously wiped localStorage. */
export function resetCampaignTemplatesToSeed(): CampaignTemplate[] {
  void loadCampaignTemplates();
  return cache;
}

/** Channels shown in System view (no SMS / App Push / WhatsApp). */
export const SYSTEM_VIEW_CHANNELS: CampaignChannelId[] = [
  "email",
  "web_push",
];

/** Channel order for Phone view catalog sections. */
export const PHONE_VIEW_CHANNELS: CampaignChannelId[] = [
  "email",
  "web_push",
  "app_push",
  "whatsapp",
];
