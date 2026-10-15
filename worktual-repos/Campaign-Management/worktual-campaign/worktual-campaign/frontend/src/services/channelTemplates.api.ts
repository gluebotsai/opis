import { api, apiGet } from "@/services/api";
import type {
  TemplateCard,
  TemplateEditMessage,
} from "@/services/agents.socket";

type ApiEnvelope<T> = {
  statusCode?: number;
  message?: string;
} & T;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHANNEL_URL_RE = /^(email|whatsapp|web|push|sms|app)$/i;

export function isTemplateUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}

/** Legacy /templates/email URLs — numeric campaign template ids are NOT channels. */
export function isChannelUrlKey(value: string | undefined | null): boolean {
  return Boolean(value && CHANNEL_URL_RE.test(String(value).trim()));
}

export async function patchChannelTemplateFields(
  templateId: string,
  fields: Record<string, unknown>,
) {
  const { data } = await api.patch<
    ApiEnvelope<{ template: TemplateCard }>
  >(`/channel-templates/${templateId}/fields`, { fields });
  return data.template;
}

export async function fetchChannelTemplate(templateId: string) {
  const { data } = await apiGet<
    ApiEnvelope<{ template: TemplateCard; messages: TemplateEditMessage[] }>
  >(`/channel-templates/${templateId}`);
  return {
    template: data.template,
    messages: data.messages || [],
  };
}

export async function fetchSessionChannelTemplates(sessionId: string) {
  try {
    const { data } = await apiGet<ApiEnvelope<{ templates: TemplateCard[] }>>(
      `/channel-templates/session/${sessionId}`,
    );
    return data.templates || [];
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return [];
    throw err;
  }
}

export async function syncSessionChannelTemplates(
  sessionId: string,
  templates: TemplateCard[],
) {
  const payload = templates
    .filter((t) => t.channel && t.template_id)
    .map((t) => ({
      template_id: t.template_id,
      channel: t.channel,
      logo: t.logo,
      launch_at: t.launch_at,
      how_it_works: t.how_it_works,
      fields: t.fields || {},
      preview: t.preview,
      generation_batch_id: t.generation_batch_id,
    }));
  if (!payload.length) return [] as TemplateCard[];
  const { data } = await api.post<
    ApiEnvelope<{ templates: TemplateCard[]; created_count?: number }>
  >(`/channel-templates/session/${sessionId}/sync`, {
    templates: payload,
  });
  return data.templates || [];
}

export function syntheticEditMessages(card: TemplateCard): TemplateEditMessage[] {
  const fields = card.fields || {};
  return [
    {
      id: `${card.template_id}-0`,
      template_id: card.template_id,
      role: "assistant",
      seq: 0,
      kind: "template",
      payload: { fields },
    },
  ];
}
