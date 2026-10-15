/**
 * Framework-agnostic calendar commands for Fastify Wave 8.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import {
  listUnifiedCalendarEvents,
  type CalendarOwnerScope,
  type UnifiedCalendarEvent,
} from "@/dao/calendar/calendar-service";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import {
  googleHasCalendarScope,
  googleHasGmailSendScope,
  isGoogleConfigured,
} from "@/service/google/access-token";
import {
  microsoftHasMailSendScope,
  isMicrosoftOAuthConfigured,
} from "@/service/microsoft/oauth";
import { isTeamsConfigured } from "@/service/microsoft/teams-api";
import { isZoomConfigured } from "@/service/zoom/zoom-api";
import { listContactsForSelect } from "@/dao/contacts/contact-service";
import {
  scheduleMeetingCommand,
  type ScheduleMeetingResult,
} from "@/service/calendar/schedule-meeting-command";
import type { MeetingProvider } from "@/lib/meeting-provider";

export type ListCalendarEventsResult = {
  events: UnifiedCalendarEvent[];
  googleConfigured: boolean;
  googleConnected: boolean;
  googleEmail: string | null;
  googleError: string | null;
  ownerScope: CalendarOwnerScope;
  canViewTeam: boolean;
};

export async function listCalendarEventsCommand(input: {
  timeMin: string;
  timeMax: string;
  ownerScope?: CalendarOwnerScope;
}): Promise<ListCalendarEventsResult> {
  const timeMin = new Date(input.timeMin);
  const timeMax = new Date(input.timeMax);
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
    return {
      events: [],
      googleConfigured: isGoogleConfigured(),
      googleConnected: false,
      googleEmail: null,
      googleError: "Invalid date range.",
      ownerScope: "mine",
      canViewTeam: false,
    };
  }

  const userId = await getServerUserId();
  const result = await listUnifiedCalendarEvents({
    userId,
    timeMin,
    timeMax,
    ownerScope: input.ownerScope,
  });

  return {
    events: result.events,
    googleConfigured: isGoogleConfigured(),
    googleConnected: result.googleConnected,
    googleEmail: result.googleEmail,
    googleError: result.googleError,
    ownerScope: result.ownerScope,
    canViewTeam: result.canViewTeam,
  };
}

export async function listCalendarContactsCommand() {
  const contacts = await listContactsForSelect({ limit: 200 });
  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      email: c.email,
    })),
  };
}

export type CalendarIntegrationsView = {
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
  zoom: "available" | "not_configured";
  microsoft: "available" | "not_configured";
};

/** Connected-account status used to decide which meeting providers a user can pick. */
export async function getCalendarIntegrationsCommand(): Promise<CalendarIntegrationsView> {
  const userId = await getServerUserId();
  const googleConfigured = isGoogleConfigured();
  const microsoftConfigured = isMicrosoftOAuthConfigured();
  const zoomConfigured = isZoomConfigured();
  const teamsConfigured = isTeamsConfigured();

  if (!userId) {
    return {
      googleConfigured,
      googleConnected: false,
      googleCanSendMail: false,
      googleCanScheduleMeetings: false,
      googleEmail: null,
      canSendMail: false,
      microsoftConfigured,
      microsoftConnected: false,
      microsoftEmail: null,
      zoomConfigured,
      teamsConfigured,
      zoom: zoomConfigured ? "available" : "not_configured",
      microsoft: teamsConfigured ? "available" : "not_configured",
    };
  }

  const google = await getCalendarConnection(userId, "google");
  const microsoft = await getCalendarConnection(userId, "microsoft");
  const canSendGoogle = Boolean(google) && googleHasGmailSendScope(google?.scope);
  const canCalendar = Boolean(google) && googleHasCalendarScope(google?.scope);
  const canSendMicrosoft =
    Boolean(microsoft) && microsoftHasMailSendScope(microsoft?.scope);
  const canSendMail = canSendGoogle || canSendMicrosoft;

  return {
    googleConfigured,
    googleConnected: Boolean(google),
    googleCanSendMail: canSendGoogle,
    googleCanScheduleMeetings: canSendGoogle && canCalendar,
    googleEmail: google?.accountEmail ?? null,
    canSendMail,
    microsoftConfigured,
    microsoftConnected: Boolean(microsoft),
    microsoftEmail: microsoft?.accountEmail ?? null,
    zoomConfigured,
    teamsConfigured,
    zoom: zoomConfigured ? "available" : "not_configured",
    microsoft: teamsConfigured ? "available" : "not_configured",
  };
}

export async function scheduleCalendarMeetingCommand(input: {
  contactId: string;
  when: string;
  whenIso?: string;
  timeZone?: string;
  topic?: string;
  durationMinutes?: number;
  participants?: string;
  participantEmails?: string[];
  meetingProvider?: MeetingProvider;
}): Promise<ScheduleMeetingResult> {
  return scheduleMeetingCommand(input);
}
