import type {
  TemplateEditMessage,
  TemplateFields,
} from "@/services/agents.socket";

export type EditChatRow = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "template";
  text?: string;
  fields?: TemplateFields;
  html?: string;
  imageUrl?: string;
  imageFilename?: string;
  imageUrls?: { url: string; filename?: string }[];
};

/** Map persisted edit-space messages (including the seq-0 template seed). */
export function toEditChatRows(
  messages: TemplateEditMessage[],
  fallbackHtml?: string,
): EditChatRow[] {
  const rows: EditChatRow[] = [];
  for (const msg of messages) {
    const role = msg.role === "user" ? "user" : "assistant";
    if (msg.kind === "template") {
      const fields = (msg.payload?.fields || {}) as TemplateFields;
      rows.push({
        id: msg.id || `tpl-${msg.seq}`,
        role,
        kind: "template",
        fields,
        html: Object.keys(fields).length === 0 ? fallbackHtml : undefined,
      });
      continue;
    }
    const text = String(msg.payload?.text || "").trim();
    const imageUrl = String(msg.payload?.image_url || "").trim();
    const imageFilename = String(msg.payload?.image_filename || "").trim();
    const rawUrls = msg.payload?.image_urls;
    const imageUrls: { url: string; filename?: string }[] = [];
    if (Array.isArray(rawUrls)) {
      for (const row of rawUrls) {
        if (!row || typeof row !== "object") continue;
        const url = String(row.url ?? "").trim();
        if (!url) continue;
        const fn = String(row.filename ?? "").trim();
        imageUrls.push(fn ? { url, filename: fn } : { url });
      }
    }
    const hasImages = Boolean(imageUrl) || imageUrls.length > 0;
    if (!text && !hasImages) continue;
    if (text && /template is generated successfully/i.test(text)) continue;
    const primaryUrl = imageUrl || imageUrls[0]?.url || "";
    const primaryFn = imageFilename || imageUrls[0]?.filename || "";
    rows.push({
      id:
        msg.id ||
        `txt-${msg.seq}-${(text || primaryFn || primaryUrl).slice(0, 12)}`,
      role,
      kind: "text",
      text,
      ...(primaryUrl
        ? {
            imageUrl: primaryUrl,
            ...(primaryFn ? { imageFilename: primaryFn } : {}),
            ...(imageUrls.length ? { imageUrls } : {}),
          }
        : {}),
    });
  }
  return rows;
}

/** If DB has no seq-0 template row, still show the stored card in edit chat. */
export function ensureTemplateSeedRow(
  rows: EditChatRow[],
  card: {
    template_id: string;
    fields?: TemplateFields;
    preview?: string;
  },
): EditChatRow[] {
  if (rows.some((r) => r.kind === "template")) return rows;
  return [
    {
      id: `${card.template_id}-seed`,
      role: "assistant",
      kind: "template",
      fields: (card.fields || {}) as TemplateFields,
      html: card.preview,
    },
    ...rows,
  ];
}

/**
 * Left-pane history is **text turns only**.
 * The seq-0 `kind: "template"` seed stays in stored messages / DB for merge,
 * but must never render in Template chat — Live template (right panel) is the
 * only preview. Do not put ChannelTemplatePreview back in the chat column.
 */
export function visibleEditChatRows(rows: EditChatRow[]): EditChatRow[] {
  return rows.filter((r) => r.kind === "text");
}
