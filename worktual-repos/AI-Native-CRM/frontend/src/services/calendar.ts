import { api } from "./api";
import { fetchContactDetail } from "./contacts";

export type UnifiedCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  source: string;
  meetLink: string | null;
  htmlLink: string | null;
  contactId: string | null;
  contactName: string | null;
  location: string | null;
  rescheduled?: boolean;
  superseded?: boolean;
  previousStartAt?: string | null;
};

export type CalendarContact = {
  id: string;
  displayName: string;
  email: string;
};

export async function fetchCalendarEvents(params: {
  timeMin: string;
  timeMax: string;
  ownerScope?: "mine" | "all";
}) {
  const { data } = await api.get<{
    ok: true;
    events: UnifiedCalendarEvent[];
    ownerScope: "mine" | "all";
    canViewTeam: boolean;
    googleConfigured: boolean;
    googleConnected: boolean;
    googleEmail: string | null;
    googleError: string | null;
  }>("/api/calendar/events", { params });
  return data;
}

export type CalendarIntegrationsStatus = {
  googleConfigured: boolean;
  googleConnected: boolean;
  googleCanSendMail: boolean;
  googleCanScheduleMeetings: boolean;
  googleEmail: string | null;
  canSendMail: boolean;
  microsoftConfigured: boolean;
  microsoftConnected: boolean;
  microsoftEmail: string | null;
  zoomConfigured: boolean;
  teamsConfigured: boolean;
};

/** Connected-account status used to gate meeting providers (Google Meet / Zoom / Teams). */
export async function fetchCalendarIntegrations() {
  const { data } = await api.get<{ ok: true } & CalendarIntegrationsStatus>(
    "/api/calendar/integrations",
  );
  return data;
}

export async function fetchCalendarContacts() {
  const { data } = await api.get<{
    ok: true;
    contacts: CalendarContact[];
  }>("/api/calendar/contacts");
  return data;
}

export type ScheduleMeetingResult =
  | {
      ok: true;
      id: string;
      confirmationSent: boolean;
      emailError?: string;
      needsConnect?: boolean;
      /** Soft heads-up, e.g. Sales Assist can't tell this contact apart
       * from your team on the call. Never blocks scheduling. */
      warning?: string;
    }
  | { ok: false; error: string; needsConnect?: boolean };

/** If the browser timed out but the API finished, treat as success when a matching meeting exists. */
async function recoverScheduleMeetingAfterTimeout(input: {
  contactId: string;
  whenIso?: string;
}): Promise<ScheduleMeetingResult | null> {
  try {
    const detail = await fetchContactDetail(input.contactId);
    if (!detail?.ok || !input.whenIso?.trim()) return null;
    const target = new Date(input.whenIso).getTime();
    if (Number.isNaN(target)) return null;
    const match = detail.activities.find(
      (a) =>
        a.type === "meeting" &&
        a.folder === "inbox" &&
        !a.completedAt &&
        a.dueAt &&
        Math.abs(new Date(a.dueAt).getTime() - target) < 120_000,
    );
    if (!match) return null;
    return {
      ok: true,
      id: match.id,
      confirmationSent: true,
    };
  } catch {
    return null;
  }
}

export async function scheduleMeeting(body: {
  contactId: string;
  when: string;
  whenIso?: string;
  timeZone?: string;
  topic?: string;
  durationMinutes?: number;
  participants?: string;
  participantEmails?: string[];
  meetingProvider?: string;
}): Promise<ScheduleMeetingResult> {
  try {
    const { data } = await api.post("/api/calendar/meetings", body, {
      timeout: 120_000,
    });
    return data as ScheduleMeetingResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(msg)) {
      const recovered = await recoverScheduleMeetingAfterTimeout({
        contactId: body.contactId,
        whenIso: body.whenIso,
      });
      if (recovered) return recovered;
      return {
        ok: false as const,
        error:
          "Scheduling timed out waiting for the CRM API. The meeting may still have been created — check Google Calendar, then refresh this contact. On the server, check api logs and that the api container can reach googleapis.com (rebuild api after git pull).",
      };
    }
    throw err;
  }
}

export async function createCalendarActivity(body: {
  contactId: string;
  type: string;
  subject: string;
  body?: string | null;
  dueAt?: string | null;
}) {
  const { data } = await api.post("/api/calendar/activities", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}
