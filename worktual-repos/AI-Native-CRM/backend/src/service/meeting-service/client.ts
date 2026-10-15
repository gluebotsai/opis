import { mintMeetingServiceJwt } from "@/service/meeting-service/jwt";
import {
  isMeetingServiceConfigured,
  meetingServiceBaseUrl,
} from "@/service/meeting-service/config";

export type MeetingServiceMeeting = {
  id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  platform: string;
  native_meeting_id: string;
  bot_name: string;
  meeting_url: string;
  join_at: string | null;
  expected_end_at: string | null;
  created_at: string;
  admitted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  recording_enabled: boolean;
};

export type MeetingServiceSegment = {
  segment_id: string;
  speaker: string;
  speakerKey?: string | null;
  speaker_key?: string | null;
  text: string;
  start?: number | null;
  end?: number | null;
  completed?: boolean;
};

export type MeetingServiceExtract = {
  meeting_id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  status: string;
  summary: string;
  next_step: string;
  action_items: unknown[];
  pain_points: unknown[];
  products: unknown[];
  speakers: unknown[];
};

type AuthInput = {
  organizationId: string;
  userId: string;
  email?: string | null;
};

async function meetingServiceFetch<T>(
  auth: AuthInput,
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; detail?: unknown }
> {
  if (!isMeetingServiceConfigured()) {
    return {
      ok: false,
      error: "Meeting service is not configured (MEETING_SERVICE_URL, CRM_SERVICE_JWT_SECRET).",
      status: 503,
    };
  }
  const token = mintMeetingServiceJwt({
    organizationId: auth.organizationId,
    sub: auth.userId,
    email: auth.email,
  });
  if (!token) {
    return { ok: false, error: "Could not mint meeting-service JWT.", status: 503 };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const { idempotencyKey: _ik, ...rest } = init ?? {};
  try {
    const res = await fetch(`${meetingServiceBaseUrl()}${path}`, {
      ...rest,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: T | undefined;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = undefined;
      }
    }
    if (!res.ok) {
      const detail =
        (data as { detail?: unknown } | undefined)?.detail ??
        (text.slice(0, 400) || res.statusText);
      const error =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "error_message" in detail
            ? String(
                (detail as { error_message?: unknown }).error_message ||
                  JSON.stringify(detail),
              ).slice(0, 400)
            : JSON.stringify(detail).slice(0, 400);
      return {
        ok: false,
        error,
        status: res.status,
        detail,
      };
    }
    return { ok: true, data: data as T, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Meeting service request failed",
      status: 502,
    };
  }
}

/** Remote spawn race: Vexa 409 mapped to capacity / "bot already active". */
export function isBotAlreadyActiveError(
  error: string | null | undefined,
  detail?: unknown,
): boolean {
  const fromDetail =
    detail &&
    typeof detail === "object" &&
    !Array.isArray(detail) &&
    String((detail as { error_message?: unknown }).error_message || "")
      .toLowerCase()
      .includes("already active");
  if (fromDetail) return true;
  const raw = String(error || "").toLowerCase();
  return raw.includes("already active") || raw.includes('"error_code":"capacity"');
}

export function meetingServiceErrorMeetingId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const id = (detail as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function synthesizeJoiningMeeting(
  partial: Partial<MeetingServiceMeeting> & { id: string },
): MeetingServiceMeeting {
  return {
    id: partial.id,
    organization_id: partial.organization_id || "",
    entity_type: partial.entity_type || "contact",
    entity_id: partial.entity_id || "",
    status: "joining",
    error_code: null,
    error_message: null,
    platform: partial.platform || "google_meet",
    native_meeting_id: partial.native_meeting_id || "",
    bot_name: partial.bot_name || "Worktual Notetaker",
    meeting_url: partial.meeting_url || "",
    join_at: partial.join_at ?? null,
    expected_end_at: partial.expected_end_at ?? null,
    created_at: partial.created_at || new Date().toISOString(),
    admitted_at: partial.admitted_at ?? null,
    started_at: partial.started_at ?? null,
    ended_at: partial.ended_at ?? null,
    recording_enabled: Boolean(partial.recording_enabled),
  };
}

export async function lookupMeetingServiceByUrl(input: {
  organizationId: string;
  userId: string;
  meetingUrl: string;
}): Promise<
  | { ok: true; meeting: MeetingServiceMeeting }
  | { ok: false; error: string }
> {
  const q = new URLSearchParams({ meeting_url: input.meetingUrl });
  const result = await meetingServiceFetch<MeetingServiceMeeting>(
    { organizationId: input.organizationId, userId: input.userId },
    `/v1/meetings/lookup?${q.toString()}`,
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, meeting: result.data };
}

export async function releaseMeetingServiceBot(input: {
  organizationId: string;
  userId: string;
  meetingUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await meetingServiceFetch<{ ok?: boolean }>(
    { organizationId: input.organizationId, userId: input.userId },
    "/v1/meetings/release-bot",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_url: input.meetingUrl }),
    },
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export async function createMeetingServiceNotetaker(input: {
  organizationId: string;
  userId: string;
  activityId: string;
  /** Override Idempotency-Key (defaults to activityId). */
  idempotencyKey?: string;
  entityType: "contact" | "deal" | "team";
  entityId: string;
  meetingUrl: string;
  joinAt?: string | null;
  expectedEndAt?: string | null;
  botName?: string | null;
  consentCaptured?: boolean;
}): Promise<
  | { ok: true; meeting: MeetingServiceMeeting }
  | { ok: false; error: string; status?: number }
> {
  const postOnce = async (idempotencyKey: string) =>
    meetingServiceFetch<MeetingServiceMeeting>(
      {
        organizationId: input.organizationId,
        userId: input.userId,
      },
      "/v1/meetings",
      {
        method: "POST",
        idempotencyKey,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: input.entityType,
          entity_id: input.entityId,
          meeting_url: input.meetingUrl,
          bot_name: input.botName || undefined,
          consent_captured: input.consentCaptured !== false,
          join_at: input.joinAt || null,
          expected_end_at: input.expectedEndAt || null,
        }),
      },
    );

  const primaryKey = input.idempotencyKey || input.activityId;
  let result = await postOnce(primaryKey);

  if (
    !result.ok &&
    isBotAlreadyActiveError(result.error, result.detail)
  ) {
    // Prefer an existing in-flight meeting (CRM + calendar double dispatch).
    const looked = await lookupMeetingServiceByUrl({
      organizationId: input.organizationId,
      userId: input.userId,
      meetingUrl: input.meetingUrl,
    });
    if (looked.ok && looked.meeting.status !== "failed") {
      return { ok: true, meeting: looked.meeting };
    }

    const failedId = meetingServiceErrorMeetingId(result.detail);
    // Release orphaned Vexa bot (new meeting-service) then retry once.
    await releaseMeetingServiceBot({
      organizationId: input.organizationId,
      userId: input.userId,
      meetingUrl: input.meetingUrl,
    }).catch(() => undefined);
    if (failedId) {
      await stopMeetingServiceMeeting({
        organizationId: input.organizationId,
        userId: input.userId,
        meetingId: failedId,
      }).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 1500));
    result = await postOnce(`${primaryKey}:retry-after-release`);

    if (
      !result.ok &&
      isBotAlreadyActiveError(result.error, result.detail)
    ) {
      // Old remote meeting-service: row marked failed while bot still lives.
      // Keep CRM capture alive so UI isn't red and status sync can recover.
      const id =
        meetingServiceErrorMeetingId(result.detail) ||
        failedId ||
        (looked.ok ? looked.meeting.id : null);
      if (id) {
        const got = await getMeetingServiceMeeting({
          organizationId: input.organizationId,
          userId: input.userId,
          meetingId: id,
        });
        if (got.ok) {
          return {
            ok: true,
            meeting: synthesizeJoiningMeeting({
              ...got.meeting,
              status: "joining",
              error_code: null,
              error_message: null,
            }),
          };
        }
        return {
          ok: true,
          meeting: synthesizeJoiningMeeting({ id }),
        };
      }
    }
  }

  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, meeting: result.data };
}

export async function getMeetingServiceMeeting(input: {
  organizationId: string;
  userId: string;
  meetingId: string;
}): Promise<
  | { ok: true; meeting: MeetingServiceMeeting }
  | { ok: false; error: string }
> {
  const result = await meetingServiceFetch<MeetingServiceMeeting>(
    { organizationId: input.organizationId, userId: input.userId },
    `/v1/meetings/${encodeURIComponent(input.meetingId)}`,
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, meeting: result.data };
}

export async function stopMeetingServiceMeeting(input: {
  organizationId: string;
  userId: string;
  meetingId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await meetingServiceFetch<unknown>(
    { organizationId: input.organizationId, userId: input.userId },
    `/v1/meetings/${encodeURIComponent(input.meetingId)}`,
    { method: "DELETE" },
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export async function fetchMeetingServiceTranscript(input: {
  organizationId: string;
  userId: string;
  meetingId: string;
  includePartial?: boolean;
}): Promise<
  | { ok: true; segments: MeetingServiceSegment[]; text: string }
  | { ok: false; error: string; status: number }
> {
  const result = await meetingServiceFetch<
    MeetingServiceSegment[] | { segments?: MeetingServiceSegment[] }
  >(
    { organizationId: input.organizationId, userId: input.userId },
    `/v1/meetings/${encodeURIComponent(input.meetingId)}/transcript${
      input.includePartial ? "?include_partial=true" : ""
    }`,
  );
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  const raw = result.data;
  const segments = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.segments)
      ? raw.segments
      : [];
  const text = segments
    .map((s) => {
      const speaker = (s.speaker || "Unknown").trim();
      const line = (s.text || "").trim();
      return line ? `${speaker}: ${line}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return { ok: true, segments, text };
}

export async function fetchMeetingServiceExtract(input: {
  organizationId: string;
  userId: string;
  meetingId: string;
}): Promise<
  | { ok: true; extract: MeetingServiceExtract }
  | { ok: false; error: string }
> {
  const result = await meetingServiceFetch<MeetingServiceExtract>(
    { organizationId: input.organizationId, userId: input.userId },
    `/v1/meetings/${encodeURIComponent(input.meetingId)}/extract`,
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, extract: result.data };
}

const TERMINAL_MEETING_SERVICE_STATUSES = new Set([
  "completed",
  "completed_partial",
  "failed",
]);

/** True when meeting-service will not emit more live transcript. */
export function isTerminalMeetingServiceStatus(
  status: string | null | undefined,
): boolean {
  return TERMINAL_MEETING_SERVICE_STATUSES.has(
    String(status || "").toLowerCase(),
  );
}

/** Map meeting-service status → CRM captureBot status for UI. */
export function mapMeetingServiceStatus(
  status: string,
  errorMessage?: string | null,
): "scheduled" | "joined" | "done" | "failed" | "missing" | "denied" {
  // Remote double-spawn marks the row failed while the Vexa bot is still live.
  if (
    status === "failed" &&
    isBotAlreadyActiveError(errorMessage || "", undefined)
  ) {
    return "scheduled";
  }
  switch (status) {
    case "completed":
    case "completed_partial":
      return "done";
    case "active":
      return "joined";
    case "failed":
      return "failed";
    case "awaiting_admission":
    case "joining":
    case "requested":
    case "stopping":
    case "processing":
      return "scheduled";
    default:
      return "scheduled";
  }
}
