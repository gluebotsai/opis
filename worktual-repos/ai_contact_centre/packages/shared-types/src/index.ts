export type ChannelType =
  | "webchat"
  | "email"
  | "sms"
  | "voice"
  | "whatsapp"
  | "instagram"
  | "facebook";

export type ConversationStatus =
  | "assigned"
  | "waiting"
  | "in_progress"
  | "callback"
  | "closed";

export type AgentPresenceStatus = "online" | "away" | "busy" | "offline";

export interface JwtPayload {
  sub: string;
  tenant_id: string;
  email?: string;
  roles?: string[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
