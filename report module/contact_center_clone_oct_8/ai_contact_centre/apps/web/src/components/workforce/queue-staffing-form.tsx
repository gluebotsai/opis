import { useEffect, useMemo, useState } from "react";
import { Plus, UserPlus } from "lucide-react";

import { listRowDividerClassName } from "@/components/ui/list-row";
import { Button } from "@/components/ui/button";
import { MenuSelect } from "@/components/ui/menu-select";
import {
  QueueAgentPickerList,
  QueueMoveAgentDialog,
  otherQueueSubtitle,
  type QueueAgentPickerItem,
} from "@/components/workforce/queue-agent-picker";
import {
  QueueShiftPickerGroup,
  QueueShiftSwitcher,
} from "@/components/workforce/queue-shift-block";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { formatShownContactName } from "@/features/contacts/contacts-utils";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";
import {
  QUEUE_DRAFT_CHANNELS,
  agentDisplayName,
  queueAgentProfile,
  emptyQueueAgent,
  formatClock,
  type BusinessHourShift,
  type EligibleAgent,
  type QueueAgent,
  type QueueDraftChannel,
  type ShiftAgentAssignment,
  type ShiftType,
} from "@/features/workforce/queues/types";

const CHANNEL_DEFS = [
  { key: "handlesCalls" as const, id: "calls" as const, label: "Calls", channel: "voice", concurrencyKey: null },
  { key: "handlesChat" as const, id: "chat" as const, label: "Chat", channel: "chat", concurrencyKey: "chatConcurrency" as const },
  { key: "handlesEmail" as const, id: "email" as const, label: "Email", channel: "email", concurrencyKey: "emailConcurrency" as const },
  { key: "handlesWhatsapp" as const, id: "whatsapp" as const, label: "WhatsApp", channel: "whatsapp", concurrencyKey: "whatsappConcurrency" as const },
  { key: "handlesInstagram" as const, id: "instagram" as const, label: "Instagram", channel: "instagram", concurrencyKey: "instagramConcurrency" as const },
  { key: "handlesFacebook" as const, id: "facebook" as const, label: "Facebook", channel: "facebook", concurrencyKey: "facebookConcurrency" as const },
];

export type QueueStaffingFormPayload = {
  shiftTypes: ShiftType[];
  queueName?: string;
  available: QueueAgentPickerItem[];
  elsewhere: QueueAgentPickerItem[];
  assignments?: Partial<Record<ShiftType, ShiftAgentAssignment>>;
  doneMessage?: string;
};

function eligibleToPickerItem(agent: EligibleAgent): QueueAgentPickerItem {
  return {
    id: agent.id,
    name: agentDisplayName(agent),
    subtitle: agent.workEmail,
    currentQueueId: agent.currentQueueId,
    currentQueueName: agent.currentQueueName,
    currentQueueStatus: agent.currentQueueStatus,
  };
}

function assignedAgentLabel(agent: QueueAgent, namesById: Record<string, string>): string {
  const listed = namesById[String(agent.userId)];
  if (listed) return listed;
  const joined = [agent.firstName, agent.lastName].filter(Boolean).join(" ").trim();
  return joined || agent.userId;
}

export function channelsFromAgent(agent: QueueAgent): QueueDraftChannel[] {
  return CHANNEL_DEFS.filter((channel) => agent[channel.key]).map((channel) => channel.id);
}

export function applyChannelsToAgent(
  agent: QueueAgent,
  channels: QueueDraftChannel[] | "all",
): QueueAgent {
  const selected =
    channels === "all" || channels.length === QUEUE_DRAFT_CHANNELS.length
      ? QUEUE_DRAFT_CHANNELS
      : channels;
  const next = { ...agent };
  for (const channel of CHANNEL_DEFS) {
    next[channel.key] = selected.includes(channel.id);
  }
  return next;
}

export function agentsToAssignments(
  agents: QueueAgent[],
  namesById: Record<string, string>,
): Partial<Record<ShiftType, ShiftAgentAssignment>> {
  const result: Partial<Record<ShiftType, ShiftAgentAssignment>> = {};
  for (const agent of agents) {
    const existing = result[agent.shiftType] ?? { agentIds: [], agentNames: [], channelByAgentId: {} };
    existing.agentIds = [...existing.agentIds, agent.userId];
    existing.agentNames = [...existing.agentNames, assignedAgentLabel(agent, namesById)];
    existing.channelByAgentId = {
      ...(existing.channelByAgentId ?? {}),
      [agent.userId]: channelsFromAgent(agent),
    };
    result[agent.shiftType] = existing;
  }
  return result;
}

export function assignmentsToAgents(
  assignments: Partial<Record<string, ShiftAgentAssignment>> | undefined,
): QueueAgent[] {
  if (!assignments) return [];
  const agents: QueueAgent[] = [];
  for (const [shift, row] of Object.entries(assignments)) {
    if (!row) continue;
    const ids = row.agentIds ?? [];
    ids.forEach((userId, index) => {
      if (!userId) return;
      const name = row.agentNames?.[index];
      const channels =
        row.channelByAgentId?.[userId] ??
        (name ? row.channelByAgentId?.[name] : undefined) ??
        QUEUE_DRAFT_CHANNELS;
      agents.push(applyChannelsToAgent(emptyQueueAgent(userId, shift as ShiftType), channels));
    });
  }
  return agents;
}

export function staffingDoneMessage(
  agents: QueueAgent[],
  namesById: Record<string, string>,
): string {
  if (agents.length === 0) {
    return "We're done staffing. No agents assigned.";
  }
  const byShift = new Map<string, QueueAgent[]>();
  for (const agent of agents) {
    const list = byShift.get(agent.shiftType) ?? [];
    list.push(agent);
    byShift.set(agent.shiftType, list);
  }
  const parts: string[] = [];
  for (const [shift, shiftAgents] of byShift) {
    const people = shiftAgents.map((agent) => {
      const name = assignedAgentLabel(agent, namesById);
      const channels = channelsFromAgent(agent);
      const channelLabel =
        channels.length === 0 || channels.length === QUEUE_DRAFT_CHANNELS.length
          ? "all channels"
          : channels.join(", ");
      return `${name} on ${channelLabel}`;
    });
    parts.push(`Staff ${shift} with ${people.join("; ")}.`);
  }
  return `${parts.join(" ")} Done staffing.`;
}

function summarizeShiftRows(rows: BusinessHourShift[]): string {
  if (rows.length === 0) return "No day rows on this template";
  const first = rows[0];
  if (!first) return "No day rows on this template";
  const days =
    first.endDayOfWeek && first.endDayOfWeek !== first.dayOfWeek
      ? `${first.dayOfWeek.slice(0, 3)}–${first.endDayOfWeek.slice(0, 3)}`
      : rows.length === 1
        ? first.dayOfWeek.slice(0, 3)
        : `${rows.length} days`;
  return `${formatClock(first.startTime)}–${formatClock(first.endTime)} · ${days}${
    first.crossesMidnight ? " · overnight" : ""
  }`;
}

function partitionEligible(
  agents: EligibleAgent[],
  assignedOnShift: Set<string>,
  assignedOnQueue: Set<string>,
) {
  const available: EligibleAgent[] = [];
  const elsewhere: EligibleAgent[] = [];
  for (const agent of agents) {
    if (agent.status !== "active") continue;
    if (assignedOnShift.has(agent.id)) continue;
    if (assignedOnQueue.has(agent.id) || !agent.currentQueueId) {
      available.push(agent);
    } else {
      elsewhere.push(agent);
    }
  }
  return { available, elsewhere };
}

export function QueueStaffingForm({
  queueName,
  shiftTypes,
  shiftRowsByType,
  agents,
  eligibleAgents,
  variant = "chat",
  disabled = false,
  onAgentsChange,
  onSelectShift,
  onDone,
}: {
  queueName: string;
  shiftTypes: ShiftType[];
  shiftRowsByType?: Map<ShiftType, BusinessHourShift[]>;
  agents: QueueAgent[];
  eligibleAgents: EligibleAgent[];
  variant?: "editor" | "chat";
  disabled?: boolean;
  onAgentsChange: (agents: QueueAgent[]) => void;
  onSelectShift?: (shift: ShiftType) => void;
  onDone?: (next: { agents: QueueAgent[]; message: string }) => void;
}) {
  const [activeShift, setActiveShift] = useState<ShiftType | null>(shiftTypes[0] ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<EligibleAgent | null>(null);

  useEffect(() => {
    if (shiftTypes.length === 0) {
      if (activeShift !== null) setActiveShift(null);
      return;
    }
    if (!activeShift || !shiftTypes.includes(activeShift)) {
      setActiveShift(shiftTypes[0] ?? null);
      setPickerOpen(false);
    }
  }, [activeShift, shiftTypes]);

  const namesById = useMemo(
    () =>
      Object.fromEntries(
        eligibleAgents.map((agent) => [String(agent.id), formatShownContactName(agentDisplayName(agent))]),
      ),
    [eligibleAgents],
  );
  const agentById = useMemo(
    () => Object.fromEntries(eligibleAgents.map((agent) => [String(agent.id), agent])),
    [eligibleAgents],
  );
  const assignedOnQueue = useMemo(() => new Set(agents.map((agent) => agent.userId)), [agents]);

  const currentShift = activeShift;
  const shiftAgents = currentShift
    ? agents.filter((agent) => agent.shiftType === currentShift)
    : [];
  const assignedOnShift = new Set(shiftAgents.map((agent) => agent.userId));
  const { available, elsewhere } = currentShift
    ? partitionEligible(eligibleAgents, assignedOnShift, assignedOnQueue)
    : { available: [], elsewhere: [] };
  const candidates = [...available, ...elsewhere];
  const shiftRows = currentShift ? (shiftRowsByType?.get(currentShift) ?? []) : [];

  function addAgent(agent: EligibleAgent) {
    if (!currentShift) return;
    onAgentsChange([...agents, emptyQueueAgent(agent.id, currentShift)]);
    setPickerOpen(false);
    setPendingMove(null);
  }

  function requestAdd(agent: EligibleAgent) {
    if (assignedOnQueue.has(agent.id) || !agent.currentQueueId) {
      addAgent(agent);
      return;
    }
    setPendingMove(agent);
  }

  function updateAgent(userId: string, shiftType: ShiftType, patch: Partial<QueueAgent>) {
    onAgentsChange(
      agents.map((agent) =>
        agent.userId === userId && agent.shiftType === shiftType ? { ...agent, ...patch } : agent,
      ),
    );
  }

  function removeAgent(userId: string, shiftType: ShiftType) {
    onAgentsChange(
      agents.filter((agent) => !(agent.userId === userId && agent.shiftType === shiftType)),
    );
  }

  if (shiftTypes.length === 0 || !currentShift) {
    return (
      <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
        <p className="text-sm font-medium text-neutral-800">No shifts on this schedule</p>
        <p className="mt-1 text-sm text-neutral-600">
          Choose business hours first to assign people and channels.
        </p>
      </div>
    );
  }

  return (
    <div>
      <QueueShiftSwitcher
        shifts={shiftTypes.map((shiftType) => ({
          type: shiftType,
          agentCount: agents.filter((agent) => agent.shiftType === shiftType).length,
        }))}
        value={currentShift}
        onChange={(shift) => {
          setActiveShift(shift);
          setPickerOpen(false);
          setPendingMove(null);
          onSelectShift?.(shift);
        }}
      />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{currentShift}</p>
          {shiftRows.length > 0 ? (
            <p className="mt-0.5 text-sm text-neutral-600">{summarizeShiftRows(shiftRows)}</p>
          ) : (
            <p className="mt-0.5 text-sm text-neutral-600">
              Add people and set the channels they handle.
            </p>
          )}
        </div>
        {pickerOpen ? (
          <Button
            variant="secondary"
            className="shrink-0 px-2.5"
            disabled={disabled}
            onClick={() => {
              setPickerOpen(false);
              setPendingMove(null);
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button
            className="shrink-0 px-2.5"
            disabled={disabled || candidates.length === 0}
            onClick={() => {
              setPendingMove(null);
              setPickerOpen(true);
            }}
          >
            <UserPlus className="size-3.5" />
            Add
          </Button>
        )}
      </div>

      <div className="mt-3">
        {pickerOpen ? (
          candidates.length === 0 ? (
            <p className="py-2 text-sm text-neutral-400">No more eligible agents for this shift.</p>
          ) : variant === "editor" ? (
            <div className="space-y-4">
              {available.length > 0 ? (
                <QueueShiftPickerGroup label="Available">
                  {available.map((agent) => (
                    <li key={agent.id} className={listRowDividerClassName()}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => requestAdd(agent)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-neutral-900">
                            {agentDisplayName(agent)}
                          </span>
                          <span className="block truncate text-sm text-neutral-600">
                            {agent.workEmail}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-neutral-900" />
                      </button>
                    </li>
                  ))}
                </QueueShiftPickerGroup>
              ) : null}
              {elsewhere.length > 0 ? (
                <QueueShiftPickerGroup label="On another queue">
                  {elsewhere.map((agent) => (
                    <li key={agent.id} className={listRowDividerClassName()}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => requestAdd(agent)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-neutral-900">
                            {agentDisplayName(agent)}
                          </span>
                          <span className="block truncate text-sm text-neutral-600">
                            {otherQueueSubtitle(eligibleToPickerItem(agent)) ?? agent.workEmail}
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-neutral-900">
                          Move
                        </span>
                      </button>
                    </li>
                  ))}
                </QueueShiftPickerGroup>
              ) : null}
            </div>
          ) : (
            <QueueAgentPickerList
              available={available.map(eligibleToPickerItem)}
              elsewhere={elsewhere.map(eligibleToPickerItem)}
              disabled={disabled}
              onAdd={(item) => {
                const agent = agentById[item.id];
                if (agent) requestAdd(agent);
              }}
              onMove={(item) => {
                const agent = agentById[item.id];
                if (agent) setPendingMove(agent);
              }}
            />
          )
        ) : shiftAgents.length === 0 ? (
          <p className="py-2 text-sm text-neutral-400">No agents assigned yet.</p>
        ) : (
          <div>
            {shiftAgents.map((agent) => (
              <StaffedAgentRow
                key={`${agent.userId}-${agent.shiftType}`}
                agent={agent}
                profile={queueAgentProfile(agent, agentById)}
                detailed={variant === "editor"}
                disabled={disabled}
                onUpdate={(patch) => updateAgent(agent.userId, agent.shiftType, patch)}
                onRemove={() => removeAgent(agent.userId, agent.shiftType)}
              />
            ))}
          </div>
        )}
      </div>

      {variant === "chat" && onDone ? (
        <div className="mt-4">
          <Button
            disabled={disabled}
            className="w-full"
            onClick={() =>
              onDone({
                agents,
                message: staffingDoneMessage(agents, namesById),
              })
            }
          >
            Done staffing
          </Button>
        </div>
      ) : null}

      <QueueMoveAgentDialog
        agent={pendingMove ? eligibleToPickerItem(pendingMove) : null}
        destinationName={queueName.trim() || "this queue"}
        onClose={() => setPendingMove(null)}
        onConfirm={() => {
          if (!pendingMove) return;
          addAgent(pendingMove);
        }}
      />
    </div>
  );
}

function StaffedAgentRow({
  agent,
  profile,
  detailed,
  disabled,
  onUpdate,
  onRemove,
}: {
  agent: QueueAgent;
  profile?: EligibleAgent;
  detailed: boolean;
  disabled?: boolean;
  onUpdate: (patch: Partial<QueueAgent>) => void;
  onRemove: () => void;
}) {
  const rawName = profile ? agentDisplayName(profile) : agent.userId;
  const name = formatShownContactName(rawName);

  return (
    <div className={cn("px-2.5 py-3", listRowDividerClassName())}>
      <div className="flex items-start gap-3">
        <div className={profileAvatarClassName(agent.userId, "size-10 shrink-0 text-xs")}>
          {profileInitials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{name}</p>
              <p className="truncate text-sm text-neutral-600">
                {profile?.workEmail ?? "Unknown email"}
              </p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
            >
              Remove
            </button>
          </div>

          <p className="mt-3 text-sm">
            <span className="font-medium text-neutral-900">Channels</span>
            <span className="text-[12px] font-normal text-neutral-400">
              {" "}
              · Click a channel to give the agent access
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {CHANNEL_DEFS.map((channel) => {
              const active = agent[channel.key];
              const capacityKey = channel.concurrencyKey;
              return (
                <div
                  key={channel.key}
                  className={cn(
                    "inline-flex h-[38px] overflow-hidden rounded-lg border-[0.6px] border-[#bfbfbf]",
                    active ? "bg-neutral-100" : "bg-white",
                  )}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onUpdate({ [channel.key]: !active })}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-full items-center gap-2 px-2.5 text-sm font-medium transition",
                      active
                        ? "text-neutral-900"
                        : "text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600",
                      disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <WorkspaceChannelIcon
                      channel={channel.channel}
                      className="size-6 rounded-lg shadow-none"
                    />
                    {channel.label}
                  </button>
                  {detailed && active && capacityKey ? (
                    <input
                      type="number"
                      min={1}
                      title="Capacity"
                      value={agent[capacityKey]}
                      onChange={(event) =>
                        onUpdate({
                          [capacityKey]: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                      className="h-full w-14 border-l-[0.6px] border-[#bfbfbf] bg-white text-center text-sm tabular-nums text-neutral-800 outline-none focus:ring-2 focus:ring-neutral-200"
                      aria-label={`${channel.label} capacity`}
                    />
                  ) : null}
                  {detailed && active && channel.key === "handlesCalls" ? (
                    <div className="flex h-full">
                      <MenuSelect
                        value={agent.callType}
                        ariaLabel="Call type"
                        options={[
                          { value: "both", label: "Inbound & outbound" },
                          { value: "inbound", label: "Inbound only" },
                          { value: "outbound", label: "Outbound only" },
                        ]}
                        onChange={(callType) => onUpdate({ callType })}
                        className="h-full w-[13.5rem] rounded-none border-0 border-l-[0.6px] border-[#bfbfbf] bg-white shadow-none ring-0 hover:bg-white focus:border-[#bfbfbf] focus:bg-white focus:ring-0"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!detailed ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onUpdate(applyChannelsToAgent(agent, "all"))}
              className="mt-2 text-sm font-medium text-neutral-900 hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              All channels
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function payloadEligibleAgents(payload: QueueStaffingFormPayload): EligibleAgent[] {
  const rows = [...payload.available, ...payload.elsewhere];
  return rows.map((item) => {
    const [firstName, ...rest] = item.name.trim().split(/\s+/);
    return {
      id: item.id,
      firstName: firstName ?? item.name,
      lastName: rest.join(" "),
      workEmail: item.subtitle,
      teamId: null,
      skill: null,
      skills: [],
      status: "active",
      businessHoursId: null,
      shiftTypes: payload.shiftTypes,
      currentQueueId: item.currentQueueId,
      currentQueueName: item.currentQueueName,
      currentQueueStatus: item.currentQueueStatus,
    };
  });
}
