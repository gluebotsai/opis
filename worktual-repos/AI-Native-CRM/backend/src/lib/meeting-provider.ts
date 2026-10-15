export type MeetingProvider = "google_meet" | "zoom" | "teams";

export const MEETING_PROVIDERS: MeetingProvider[] = [
  "google_meet",
  "zoom",
  "teams",
];

export function meetingProviderLabel(provider: MeetingProvider): string {
  switch (provider) {
    case "google_meet":
      return "Google Meet";
    case "zoom":
      return "Zoom";
    case "teams":
      return "Microsoft Teams";
  }
}

export function meetingJoinLabel(provider: MeetingProvider): string {
  switch (provider) {
    case "google_meet":
      return "Join Meet";
    case "zoom":
      return "Join Zoom";
    case "teams":
      return "Join Teams";
  }
}

export function isMeetingProvider(value: string): value is MeetingProvider {
  return MEETING_PROVIDERS.includes(value as MeetingProvider);
}

export function parseMeetingProviderFromBody(
  body: string | null | undefined,
): MeetingProvider {
  if (!body) return "google_meet";
  const match = body.match(/^Provider:\s*(google_meet|zoom|teams)\s*$/im);
  if (match?.[1] && isMeetingProvider(match[1])) return match[1];
  if (/zoom\.us/i.test(body)) return "zoom";
  if (/teams\.microsoft\.com/i.test(body)) return "teams";
  return "google_meet";
}
