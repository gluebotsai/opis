export type MediaJobStatus =
  | "starting"
  | "connecting"
  | "listening"
  | "error"
  | "stopped";

export type StartJobBody = {
  sessionId: string;
  meetCode: string;
  joinUrl?: string | null;
  /** Google OAuth access token (host), with Meet Media scopes. */
  accessToken: string;
  /** CRM contact display name — preferred customer speaker label. */
  contactName?: string | null;
  /** Host / sales display names to exclude from Assist. */
  salesNames?: string[];
  hostUserId?: string | null;
  activityId?: string | null;
  /** CRM base URL for webhook ingest, e.g. http://127.0.0.1:4000 */
  crmBaseUrl?: string | null;
  crmInternalSecret?: string | null;
};

export type MediaJobSnapshot = {
  sessionId: string;
  meetCode: string;
  status: MediaJobStatus;
  error?: string | null;
  traceId?: string | null;
  startedAt: string;
  lastChunkAt?: string | null;
  chunksSent: number;
};
