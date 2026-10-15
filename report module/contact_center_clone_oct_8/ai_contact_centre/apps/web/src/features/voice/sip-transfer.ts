export const TRANSFER_TYPE_NULL = 0;
export const TRANSFER_TYPE_AGENT = 1;
export const TRANSFER_TYPE_PSTN = 2;

export const TRANSFER_ACTION_NULL = 0;
export const TRANSFER_ACTION_TRANSFEROR_MERGE = 1;
export const TRANSFER_ACTION_TRANSFEROR_TRANSFER = 2;
export const TRANSFER_ACTION_TRANSFEROR_CANCEL = 3;
export const TRANSFER_ACTION_TRANSFEROR_LEAVE = 4;
export const TRANSFER_ACTION_TRANSFEROR_ENDALL = 5;
export const TRANSFER_ACTION_TRANSFEREE_LEAVE = 6;

export const CCAAS_SESSION_ID_HEADER = "CCAAS-SESSION-ID";
export const CCAAS_FEATURE_REQ_HEADER = "CCAAS-FEATURE-REQ";
export const CCAAS_TRANSFER_TYPE_HEADER = "CCAAS-TRANSFER-TYPE";
export const CCAAS_FEATURE_TRANSFER = "TRANSFER";
export const CCAAS_FEATURE_LISTEN = "LISTEN";
export const CCAAS_CALLER_TYPE_HEADER = "CCAAS-CALLER-TYPE";
export const CCAAS_CALLER_TYPE_SUPERVISOR = "SUPERVISOR";
export const CCAAS_TRANSFER_TYPE_AGENT_NAME = "AGENT";

export type ConsultCallState = "idle" | "dialing" | "ringing" | "active";

export type VoiceTransferAction =
  | typeof TRANSFER_ACTION_TRANSFEROR_MERGE
  | typeof TRANSFER_ACTION_TRANSFEROR_TRANSFER
  | typeof TRANSFER_ACTION_TRANSFEROR_CANCEL
  | typeof TRANSFER_ACTION_TRANSFEROR_LEAVE
  | typeof TRANSFER_ACTION_TRANSFEROR_ENDALL
  | typeof TRANSFER_ACTION_TRANSFEREE_LEAVE;

export function voiceTransferInviteHeaders(sessionId: string): string[] {
  const id = sessionId.trim();
  if (!id) return [];
  return [
    `${CCAAS_SESSION_ID_HEADER}: ${id}`,
    `${CCAAS_FEATURE_REQ_HEADER}: ${CCAAS_FEATURE_TRANSFER}`,
    `${CCAAS_TRANSFER_TYPE_HEADER}: ${CCAAS_TRANSFER_TYPE_AGENT_NAME}`,
  ];
}

export function voiceSupervisorListenHeaders(sessionId: string): string[] {
  const id = sessionId.trim();
  if (!id) return [];
  return [
    `${CCAAS_SESSION_ID_HEADER}: ${id}`,
    `${CCAAS_FEATURE_REQ_HEADER}: ${CCAAS_FEATURE_LISTEN}`,
    `${CCAAS_CALLER_TYPE_HEADER}: ${CCAAS_CALLER_TYPE_SUPERVISOR}`,
  ];
}

/** True when this INVITE is the supervisor listen leg to the supervisor's own extension. */
export function isSupervisorListenInvite(raw: string, supervisorExt: string | null | undefined): boolean {
  return isVoiceConsultInviteForExt(raw, supervisorExt);
}

export function isVoiceTransferFeatureReq(value: string | null | undefined): boolean {
  return value?.trim().toUpperCase() === CCAAS_FEATURE_TRANSFER;
}

export function canShowVoiceConsultCompleteActions(consultState: ConsultCallState): boolean {
  return consultState === "active";
}

/** Separate A–B banner. Closed once the consult is cancelled, transferred, or merged. */
export function shouldShowConsultSpeakingBanner(input: {
  consultState: ConsultCallState;
  merged: boolean;
  transferConsultRole: "primary" | "secondary" | null;
  callState: "idle" | "dialing" | "ringing" | "active";
  secondaryConsultOnly: boolean;
}): boolean {
  if (input.merged) return false;
  if (input.consultState === "active") return true;
  return (
    input.transferConsultRole === "secondary" &&
    input.secondaryConsultOnly &&
    input.callState === "active"
  );
}

export function isVoiceConsultRinging(consultState: ConsultCallState): boolean {
  return consultState === "dialing" || consultState === "ringing";
}

export function isVoiceConsultInviteForExt(raw: string, ext: string | null | undefined): boolean {
  const targetExt = ext?.trim();
  if (!targetExt) return false;
  const requestLine = raw.split(/\r\n|\n/, 1)[0]?.trim() ?? "";
  const match = /^INVITE\s+sips?:([^@;>\s]+)/i.exec(requestLine);
  return match?.[1] === targetExt;
}

export function canStartVoiceConsultInvite(input: {
  hasCustomerSession: boolean;
  customerCallState: ConsultCallState | "idle";
  consultState: ConsultCallState;
}): boolean {
  return (
    input.hasCustomerSession &&
    input.customerCallState === "active" &&
    input.consultState === "idle"
  );
}

export function canShowVoiceConsultLeave(input: {
  merged: boolean;
  transferConsultRole: "primary" | "secondary" | null;
}): boolean {
  return input.merged && Boolean(input.transferConsultRole);
}

/** ACD TRANSFER_ACTION to publish before the browser tears down a live SIP leg. */
export function acdActionForVoiceHangup(input: {
  merged: boolean;
  transferConsultRole: "primary" | "secondary" | null;
  consultState: ConsultCallState;
  secondaryConsultOnly: boolean;
}): VoiceTransferAction | null {
  if (input.transferConsultRole === "secondary") {
    if (!input.merged && !input.secondaryConsultOnly) return null;
    return TRANSFER_ACTION_TRANSFEREE_LEAVE;
  }
  if (input.merged && input.transferConsultRole === "primary") {
    return TRANSFER_ACTION_TRANSFEROR_ENDALL;
  }
  if (input.consultState !== "idle") {
    return TRANSFER_ACTION_TRANSFEROR_CANCEL;
  }
  return null;
}

/** What the browser may tear down after an ACD hangup action is acknowledged. */
export function hangupTeardownOrder(
  action: VoiceTransferAction | null,
): "consult-then-customer" | "after-ack" | "sip-bye" {
  if (action === TRANSFER_ACTION_TRANSFEROR_CANCEL) return "consult-then-customer";
  if (action) return "after-ack";
  return "sip-bye";
}

export function injectVoiceTransferHeaders(raw: string, headers: string[] | null | undefined): string {
  if (!headers?.length) return raw;
  if (!/^INVITE\s/i.test(raw.split(/\r\n|\n/, 1)[0] ?? "")) return raw;
  const missing = headers.filter((header) => {
    const name = header.slice(0, header.indexOf(":")).trim();
    return name.length > 0 && !new RegExp(`^${name}:`, "im").test(raw);
  });
  if (missing.length === 0) return raw;
  const sep = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(sep);
  const contentLength = lines.findIndex((line) => /^Content-Length/i.test(line));
  if (contentLength === -1) return `${raw.replace(/\s+$/, "")}${sep}${missing.join(sep)}${sep}`;
  lines.splice(contentLength, 0, ...missing);
  return lines.join(sep);
}
