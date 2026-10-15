import type {
  QueueDraft,
  QueueDraftChannel,
  ShiftType,
} from "@/features/workforce/queues/types";

/**
 * Deterministic preview helpers for structured queue drafts emitted by NLP.
 * Free-form user language is interpreted by the LLM, never in this module.
 */
export function getAgentChannels(
  draft: QueueDraft,
  agentId: string,
  shift?: ShiftType,
  agentName?: string,
): QueueDraftChannel[] {
  const lookup = (map?: Partial<Record<string, QueueDraftChannel[]>>) => {
    if (!map) return undefined;
    if (agentId && map[agentId]) return map[agentId];
    if (agentName && map[agentName]) return map[agentName];
    return undefined;
  };

  if (shift) {
    const channels = lookup(draft.shiftAgentAssignments?.[shift]?.channelByAgentId);
    if (channels) return channels;
  }
  for (const shiftType of draft.shiftTypes ?? []) {
    const channels = lookup(draft.shiftAgentAssignments?.[shiftType]?.channelByAgentId);
    if (channels) return channels;
  }
  return draft.channels ?? [];
}

export function toggleAgentChannel(
  draft: QueueDraft,
  shift: ShiftType,
  agentId: string,
  channel: QueueDraftChannel,
): QueueDraft {
  const assignments = { ...(draft.shiftAgentAssignments ?? {}) };
  const assignment = assignments[shift];
  if (!assignment) return draft;

  const current = getAgentChannels(draft, agentId, shift);
  const next = current.includes(channel)
    ? current.filter((item) => item !== channel)
    : [...current, channel];

  assignments[shift] = {
    ...assignment,
    channelByAgentId: {
      ...(assignment.channelByAgentId ?? {}),
      [agentId]: next,
    },
  };

  return { ...draft, shiftAgentAssignments: assignments };
}

export function getRemainingShifts(draft: QueueDraft): ShiftType[] {
  const assignments = draft.shiftAgentAssignments ?? {};
  return (draft.shiftTypes ?? []).filter((shift) => assignments[shift] === undefined);
}
