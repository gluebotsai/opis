import { api } from "./api";
import type { AssistAction } from "./meetingAssist";

export type { AssistAction };

export type CallAssistSuggestion = {
  title: string;
  text: string;
  kind: string;
};

export type CallAssistFitGap = {
  area: string;
  status: "fit" | "gap" | "unknown";
  note?: string | null;
};

export type CallAssistConversationContext = {
  backgroundOneLine?: string | null;
  lastDiscussionSummary?: string | null;
  theirPositionThen?: string | null;
  theirFocusNow?: string | null;
  whatChanged?: string | null;
};

export type CallAssistResult = {
  ok: boolean;
  talkTrack: string | null;
  suggestions: CallAssistSuggestion[];
  nextQuestions: string[];
  conversationContext?: CallAssistConversationContext | null;
  fitGaps?: CallAssistFitGap[];
  nextBestAction: string | null;
  action?: AssistAction | null;
  sentiment: string | null;
  sentimentCoachHint: string | null;
  detectedObjection: {
    kind: string;
    reply?: string;
    question?: string | null;
  } | null;
  query: string | null;
  reason: string | null;
};

export type CallTranscriptChunk = {
  seq: number;
  speaker: string | null;
  text: string;
  isBot: boolean;
};

export type CallAssistSession = {
  open: true;
  sessionId: string;
  contactId: string;
  contactName: string;
  remoteDigits?: string;
};

export type CallAssistSnapshot = {
  sessionId: string;
  status: string;
  contactId: string;
  contactName: string | null;
  activityId: string | null;
  remoteDigits?: string | null;
  chunks: CallTranscriptChunk[];
  assist: CallAssistResult | null;
};

export async function startCallAssist(input: {
  remoteNumber: string;
  direction: "inbound" | "outbound";
  connectedAt?: number | null;
  timeZone?: string | null;
}): Promise<
  | { ok: true; open: false; reason?: string }
  | ({ ok: true } & CallAssistSession)
  | { ok: false; error: string }
> {
  const { data } = await api.post<
    | { ok: true; open: false; reason?: string }
    | ({ ok: true } & CallAssistSession)
    | { ok: false; error: string }
  >("/api/voice/calls/start", input);
  return data;
}

export async function askCallAssist(sessionId: string, query: string) {
  const { data } = await api.post<
    { ok: true; result: CallAssistResult | null } | { ok: false; error?: string }
  >(`/api/voice/calls/${encodeURIComponent(sessionId)}/ask`, {
    query,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return data;
}

export async function executeCallAssistAction(sessionId: string, action: AssistAction) {
  const { data } = await api.post<{ ok: true; message?: string } | { ok: false; error?: string }>(
    `/api/voice/calls/${encodeURIComponent(sessionId)}/execute-action`,
    {
      action,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  );
  return data;
}

export async function endCallAssist(
  sessionId: string,
  reason: "hangup" | "remote_bye" | "failed",
) {
  const { data } = await api.post<{ ok: boolean; activityId?: string | null; error?: string }>(
    `/api/voice/calls/${encodeURIComponent(sessionId)}/end`,
    { reason },
  );
  return data;
}

export function callAssistEventsUrl(sessionId: string): string {
  return `/api/voice/calls/${encodeURIComponent(sessionId)}/events`;
}

export type CallActivityAssist = {
  talkTrack?: string | null;
  suggestions?: Array<{ title?: string; text: string; kind?: string }>;
  nextQuestions?: string[];
  nextBestAction?: string | null;
  sentiment?: string | null;
  sentimentCoachHint?: string | null;
  detectedObjection?: {
    kind: string;
    reply?: string;
    question?: string | null;
  } | null;
  conversationContext?: CallAssistConversationContext | null;
  fitGaps?: CallAssistFitGap[];
  query?: string | null;
};

export type CallActivityTranscript = {
  activityId: string;
  contactId: string;
  subject: string;
  body: string | null;
  transcriptText: string | null;
  transcriptSource: string | null;
  createdAt: string;
  contactName?: string | null;
  agentName?: string | null;
  session: {
    sessionId: string;
    direction: string;
    remoteDigits: string;
    contactName: string | null;
    agentName?: string | null;
    status: string;
    endedAt: string | null;
    gatewaySession?: string | null;
    chunkCount?: number;
  } | null;
  callAssist?: {
    kind?: string;
    captureStatus?: string;
    chunkCount?: number;
    assist?: CallActivityAssist | null;
  } | null;
  chunks: CallTranscriptChunk[];
  /** Voice bot call audio from the gateway. Null for agent SIP calls. */
  recordingUrl?: string | null;
};

export async function fetchCallActivityTranscript(activityId: string) {
  const { data } = await api.get<CallActivityTranscript>(
    `/api/voice/calls/by-activity/${encodeURIComponent(activityId)}`,
  );
  return data;
}
