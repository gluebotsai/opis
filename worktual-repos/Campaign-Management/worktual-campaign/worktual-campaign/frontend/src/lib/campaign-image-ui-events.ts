/** Shared handling for agent `ui_event` image payloads (create chat + template edit). */

import { isHttpImageUrl } from "@/lib/template-fields-merge";
import { absolutizeMediaUrl } from "@/services/media.api";

export type ImageUiEventEnvelope = {
  type?: string;
  session_id?: string;
  template_id?: string;
  chat_context?: string;
  payload?: Record<string, unknown> | unknown[];
};

export function unwrapImageUiPayload(
  payload: ImageUiEventEnvelope | Record<string, unknown>,
): Record<string, unknown> {
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  if (nested && !Array.isArray(nested) && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }
  return root;
}

export function channelsFromImageUiRaw(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.channels)) {
    return raw.channels.map((ch) => String(ch).toLowerCase()).filter(Boolean);
  }
  const one = String(raw.channel || "").trim().toLowerCase();
  return one ? [one] : [];
}

export function heroImageFieldsPatch(
  channel: string,
  imageUrl: string,
): Record<string, unknown> {
  const url = absolutizeMediaUrl(String(imageUrl || "").trim());
  if (!isHttpImageUrl(url)) return {};
  const ch = channel.toLowerCase();
  if (ch === "whatsapp") {
    return {
      header_media_url: url,
      header_format: "IMAGE",
      image_url: url,
    };
  }
  return { header_image: url, image_url: url };
}

export type TimelineTemplateCard = {
  template_id?: string;
  channel?: string;
  fields?: Record<string, unknown>;
};

/** Apply a hero URL to one template id only — never fan out by channel. */
export function applyImageToTimelineCards(
  cards: TimelineTemplateCard[],
  imageUrl: string,
  channels: string[],
  applyFields: (templateId: string, fields: Record<string, unknown>) => void,
  templateId?: string,
): void {
  const tid = String(templateId || "").trim();
  if (!imageUrl || !tid) return;
  const card = cards.find((c) => String(c.template_id || "").trim() === tid);
  const ch = String(card?.channel || channels[0] || "email")
    .trim()
    .toLowerCase();
  applyFields(tid, {
    ...(card?.fields || {}),
    ...heroImageFieldsPatch(ch, imageUrl),
  });
}

export type HandleTemplateImageAttachedOptions = {
  raw: Record<string, unknown>;
  fallbackChannel?: string;
  applyFields: (templateId: string, fields: Record<string, unknown>) => void;
  fetchTemplateFields?: (
    templateId: string,
  ) => Promise<Record<string, unknown> | null | undefined>;
};

/** template_image_attached — prefer inline fields; else fetch or patch hero URL. */
export function handleTemplateImageAttachedEvent(
  opts: HandleTemplateImageAttachedOptions,
): void {
  const tid = String(opts.raw.template_id || "").trim();
  const channel = String(
    opts.raw.channel || opts.fallbackChannel || "",
  ).trim();
  const inlineFields = opts.raw.fields;
  const imageUrl = String(opts.raw.image_url || "").trim();
  const apply = opts.applyFields;

  if (!tid) return;

  if (inlineFields && typeof inlineFields === "object") {
    apply(tid, inlineFields as Record<string, unknown>);
    return;
  }

  const patchFromUrl = () => {
    if (!imageUrl) return;
    apply(tid, heroImageFieldsPatch(channel || "email", imageUrl));
  };

  if (!opts.fetchTemplateFields) {
    patchFromUrl();
    return;
  }

  void opts
    .fetchTemplateFields(tid)
    .then((fields) => {
      if (fields && typeof fields === "object") {
        apply(tid, fields);
      } else {
        patchFromUrl();
      }
    })
    .catch(() => patchFromUrl());
}

export function applyTemplateFieldsFromImageUiEvent(
  type: string | undefined,
  envelope: ImageUiEventEnvelope,
  ctx: {
    fallbackChannel?: string;
    timelineCards?: TimelineTemplateCard[];
    applyTemplateFields: (templateId: string, fields: Record<string, unknown>) => void;
    fetchTemplateFields?: (
      templateId: string,
    ) => Promise<Record<string, unknown> | null | undefined>;
    /** When set, ignore events for other template ids (template edit page). */
    restrictTemplateId?: string;
    /** Fallback template id when the event omits template_id (template edit). */
    defaultTemplateId?: string;
  },
): boolean {
  const raw = unwrapImageUiPayload(envelope);
  const tid = String(
    raw.template_id || envelope.template_id || ctx.defaultTemplateId || "",
  ).trim();
  if (ctx.restrictTemplateId && tid && tid !== ctx.restrictTemplateId) {
    return false;
  }

  if (type === "template_fields_updated") {
    if (!tid || !raw.fields || typeof raw.fields !== "object") return false;
    ctx.applyTemplateFields(tid, raw.fields as Record<string, unknown>);
    return true;
  }

  if (type === "template_image_attached") {
    handleTemplateImageAttachedEvent({
      raw: {
        ...raw,
        template_id: tid || raw.template_id,
      },
      fallbackChannel: ctx.fallbackChannel,
      applyFields: ctx.applyTemplateFields,
      fetchTemplateFields: ctx.fetchTemplateFields,
    });
    return Boolean(tid);
  }

  if (type === "image_generated" || type === "image_refined") {
    const imageUrl = String(raw.image_url || "").trim();
    if (!imageUrl || !tid) return false;
    if (ctx.restrictTemplateId && tid !== ctx.restrictTemplateId) {
      return false;
    }
    let channels = channelsFromImageUiRaw(raw);
    if (!channels.length && ctx.fallbackChannel) {
      channels = [ctx.fallbackChannel.toLowerCase()];
    }
    const ch = channels[0] || ctx.fallbackChannel || "email";
    ctx.applyTemplateFields(tid, heroImageFieldsPatch(ch, imageUrl));
    return true;
  }

  return false;
}
