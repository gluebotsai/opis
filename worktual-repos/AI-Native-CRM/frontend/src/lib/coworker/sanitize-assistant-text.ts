import { htmlToPlainText, isHtmlEmailBody } from "@/lib/email-body";
import {
  isCoworkerChatHtml,
  normalizeCoworkerChatHtml,
  unwrapMarkdownEmphasis,
} from "@/lib/coworker/assistant-message-html";

/** Shown in chat when the LLM is down or a coworker turn fails. */
export const COWORKER_LLM_ERROR_SPEECH = "something went wrong";

/** Strip raw CRM / DB ids from coworker speech shown to users. */

const CRM_ID_RE =
  /\b(?:cm[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|wt-[a-z0-9-]{6,})\b/gi;
const ID_PAREN_RE = /\s*[\(\[]\s*(?:id|ID)\s*[:#]?\s*[a-z0-9-]{8,}\s*[\)\]]/gi;
const ID_LABEL_RE =
  /\b(?:deal|contact|product|company|quote|invoice)\s+id\s*[:=]?\s*[a-z0-9-]{8,}\b/gi;
const TRAILING_SUGGESTION_LIST_RE =
  /\s*\[\s*"[^"]{1,80}"(?:\s*,\s*"[^"]{1,80}"){0,6}\s*\]\s*$/;

function looksLikeHtmlMarkup(text: string): boolean {
  return (
    isHtmlEmailBody(text) ||
    /<(section|article|thead|tbody|strong|em|ul|ol)\b/i.test(text)
  );
}

export function sanitizeAssistantTextForUser(text: string): string {
  let raw = (text || "").trim();
  if (!raw) return "";
  raw = raw.replace(/<suggestions>[\s\S]*?<\/suggestions>/gi, "").trim();
  if (isCoworkerChatHtml(raw)) {
    raw = normalizeCoworkerChatHtml(raw);
    raw = raw.replace(TRAILING_SUGGESTION_LIST_RE, "").trim();
    let out = raw.replace(ID_PAREN_RE, "");
    out = out.replace(ID_LABEL_RE, "");
    out = out.replace(CRM_ID_RE, "");
    out = out.replace(/[ \t]{2,}/g, " ");
    out = out.replace(/\(\s*\)/g, "");
    return out.trim() || raw;
  }
  if (looksLikeHtmlMarkup(raw)) {
    raw = htmlToPlainText(raw);
  }
  raw = raw.replace(TRAILING_SUGGESTION_LIST_RE, "").trim();
  raw = unwrapMarkdownEmphasis(raw);
  raw = raw.replace(/^(?:(?:[-•]+|\*(?!\*))\s+)+/, "");
  raw = raw.replace(/\n(?:(?:[-•]+|\*(?!\*))\s+)+/g, "\n").trim();
  let out = raw.replace(ID_PAREN_RE, "");
  out = out.replace(ID_LABEL_RE, "");
  out = out.replace(CRM_ID_RE, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\s+([,.;:])/g, "$1");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]+\n/g, "\n");
  return out.trim() || raw;
}

export function looksLikeAffirmativeClient(text: string): boolean {
  const stripped = (text || "").trim();
  if (!stripped) return false;
  return /^(yes|yep|yeah|yup|y|ok|okay|sure|please|confirm|absolutely|definitely|do\s+it|go\s+ahead|go\s+for\s+it|looks?\s+good|sounds?\s+good|perfect|great|alright|all\s+right)(\s+(please|thanks|thank\s+you|now|go\s+ahead|do\s+it))*\s*[.!]?\s*$/i.test(
    stripped,
  );
}

/** Starts a new record draft — not a save confirmation ("create contact" vs "save it"). */
export function looksLikeNewRecordIntentClient(text: string): boolean {
  const stripped = (text || "").trim();
  if (!stripped) return false;
  return (
    /^(create|new|add|make|start|register|set\s*up)\s+(a\s+|an\s+)?(contact|lead|person)\b/i.test(
      stripped,
    ) ||
    /^(create|new)\s+(contact|lead|person)\s*[.!]?\s*$/i.test(stripped) ||
    /\bhelp me (to )?(create|add|make)\s+(a\s+|an\s+)?(contact|lead|person)\b/i.test(
      stripped,
    )
  );
}

/** @deprecated use looksLikeAffirmativeClient — kept for create-save phrasing. */
export function looksLikeCreateConfirmClient(text: string): boolean {
  const stripped = (text || "").trim();
  if (!stripped) return false;
  if (looksLikeNewRecordIntentClient(stripped)) return false;
  if (looksLikeAffirmativeClient(stripped)) return true;
  return /^(create(\s+(it|them|the\s+\w+|quote|deal|company|product))?(\s+now)?|save(\s+(it|them|contact|the\s+\w+))?(\s+now)?)(\s+(please|thanks|thank\s+you|now|save(\s+it)?|create(\s+it)?|go\s+ahead|do\s+it))*\s*[.!]?\s*$/i.test(
    stripped,
  );
}

/** User reply after "already exists — open that record instead" — yes, or explicit open. */
export function looksLikeOpenExistingReplyClient(text: string): boolean {
  const stripped = (text || "").trim();
  if (!stripped) return false;
  if (looksLikeAffirmativeClient(stripped)) return true;
  return /^(open|show|view|go\s+to)(\s+(it|that|this|the\s+existing\s+(one|record|company)|the\s+company))?\s*[.!]?\s*$/i.test(
    stripped,
  );
}

/** User reply after a delete confirm prompt — yes, or explicit delete/remove. */
export function looksLikeDeleteConfirmReplyClient(text: string): boolean {
  const stripped = (text || "").trim();
  if (!stripped) return false;
  if (looksLikeAffirmativeClient(stripped)) return true;
  return /^(delete|remove)(\s+(it|them|him|her|this|that|the\s+contact))?\s*[.!]?\s*$/i.test(
    stripped,
  );
}

/** True when the assistant asked for explicit delete confirmation in chat. */
export function looksLikeDeleteConfirmPromptClient(text: string): boolean {
  const lower = (text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (!/\b(delete|remove|remov)\b/.test(lower)) return false;
  return (
    /\bconfirm\b/.test(lower) ||
    /\bpermanently\b/.test(lower) ||
    /can'?t be undone/.test(lower) ||
    /cannot be undone/.test(lower) ||
    /go[- ]?ahead/.test(lower) ||
    /want me to remove/.test(lower) ||
    /want to permanently/.test(lower) ||
    /before i remove/.test(lower) ||
    /your go-ahead/.test(lower) ||
    /want your go-ahead/.test(lower) ||
    /ready to delete/.test(lower) ||
    /say \*\*delete\*\*/.test(lower)
  );
}

export function quoteDraftReadyClient(
  draft: Record<string, unknown> | null | undefined,
): boolean {
  if (!draft) return false;
  const dealId = String(draft.dealId || "").trim();
  const productId = String(draft.productId || "").trim();
  const quantity = String(draft.quantity || "").trim();
  return Boolean(dealId && productId && quantity);
}

function str(draft: Record<string, unknown> | null | undefined, key: string): string {
  return String((draft || {})[key] ?? "").trim();
}

export function contactDraftNamedClient(
  draft: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(str(draft, "firstName"));
}

/** Matches backend create: first name plus email or phone (last name and company optional). */
export function contactDraftSaveReadyClient(
  draft: Record<string, unknown> | null | undefined,
): boolean {
  if (!contactDraftNamedClient(draft)) return false;
  return Boolean(str(draft, "email") || str(draft, "phone"));
}

/** Mirrors each module's create-panel required fields, matching the DAO. */
export function draftReadyClientForModule(
  moduleId: string,
  draft: Record<string, unknown> | null | undefined,
  _businessType?: string | null,
): boolean {
  if (!draft) return false;
  switch (moduleId) {
    case "quotes":
      return quoteDraftReadyClient(draft);
    case "contact":
      return contactDraftSaveReadyClient(draft);
    case "company":
      return Boolean(str(draft, "name") && str(draft, "locationName"));
    case "sales":
      return Boolean(
        str(draft, "title") && (str(draft, "companyId") || str(draft, "companyName")),
      );
    case "product":
      return Boolean(str(draft, "name") && str(draft, "sku"));
    case "finance":
      return Boolean(str(draft, "dealId"));
    case "activities":
      return Boolean(str(draft, "contactId") && str(draft, "subject"));
    default:
      return false;
  }
}

const COMPANY_ONESHOT_NOISE =
  /^(create|add|new|register|set|up|a|an|the|company|companies|please|me|help|to|for|and|in|at|of|my)$/i;

/** "create Acme in Mumbai" — a create ask that already includes field values. */
function looksLikeOneShotCreateClient(text: string): boolean {
  const stripped = text.trim();
  if (!/\b(create|add|new|register|set\s*up)\b/i.test(stripped)) return false;
  const tokens = stripped.match(/[\w@.+-]+/g) ?? [];
  return tokens.some((token) => token.length >= 2 && !COMPANY_ONESHOT_NOISE.test(token));
}

/**
 * Name + location is enough to create the company.
 * Confirm, a one-shot create, or the message that fills the last required field.
 */
export function shouldPersistCompanyDraftClient(
  userText: string,
  before: Record<string, unknown> | null | undefined,
  merged: Record<string, unknown> | null | undefined,
): boolean {
  if (!draftReadyClientForModule("company", merged)) return false;
  const text = (userText || "").trim();
  if (looksLikeCreateConfirmClient(text) || looksLikeOneShotCreateClient(text)) {
    return true;
  }
  if (draftReadyClientForModule("company", before)) return false;
  if (text.endsWith("?") || /^(what|why|how|when|where|who|which)\b/i.test(text)) {
    return false;
  }
  return true;
}
