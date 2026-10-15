import { api } from "./api";

export type PresenceState = "ready" | "not_ready" | "busy" | "away";

export type AgentPresence = {
  state: PresenceState;
  statusName: string;
  confirmed: boolean;
};

type PresenceResponse = {
  ok?: boolean;
  presence?: AgentPresence;
  error?: string;
};

function readPresence(data: PresenceResponse): AgentPresence {
  if (!data.ok || !data.presence) {
    throw new Error(data.error || "Presence update failed");
  }
  return data.presence;
}

export async function getPresence(): Promise<AgentPresence> {
  const response = await api.get<PresenceResponse>("/api/voice/presence");
  return readPresence(response.data);
}

export async function initializePresence(): Promise<AgentPresence> {
  const response = await api.post<PresenceResponse>("/api/voice/presence/initialize");
  return readPresence(response.data);
}

export async function updatePresence(
  state: PresenceState,
  source?: "toolbar" | "voice",
): Promise<AgentPresence> {
  const response = await api.post<PresenceResponse>("/api/voice/presence", {
    state,
    ...(source ? { source } : {}),
  });
  return readPresence(response.data);
}
