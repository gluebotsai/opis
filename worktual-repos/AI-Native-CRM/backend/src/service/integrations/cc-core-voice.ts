/**
 * cc-core auto-bot-call for lead nurture voice.
 */

import { writeNurtureApiLog } from "@/service/ai/nurture-api-log";

const QA_CC_CORE_API_BASE_URL =
  "https://rebuild-ccaas-api.worktual.com/cc-core-api";

export function ccCoreApiBaseUrl(): string {
  const fromEnv = process.env.CC_CORE_API_BASE_URL?.trim()?.replace(/\/$/, "");
  return fromEnv || QA_CC_CORE_API_BASE_URL;
}

export function isCcCoreVoiceConfigured(): boolean {
  return Boolean(
    ccCoreApiBaseUrl() && process.env.CC_CORE_INTERNAL_SERVICE_KEY?.trim(),
  );
}

export type AutoBotCallData = Record<string, unknown>;

export type AutoBotCallResult =
  | {
      ok: true;
      sessionId: string;
      channel?: string | null;
      domainName?: string | null;
      cli?: string | null;
    }
  | { ok: false; error: string; status?: number };

export async function triggerAutoBotCall(input: {
  organizationId: string;
  number: string;
  /** Customer / event context for the voice or WhatsApp bot. */
  data: AutoBotCallData;
  /** Operator or LLM guidance for how nurturing should run for this person. */
  instruction: string;
}): Promise<AutoBotCallResult> {
  const url = `${ccCoreApiBaseUrl()}/internal/v1/voice/auto-bot-call`;
  const requestBody = {
    organizationId: input.organizationId,
    number: input.number,
    data: input.data,
    instruction: input.instruction,
  };
  const contactId =
    typeof input.data.cdp_id === "string" ? input.data.cdp_id : null;
  const startedAt = performance.now();
  const key = process.env.CC_CORE_INTERNAL_SERVICE_KEY?.trim();
  if (!key) {
    writeNurtureApiLog({
      nurtureKind: "voicebot",
      service: "cc-core",
      operation: "auto-bot-call",
      method: "POST",
      url,
      request: requestBody,
      response: null,
      status: null,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      organizationId: input.organizationId,
      contactId,
      error: "cc_core_key_not_configured",
    });
    return { ok: false, error: "cc_core_key_not_configured" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-service-key": key,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "cc_core_fetch_failed";
    writeNurtureApiLog({
      nurtureKind: "voicebot",
      service: "cc-core",
      operation: "auto-bot-call",
      method: "POST",
      url,
      request: requestBody,
      response: null,
      status: null,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      organizationId: input.organizationId,
      contactId,
      error,
    });
    return {
      ok: false,
      error,
    };
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `cc_core_http_${response.status}`;
    writeNurtureApiLog({
      nurtureKind: "voicebot",
      service: "cc-core",
      operation: "auto-bot-call",
      method: "POST",
      url,
      request: requestBody,
      response: payload,
      status: response.status,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      organizationId: input.organizationId,
      contactId,
      error: message,
    });
    return { ok: false, error: message, status: response.status };
  }

  const sessionId = payload.sessionId ?? payload.session_id;
  if (sessionId == null || String(sessionId).trim() === "") {
    writeNurtureApiLog({
      nurtureKind: "voicebot",
      service: "cc-core",
      operation: "auto-bot-call",
      method: "POST",
      url,
      request: requestBody,
      response: payload,
      status: response.status,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      organizationId: input.organizationId,
      contactId,
      error: "cc_core_missing_session_id",
    });
    return { ok: false, error: "cc_core_missing_session_id", status: response.status };
  }

  writeNurtureApiLog({
    nurtureKind: "voicebot",
    service: "cc-core",
    operation: "auto-bot-call",
    method: "POST",
    url,
    request: requestBody,
    response: payload,
    status: response.status,
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    organizationId: input.organizationId,
    contactId,
  });
  return {
    ok: true,
    sessionId: String(sessionId),
    channel:
      payload.channel == null ? null : String(payload.channel),
    domainName:
      payload.domainName == null ? null : String(payload.domainName),
    cli: payload.cli == null ? null : String(payload.cli),
  };
}
