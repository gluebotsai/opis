import { api } from "./api";
import { getMeetingAssistPanelToken } from "@/lib/meeting-assist-panel-auth";

export type AssistSuggestion = {
  title: string;
  text: string;
  kind: string;
};

export type AssistSentiment = "positive" | "neutral" | "negative" | "confused";

export type AssistFitGap = {
  area: string;
  status: "fit" | "gap" | "unknown";
  note?: string | null;
};

export type AssistConversationContext = {
  backgroundOneLine?: string | null;
  lastDiscussionSummary?: string | null;
  theirPositionThen?: string | null;
  theirFocusNow?: string | null;
  whatChanged?: string | null;
};

export type AssistAction = {
  kind:
    | "schedule_meeting"
    | "call"
    | "send_case_study"
    | "involve_presales"
    | "send_follow_up"
    | "task";
  label: string;
  detail: string;
  whenLocal?: string | null;
  durationMinutes?: number | null;
  subject?: string | null;
  body?: string | null;
};

export type AssistResult = {
  ok: boolean;
  talkTrack: string | null;
  suggestions: AssistSuggestion[];
  objections: string[];
  nextQuestions: string[];
  conversationContext?: AssistConversationContext | null;
  action?: AssistAction | null;
  nextBestAction?: string | null;
  sentimentCoachHint?: string | null;
  fitGaps?: AssistFitGap[];
  persona?: "sales" | "presales" | null;
  query?: string | null;
  sentiment?: AssistSentiment | null;
  kbStatus?: string | null;
  reason?: string | null;
};

export type MeetingAssistChunk = {
  id: string;
  seq: number;
  speaker: string | null;
  text: string;
};

export type MeetingAssistSessionView = {
  id: string;
  status: string;
  provider: string;
  joinUrl: string | null;
  contactId: string;
  activityId: string;
  contactName: string | null;
  activity: {
    id: string;
    subject: string;
    body: string | null;
    transcriptText?: string | null;
    transcriptSource?: string | null;
    missEscalatedAt?: string | null;
    momSentAt?: string | null;
  } | null;
  lastSuggestions: (AssistResult & { query?: string | null }) | null;
  chunks: MeetingAssistChunk[];
  meta?: {
    captureBot?: {
      status?: string;
      botId?: string | null;
      provider?: string | null;
      meetingServiceStatus?: string | null;
      error?: string | null;
      joinAt?: string | null;
    };
    vexaAutoDispatch?: boolean;
    assistAddonUrl?: string | null;
  } | null;
};

export type HostMeetingRow = {
  activityId: string;
  contactId: string;
  contactName: string;
  subject: string;
  topic: string | null;
  joinUrl: string | null;
  meetCode: string | null;
  provider: string;
  dueAt: string | null;
  sessionId: string | null;
};

export async function startMeetingAssist(input: {
  activityId: string;
  provider?: string | null;
  externalMeetingId?: string | null;
  joinUrl?: string | null;
}) {
  const { data } = await api.post<
    { ok: true; sessionId: string } | { ok: false; error: string }
  >("/api/meeting-assist/sessions", input);
  return data;
}

/** Throws on 404 (no such session) — callers fall back to startMeetingAssist. */
export async function fetchMeetingAssistSession(sessionId: string) {
  const { data } = await api.get<MeetingAssistSessionView>(
    `/api/meeting-assist/sessions/${sessionId}`,
  );
  return data;
}

export async function fetchMeetingAssistForActivity(activityId: string) {
  const { data } = await api.get<MeetingAssistSessionView>(
    `/api/meeting-assist/sessions/activity/${activityId}`,
  );
  return data;
}

export type NotetakerStatusView = {
  status: string | null;
  captureBot: {
    status?: string;
    botId?: string | null;
    provider?: string | null;
    meetingServiceStatus?: string | null;
    error?: string | null;
  } | null;
  vexaAutoDispatch?: boolean;
  assistAddonUrl?: string | null;
};

export async function fetchNotetakerStatus(activityId: string) {
  const { data } = await api.get<NotetakerStatusView>(
    `/api/meeting-assist/notetaker/${activityId}/status`,
  );
  return data;
}

export async function sendMeetingNotetaker(input: {
  activityId: string;
  consentCaptured?: boolean;
}) {
  const { data } = await api.post<
    | {
        meetingServiceId: string;
        sessionId: string;
        status: string;
      }
    | { message?: string }
  >(`/api/meeting-assist/notetaker/${input.activityId}/send`, {
    consentCaptured: input.consentCaptured !== false,
  });
  return data;
}

export async function appendMeetingTranscriptChunk(input: {
  sessionId: string;
  text: string;
  speaker?: string | null;
  source?: string | null;
}) {
  const { data } = await api.post<
    { ok: true; inserted: number } | { ok: false; error: string }
  >(`/api/meeting-assist/sessions/${input.sessionId}/chunks`, {
    text: input.text,
    speaker: input.speaker,
    source: input.source,
  });
  return data;
}

export async function runMeetingAssist(input: {
  sessionId: string;
  query?: string | null;
  mode?: "sales" | "service" | "auto";
}) {
  const { data } = await api.post<AssistResult & { sessionId: string }>(
    `/api/meeting-assist/sessions/${input.sessionId}/assist`,
    {
      query: input.query,
      mode: input.mode,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  );
  return data;
}

export async function finalizeMeetingAssist(input: {
  sessionId: string;
  source?: string | null;
}) {
  const { data } = await api.post<
    | { ok: true; transcriptChars: number; contactId: string }
    | { ok: false; error: string }
  >(`/api/meeting-assist/sessions/${input.sessionId}/finalize`, {
    source: input.source,
  });
  return data;
}

export async function startMeetMediaAssist(sessionId: string) {
  const { data } = await api.post<
    | { ok: true; mode?: string; liveStatus?: string; botId?: string }
    | { ok: false; error: string }
  >(`/api/meeting-assist/sessions/${sessionId}/media/start`);
  return data;
}

export async function stopMeetMediaAssist(sessionId: string) {
  const { data } = await api.post<{ ok: true } | { ok: false; error: string }>(
    `/api/meeting-assist/sessions/${sessionId}/media/stop`,
  );
  return data;
}

export async function fetchMeetMediaAssistStatus(sessionId: string) {
  const { data } = await api.get<{
    ok: true;
    mediaAssist: {
      status: string;
      error?: string | null;
      traceId?: string | null;
    };
  }>(`/api/meeting-assist/sessions/${sessionId}/media/status`);
  return data;
}

export function meetingAssistEventsUrl(sessionId: string): string {
  // Same-origin via Vite/Cloudflare proxy — avoids ngrok browser interstitial
  // (EventSource cannot send ngrok-skip-browser-warning) and cross-origin SSE CORS.
  const base = `/api/meeting-assist/sessions/${encodeURIComponent(sessionId)}/events`;
  const token = getMeetingAssistPanelToken();
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}

/** Cookie session → session-scoped panel JWT + absolute panel URL. */
export async function issueMeetingAssistPanelToken(sessionId: string) {
  const { data } = await api.post<
    | { ok: true; token: string; panelUrl: string; expiresAt: number }
    | { ok: false; error: string }
  >(`/api/meeting-assist/sessions/${sessionId}/panel-token`);
  return data;
}

/** Cookie session → user-scoped host JWT (Connect CRM popup). */
export async function issueMeetingAssistHostToken() {
  const { data } = await api.post<
    { ok: true; token: string; expiresAt: number } | { ok: false; error: string }
  >("/api/meeting-assist/hosts/token");
  return data;
}

export async function listHostMeetings(input?: {
  provider?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (input?.provider) params.set("provider", input.provider);
  if (input?.limit) params.set("limit", String(input.limit));
  const qs = params.toString();
  const { data } = await api.get<
    { ok: true; meetings: HostMeetingRow[] } | { ok: false; error: string }
  >(`/api/meeting-assist/hosts/meetings${qs ? `?${qs}` : ""}`);
  return data;
}

export async function startHostMeetingAssist(input: {
  activityId: string;
  externalMeetingId?: string | null;
}) {
  const { data } = await api.post<
    | {
        ok: true;
        sessionId: string;
        contactId: string;
        contactName: string;
        topic: string | null;
        joinUrl: string | null;
        provider: string;
        token: string;
        panelUrl: string;
      }
    | { ok: false; error: string }
  >("/api/meeting-assist/hosts/start", input);
  return data;
}

export async function resolveMeetCodeForHost(meetCode: string) {
  const { data } = await api.post<
    | {
        ok: true;
        activityId: string;
        contactId: string;
        sessionId: string;
        contactName: string;
        topic: string | null;
        joinUrl: string | null;
        token: string;
        panelUrl: string;
      }
    | { ok: false; error: string }
  >("/api/meeting-assist/hosts/meet/resolve", { meetCode });
  return data;
}
