import type { EmailUrgency } from "./email-priority.js";

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

function nlpHeaders(organizationId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  return headers;
}

export async function classifyEmailPriority(input: {
  organizationId: string;
  conversationId: string;
  subject: string;
  message: string;
}): Promise<EmailUrgency> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/email/priority`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        subject: input.subject,
        message: input.message,
      }),
    });
    if (!response.ok) return "normal";
    const body = (await response.json()) as { urgency?: EmailUrgency };
    return body.urgency ?? "normal";
  } catch {
    return "normal";
  }
}
