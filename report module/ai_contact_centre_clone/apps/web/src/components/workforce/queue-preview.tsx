import { useEffect, useMemo, useState, type ReactNode } from "react";

import { listRowDividerClassName } from "@/components/ui/list-row";
import { QueueShiftSwitcher } from "@/components/workforce/queue-shift-block";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { formatContactDate, formatShownContactName } from "@/features/contacts/contacts-utils";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";
import {
  MISSED_CALLBACK_GRACE_OPTIONS,
  agentDisplayName,
  formatClock,
  graceMinutesToOption,
  queueAgentProfile,
  queueDisplayShiftTypes,
  type BusinessHourShift,
  type BusinessHours,
  type EligibleAgent,
  type Queue,
  type QueueAgent,
  type ShiftType,
  type Team,
} from "@/features/workforce/queues/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

const EMPTY_FACT = "—";

function formatFactValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY_FACT;
}

function DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-none">
      <div>
        <p className="text-base font-semibold text-neutral-900">{title}</p>
        {description ? <p className="mt-0.5 text-sm text-neutral-600">{description}</p> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DetailFact({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  const empty = value === EMPTY_FACT;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <p className="text-[12px] text-neutral-600">{label}</p>
      {children ?? (
        <p
          className={cn(
            "text-sm font-semibold",
            empty ? "text-neutral-400" : "text-neutral-900",
            "truncate",
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

const SHIFT_AGENT_LIST_MAX_VISIBLE = 10;
const SHIFT_AGENT_ROW_HEIGHT_PX = 92;

const channelLabels: { key: keyof QueueAgent; label: string; channel: string }[] = [
  { key: "handlesCalls", label: "Calls", channel: "voice" },
  { key: "handlesChat", label: "Chat", channel: "chat" },
  { key: "handlesEmail", label: "Email", channel: "email" },
  { key: "handlesWhatsapp", label: "WhatsApp", channel: "whatsapp" },
  { key: "handlesInstagram", label: "Instagram", channel: "instagram" },
  { key: "handlesFacebook", label: "Facebook", channel: "facebook" },
];

function ShiftAgentRow({
  agent,
  profile,
}: {
  agent: QueueAgent;
  profile?: EligibleAgent;
}) {
  const rawName = profile ? agentDisplayName(profile) : agent.userId;
  const name = formatShownContactName(rawName);
  const activeChannels = channelLabels.filter(({ key }) => agent[key]);

  return (
    <li className={cn("rounded-xl px-1 py-2.5", listRowDividerClassName())}>
      <div className="flex items-start gap-3">
        <div className={profileAvatarClassName(agent.userId, "size-10 shrink-0 text-xs")}>
          {profileInitials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{name}</p>
          <p className="truncate text-sm text-neutral-600">{profile?.workEmail ?? "Unknown email"}</p>
          {activeChannels.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {activeChannels.map(({ key, label, channel }) => (
                <span key={key} title={label} className="inline-flex">
                  <WorkspaceChannelIcon
                    channel={channel}
                    className="size-6 rounded-lg shadow-none"
                  />
                  <span className="sr-only">{label}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-neutral-400">No channels enabled</p>
          )}
        </div>
      </div>
    </li>
  );
}

function ShiftAgentsPanel({
  shiftTypes,
  shiftsByType,
  agents,
  agentById,
}: {
  shiftTypes: ShiftType[];
  shiftsByType: Map<ShiftType, BusinessHourShift[]>;
  agents: QueueAgent[];
  agentById: Record<string, EligibleAgent>;
}) {
  const [activeShift, setActiveShift] = useState<ShiftType>(shiftTypes[0] ?? "Regular");

  useEffect(() => {
    if (shiftTypes.length === 0) return;
    if (!shiftTypes.includes(activeShift)) {
      setActiveShift(shiftTypes[0] ?? "Regular");
    }
  }, [activeShift, shiftTypes]);

  const shiftType = shiftTypes.includes(activeShift) ? activeShift : (shiftTypes[0] ?? activeShift);
  const rows = shiftsByType.get(shiftType) ?? [];
  const shiftAgents = agents.filter((agent) => agent.shiftType === shiftType);

  return (
    <div>
      <QueueShiftSwitcher
        shifts={shiftTypes.map((type) => ({
          type,
          agentCount: agents.filter((agent) => agent.shiftType === type).length,
        }))}
        value={shiftType}
        onChange={setActiveShift}
      />
      <div className="mt-4">
        <p className="text-sm font-semibold text-neutral-900">{shiftType}</p>
        <p className="mt-0.5 text-sm text-neutral-600">{summarizeShiftRows(rows)}</p>
      </div>
      {shiftAgents.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">No agents assigned.</p>
      ) : (
        <ul
          className="panel-scroll-native mt-3 overflow-y-auto overscroll-contain"
          style={{ maxHeight: SHIFT_AGENT_LIST_MAX_VISIBLE * SHIFT_AGENT_ROW_HEIGHT_PX }}
        >
          {shiftAgents.map((agent) => (
            <ShiftAgentRow
              key={`${agent.userId}-${shiftType}`}
              agent={agent}
              profile={queueAgentProfile(agent, agentById)}
            />
          ))}
        </ul>
      )}
    </div>
  );
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

type QueuePreviewProps = {
  queue: Queue;
  team?: Team | null;
  schedule?: BusinessHours | null;
  eligibleAgents: EligibleAgent[];
  togglingStatus?: boolean;
  onToggleStatus?: (status: "active" | "inactive") => void;
};

export function QueuePreview({
  queue,
  team,
  schedule,
  eligibleAgents,
  togglingStatus = false,
  onToggleStatus,
}: QueuePreviewProps) {
  const agentById = useMemo(
    () => Object.fromEntries(eligibleAgents.map((agent) => [String(agent.id), agent])),
    [eligibleAgents],
  );

  const previewShiftTypes = useMemo(
    () => queueDisplayShiftTypes(schedule?.shifts ?? []),
    [schedule],
  );

  const graceLabel =
    MISSED_CALLBACK_GRACE_OPTIONS.find(
      (option) => option.value === graceMinutesToOption(queue.missedCallbackGraceMinutes),
    )?.label ?? "Off";

  const shiftsByType = useMemo(() => {
    const map = new Map<ShiftType, BusinessHourShift[]>();
    if (!schedule) return map;
    for (const shift of schedule.shifts) {
      const list = map.get(shift.shiftType) ?? [];
      list.push(shift);
      map.set(shift.shiftType, list);
    }
    return map;
  }, [schedule]);

  const uniqueAgentCount = new Set(queue.agents.map((agent) => agent.userId)).size;
  const queueName = formatShownContactName(queue.name);
  const description = queue.description ? formatShownContactName(queue.description) : "";
  const teamName = team?.name ? formatShownContactName(team.name) : "";
  const skillsLabel =
    queue.skills.length > 0
      ? queue.skills.map((skill) => formatShownContactName(skill)).join(", ")
      : "None required";
  const scheduleWindow = schedule
    ? `${formatClock(schedule.openTime)} – ${formatClock(schedule.closeTime)} · ${schedule.workingDays.map((day) => day.slice(0, 3)).join(", ")}`
    : "";

  return (
    <div className="space-y-[16px]">
      <div className="flex items-center gap-3">
        <div className={profileAvatarClassName(queue.id, "size-12 shrink-0 text-sm")}>
          {profileInitials(queueName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[18px] font-semibold text-neutral-900">{queueName}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                queue.status === "active"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-neutral-100 text-neutral-600",
              )}
            >
              {queue.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>
          {description ? (
            <p className="mt-0.5 truncate text-sm text-neutral-600">{description}</p>
          ) : null}
        </div>
      </div>

      <DetailSection title="Details" description="Routing, hours, and recovery">
        <div className="grid grid-cols-1 gap-x-6 gap-y-[14px] sm:grid-cols-2">
          <DetailFact label="Team" value={formatFactValue(teamName)} />
          <DetailFact label="Skills" value={formatFactValue(skillsLabel)} />
          <DetailFact label="Business hours" value={formatFactValue(schedule?.name)} />
          <DetailFact label="Hours window" value={formatFactValue(scheduleWindow)} />
          <DetailFact label="Proactive recovery" value={formatFactValue(graceLabel)} />
          <DetailFact
            label="Total agents"
            value={String(uniqueAgentCount)}
          />
        </div>
      </DetailSection>

      <DetailSection title="System" description="Queue status and lifecycle">
        <div className="grid grid-cols-1 gap-x-6 gap-y-[14px] sm:grid-cols-2">
          <DetailFact label="Status">
            <StatusToggle
              checked={queue.status === "active"}
              disabled={togglingStatus || !onToggleStatus}
              compact
              showLabel
              onChange={(status) => onToggleStatus?.(status)}
            />
          </DetailFact>
          <DetailFact label="Created" value={formatContactDate(queue.createdAt)} />
          <DetailFact label="Updated" value={formatContactDate(queue.updatedAt)} />
        </div>
      </DetailSection>

      <DetailSection title="Shifts & agents" description="Who covers this queue and on which channels">
        {previewShiftTypes.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
            <p className="text-sm font-medium text-neutral-800">No shifts on this hours template</p>
            <p className="mt-1 text-sm text-neutral-600">
              Add shift rows to the selected business hours to staff this queue.
            </p>
          </div>
        ) : (
          <ShiftAgentsPanel
            shiftTypes={previewShiftTypes}
            shiftsByType={shiftsByType}
            agents={queue.agents}
            agentById={agentById}
          />
        )}
      </DetailSection>
    </div>
  );
}
