/** Contact Center roles that can be assigned to a queue. */
export const CONTACT_CENTER_STAFF_ROLES = ["agent", "admin"] as const;

export function isContactCenterStaffRole(name: string | null | undefined): boolean {
  const normalized = name?.trim().toLowerCase();
  return (CONTACT_CENTER_STAFF_ROLES as readonly string[]).includes(normalized ?? "");
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function agentSkillsFromUser(skills: unknown, skill: string | null): string[] {
  const fromJson = asStringArray(skills);
  if (fromJson.length > 0) return fromJson;
  if (skill?.trim()) {
    return skill
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

export function skillsOverlap(queueSkills: string[], agentSkills: string[]): boolean {
  if (queueSkills.length === 0) return true;
  const normalized = new Set(agentSkills.map((s) => s.toLowerCase()));
  return queueSkills.some((skill) => normalized.has(skill.toLowerCase()));
}

/** Add queue-required skills to an agent when an admin assigns them to that queue. */
export function mergeAgentSkillsForQueue(agentSkills: string[], queueSkills: string[]): string[] {
  if (queueSkills.length === 0 || skillsOverlap(queueSkills, agentSkills)) {
    return agentSkills;
  }
  const normalized = new Set(agentSkills.map((skill) => skill.toLowerCase()));
  return [
    ...agentSkills,
    ...queueSkills.filter((skill) => !normalized.has(skill.toLowerCase())),
  ];
}

export type QueueAgentCallType = "inbound" | "outbound" | "both";

/** Maps UI call type to accounts.setup_ccaas_queue_agents direction flags (call_flags_chk). */
export function callDirectionFlagsFromAgent(
  handlesCalls: boolean,
  callType: QueueAgentCallType,
): {
  handlesInbound: boolean;
  handlesOutbound: boolean;
  handlesOutboundCampaign: boolean;
} {
  if (!handlesCalls) {
    return {
      handlesInbound: false,
      handlesOutbound: false,
      handlesOutboundCampaign: false,
    };
  }
  return {
    handlesInbound: callType === "inbound" || callType === "both",
    handlesOutbound: callType === "outbound" || callType === "both",
    handlesOutboundCampaign: false,
  };
}
