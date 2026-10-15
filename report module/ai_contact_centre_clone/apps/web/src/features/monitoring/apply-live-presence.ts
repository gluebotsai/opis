import type { MonitoringSnapshot } from "@/features/monitoring/api";

export type LivePresenceUpdate = {
  userId?: string | null;
  presence?: {
    agentId?: string | null;
    state?: string | null;
    updatedAt?: string | null;
    version?: number | null;
  } | null;
};

/** User ids and agent ids are different sequences and can share a number. */
export function livePresenceHoldKey(kind: "user" | "agent", id: string): string {
  return `${kind}:${id}`;
}

function sameAgent(
  agent: MonitoringSnapshot["agents"][number],
  userId: string,
  agentId: string,
): boolean {
  if (agentId !== "") return agent.agentId === agentId;
  return userId !== "" && agent.id === userId;
}

function withPresenceCounts(snapshot: MonitoringSnapshot, agents: MonitoringSnapshot["agents"]): MonitoringSnapshot {
  return {
    ...snapshot,
    agents,
    summary: {
      ...snapshot.summary,
      readyAgents: agents.filter((agent) => agent.presence === "ready").length,
      loggedInAgents: agents.filter(
        (agent) => agent.presence !== "offline" && agent.presence !== "inactive",
      ).length,
    },
  };
}

/** Patch one monitoring row from a presence event. Other rows and conversation data stay as they are. */
export function applyLivePresenceUpdate(
  snapshot: MonitoringSnapshot,
  update: LivePresenceUpdate,
): MonitoringSnapshot | null {
  const state = update.presence?.state?.trim() ?? "";
  if (!state) return null;
  const userId = update.userId?.trim() ?? "";
  const agentId = update.presence?.agentId?.trim() ?? "";
  if (!userId && !agentId) return null;
  const index = snapshot.agents.findIndex((agent) => sameAgent(agent, userId, agentId));
  if (index < 0) return null;
  const current = snapshot.agents[index];
  if (!current || current.presence === state) return null;
  const agents = snapshot.agents.slice();
  agents[index] = {
    ...current,
    presence: state,
    presenceUpdatedAt: update.presence?.updatedAt ?? new Date().toISOString(),
    loggedIn: state !== "offline" && state !== "inactive",
  };
  return withPresenceCounts(snapshot, agents);
}

export type LivePresenceHold = {
  state: string;
  at: number;
};

/** Keep a presence event on the row until a snapshot reports that same state. */
export function holdLiveAgentPresence(
  snapshot: MonitoringSnapshot,
  live: Map<string, LivePresenceHold>,
): MonitoringSnapshot {
  if (live.size === 0) return snapshot;
  let changed = false;
  const agents = snapshot.agents.map((agent) => {
    const hit =
      live.get(livePresenceHoldKey("agent", agent.agentId)) ??
      live.get(livePresenceHoldKey("user", agent.id));
    if (!hit) return agent;
    if (agent.presence === hit.state) {
      live.delete(livePresenceHoldKey("agent", agent.agentId));
      live.delete(livePresenceHoldKey("user", agent.id));
      return agent;
    }
    changed = true;
    return {
      ...agent,
      presence: hit.state,
      presenceUpdatedAt: new Date(hit.at).toISOString(),
      loggedIn: hit.state !== "offline" && hit.state !== "inactive",
    };
  });
  return changed ? withPresenceCounts(snapshot, agents) : snapshot;
}

/** A slow snapshot must not paint over a presence event that arrived after it was read. */
export function preferNewerAgentPresence(
  previous: MonitoringSnapshot | null,
  next: MonitoringSnapshot,
): MonitoringSnapshot {
  if (!previous) return next;
  let keptNewer = false;
  const agents = next.agents.map((agent) => {
    const prior = previous.agents.find(
      (row) => row.agentId === agent.agentId || row.id === agent.id,
    );
    const priorAt = Date.parse(prior?.presenceUpdatedAt ?? "");
    const nextAt = Date.parse(agent.presenceUpdatedAt ?? "");
    if (!prior || !Number.isFinite(priorAt)) return agent;
    if (Number.isFinite(nextAt) && nextAt >= priorAt) return agent;
    keptNewer = true;
    return {
      ...agent,
      presence: prior.presence,
      presenceUpdatedAt: prior.presenceUpdatedAt,
      loggedIn: prior.loggedIn,
    };
  });
  return keptNewer ? withPresenceCounts(next, agents) : next;
}
