import { useEffect, useRef } from "react";
import { Check, Circle, PanelRightClose, Sparkles } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";
import { contentPanel } from "@/lib/panel-chrome";
import {
  getAgentChannels,
  getRemainingShifts,
  toggleAgentChannel,
} from "@/features/assistant/guided-queue-conversation";
import { ASSISTANT_COWORKER_REQUEST } from "@/features/assistant/assistant-api";
import { parseQueueStaffingForm } from "@/features/assistant/queue-guided-draft";
import { useQueueDraft } from "@/features/workforce/queues/queue-draft-context";
import type { QueueDraft, QueueDraftChannel, ShiftType } from "@/features/workforce/queues/types";
import { QUEUE_DRAFT_CHANNELS, agentDisplayName } from "@/features/workforce/queues/types";
import { formatShownContactName } from "@/features/contacts/contacts-utils";
import {
  QueueStaffingForm,
  agentsToAssignments,
  assignmentsToAgents,
  payloadEligibleAgents,
} from "@/components/workforce/queue-staffing-form";

type StepState = "done" | "current" | "pending";

type PreviewStep = {
  id: string;
  label: string;
  state: StepState;
  kind: "simple" | "workforce";
  value?: string;
};

type ChannelKey = QueueDraftChannel;

const CHANNEL_META: Record<ChannelKey, { label: string }> = {
  calls: { label: "Calls" },
  email: { label: "Email" },
  chat: { label: "Chat" },
  whatsapp: { label: "WhatsApp" },
  instagram: { label: "Instagram" },
  facebook: { label: "Facebook" },
};

function workforceDone(draft: QueueDraft) {
  if (draft.staffingComplete || draft.staffingSkipped) return true;
  if (draft.ready === true) return true;
  if (draft.channels !== undefined && !workforceCurrent(draft)) return true;
  if (draft.selectedAgentIds !== undefined && draft.selectedAgentIds.length === 0) {
    return getRemainingShifts(draft).length === 0;
  }
  return false;
}

function workforceCurrent(draft: QueueDraft) {
  return (
    draft.question === "staffing" ||
    draft.question === "staffing-mode" ||
    draft.question === "shift-agents" ||
    draft.question === "agent-channels" ||
    draft.question === "add-another-agent" ||
    draft.question === "channels"
  );
}

function buildSteps(draft: QueueDraft): PreviewStep[] {
  const question = draft.question;
  const workforceComplete = workforceDone(draft);
  const workforceActive = workforceCurrent(draft);

  const stepComplete = (_fieldQuestion: QueueDraft["question"], hasValue: boolean) => hasValue;
  const stepCurrent = (fieldQuestion: QueueDraft["question"], hasValue: boolean) =>
    question === fieldQuestion && !hasValue;

  const items: Array<Omit<PreviewStep, "state"> & { done: boolean; current: boolean }> = [
    {
      id: "name",
      label: "Queue name",
      kind: "simple",
      value: draft.name,
      done: stepComplete("name", Boolean(draft.name?.trim())),
      current: stepCurrent("name", Boolean(draft.name?.trim())),
    },
    {
      id: "team",
      label: "Team",
      kind: "simple",
      value: draft.teamName,
      done: stepComplete("team", Boolean(draft.teamId || draft.teamName?.trim())),
      current: stepCurrent("team", Boolean(draft.teamId || draft.teamName?.trim())),
    },
    {
      id: "description",
      label: "Description",
      kind: "simple",
      value: draft.description === undefined ? undefined : draft.description || "—",
      done: stepComplete("description", draft.description !== undefined),
      current: stepCurrent("description", draft.description !== undefined),
    },
    {
      id: "status",
      label: "Status",
      kind: "simple",
      value: draft.status ? (draft.status === "active" ? "Active" : "Inactive") : undefined,
      done: stepComplete("status", Boolean(draft.status)),
      current: stepCurrent("status", Boolean(draft.status)),
    },
    {
      id: "hours",
      label: "Business hours",
      kind: "simple",
      value: draft.businessHoursName,
      done: stepComplete(
        "business-hours",
        draft.businessHoursId !== undefined || Boolean(draft.businessHoursName?.trim()),
      ),
      current: stepCurrent(
        "business-hours",
        draft.businessHoursId !== undefined || Boolean(draft.businessHoursName?.trim()),
      ),
    },
    {
      id: "shifts",
      label: "Shifts",
      kind: "simple",
      value: draft.shiftTypes?.join(", "),
      done: Boolean(draft.shiftTypes?.length),
      current: stepCurrent("shifts", Boolean(draft.shiftTypes?.length)),
    },
    {
      id: "workforce",
      label: "Agents & channels",
      kind: "workforce",
      done: workforceComplete,
      current: workforceActive,
    },
    {
      id: "review",
      label: "Create queue",
      kind: "simple",
      value: draft.ready === true ? "Say “create queue” to publish" : undefined,
      done: false,
      current: draft.ready === true,
    },
  ];

  return items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    value: item.value,
    state: item.current ? "current" : item.done ? "done" : "pending",
  }));
}

function progressFromSteps(items: PreviewStep[]) {
  const done = items.filter((item) => item.state === "done").length;
  return Math.round((done / items.length) * 100);
}

function PathIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-neutral-900/25" />
        <span className="relative size-4 rounded-full border-2 border-neutral-900 bg-white" />
      </span>
    );
  }
  return <Circle className="size-4 shrink-0 text-neutral-300" />;
}

function ChannelChip({
  channel,
  index,
  active = true,
  editable = false,
  onToggle,
}: {
  channel: ChannelKey;
  index: number;
  active?: boolean;
  editable?: boolean;
  onToggle?: () => void;
}) {
  const meta = CHANNEL_META[channel];
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition duration-300",
    active
      ? "border-violet-200 bg-violet-50 text-violet-700"
      : "border-neutral-200 bg-white text-neutral-400",
    editable && "cursor-pointer hover:border-violet-300 hover:bg-violet-50/80",
  );

  const content = (
    <>
      <WorkspaceChannelIcon channel={channel} className="size-3.5" />
      {meta.label}
    </>
  );

  if (editable && onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn("animate-in fade-in zoom-in-95", className)}
        style={{ animationDelay: `${index * 45}ms`, animationFillMode: "both" }}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={cn("animate-in fade-in zoom-in-95", className)}
      style={{ animationDelay: `${index * 45}ms`, animationFillMode: "both" }}
    >
      {content}
    </span>
  );
}

function AgentBlock({
  name,
  agentId,
  shift,
  draft,
  editable,
  onToggleChannel,
  index,
}: {
  name: string;
  agentId: string;
  shift: ShiftType;
  draft: QueueDraft;
  editable: boolean;
  onToggleChannel: (channel: ChannelKey) => void;
  index: number;
}) {
  const channels = getAgentChannels(draft, agentId, shift, name);

  return (
    <div
      className="animate-in fade-in slide-in-from-left-1 flex min-w-0 flex-col gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-gradient-to-br from-white to-neutral-50/80 px-2.5 py-2 shadow-sm duration-300"
      style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
    >
      <div className="flex items-center gap-2.5">
        <span className={profileAvatarClassName(agentId, "size-8 text-[11px] tracking-tight")}>
          {profileInitials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-neutral-900">{name}</p>
          <p className="text-[10px] text-neutral-400">Queue agent</p>
        </div>
      </div>

      {channels.length > 0 || editable ? (
        <div className="flex flex-wrap gap-1 border-t-[0.6px] border-[#bfbfbf] pt-2">
          {editable
            ? QUEUE_DRAFT_CHANNELS.map((channel, channelIndex) => (
                <ChannelChip
                  key={channel}
                  channel={channel}
                  index={channelIndex}
                  active={channels.includes(channel)}
                  editable
                  onToggle={() => onToggleChannel(channel)}
                />
              ))
            : channels.map((channel, channelIndex) => (
                <ChannelChip key={channel} channel={channel} index={channelIndex} />
              ))}
        </div>
      ) : (
        <p className="border-t-[0.6px] border-[#bfbfbf] pt-2 text-[10px] text-neutral-400">
          No channels selected
        </p>
      )}
    </div>
  );
}

function WorkforceSummary({ draft, editable, onToggleChannel }: WorkforceSummaryProps) {
  const assignments = draft.shiftAgentAssignments;
  const shifts = draft.shiftTypes ?? [];

  if (assignments && shifts.length > 0) {
    return (
      <div className="space-y-2.5">
        {shifts.map((shift) => {
          const shiftAgents = assignments[shift];
          return (
            <div key={shift} className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white/90 px-3 py-2.5">
              <p className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
                {shift}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2">
                {shiftAgents?.agentNames?.length ? (
                  shiftAgents.agentNames.map((name, index) => (
                    <AgentBlock
                      key={`${shift}-${name}`}
                      name={name}
                      agentId={shiftAgents.agentIds[index] ?? ""}
                      shift={shift}
                      draft={draft}
                      editable={editable}
                      onToggleChannel={(channel) =>
                        onToggleChannel(shift, shiftAgents.agentIds[index] ?? "", channel)
                      }
                      index={index}
                    />
                  ))
                ) : (
                  <span className="col-span-full text-xs text-neutral-600">No agents</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const agents = draft.selectedAgentNames ?? [];
  const agentIds = draft.selectedAgentIds ?? [];
  const fallbackShift = draft.shiftTypes?.[0] ?? "Regular";

  return (
    <div className="grid grid-cols-1 gap-2">
      {agents.length > 0 ? (
        agents.map((name, index) => (
          <AgentBlock
            key={name}
            name={name}
            agentId={agentIds[index] ?? ""}
            shift={fallbackShift}
            draft={draft}
            editable={editable}
            onToggleChannel={(channel) =>
              onToggleChannel(fallbackShift, agentIds[index] ?? "", channel)
            }
            index={index}
          />
        ))
      ) : (
        <span className="col-span-full text-xs text-neutral-600">No agents assigned</span>
      )}
    </div>
  );
}

type WorkforceSummaryProps = {
  draft: QueueDraft;
  editable: boolean;
  onToggleChannel: (shift: ShiftType, agentId: string, channel: ChannelKey) => void;
};

function CurrentWorkforceCard({ draft }: { draft: QueueDraft }) {
  const { applyDraftEvent } = useQueueDraft();
  const form = parseQueueStaffingForm(draft);
  const shiftTypes = form?.shiftTypes ?? draft.shiftTypes ?? [];
  const agents = assignmentsToAgents(form?.assignments ?? draft.shiftAgentAssignments);
  const eligibleAgents = form ? payloadEligibleAgents(form) : [];
  const namesById = Object.fromEntries(
    eligibleAgents.map((agent) => [agent.id, formatShownContactName(agentDisplayName(agent))]),
  );

  return (
    <div className="animate-in fade-in slide-in-from-top-2 space-y-2 duration-500">
      <p className="text-sm font-semibold text-neutral-900">Shifts & agents</p>
      <p className="text-xs text-neutral-600">
        Add people to each shift, choose their channels, then click Done staffing.
      </p>
      <QueueStaffingForm
        variant="chat"
        queueName={form?.queueName ?? draft.name ?? ""}
        shiftTypes={shiftTypes}
        agents={agents}
        eligibleAgents={eligibleAgents}
        onAgentsChange={(next) =>
          applyDraftEvent({
            ...draft,
            shiftAgentAssignments: agentsToAssignments(next, namesById),
          })
        }
        onDone={({ agents: nextAgents, message }) => {
          applyDraftEvent({
            ...draft,
            shiftAgentAssignments: agentsToAssignments(nextAgents, namesById),
            staffingComplete: true,
            staffingSkipped: nextAgents.length === 0,
          });
          window.dispatchEvent(
            new CustomEvent(ASSISTANT_COWORKER_REQUEST, { detail: { message } }),
          );
        }}
      />
    </div>
  );
}

function ChoiceList({ label, choices }: { label?: string; choices: string[] }) {
  return (
    <ul className="space-y-1">
      <li className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
        {label ?? "Available options"}
      </li>
      {choices.map((choice) => (
        <li
          key={choice}
          className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 py-1.5 text-xs text-neutral-700"
        >
          {choice}
        </li>
      ))}
    </ul>
  );
}

function CompletedRow({
  step,
  draft,
  index,
  channelsEditable,
  onToggleChannel,
}: {
  step: PreviewStep;
  draft: QueueDraft;
  index: number;
  channelsEditable: boolean;
  onToggleChannel: (shift: ShiftType, agentId: string, channel: ChannelKey) => void;
}) {
  if (step.kind === "workforce") {
    return (
      <li
        className="animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-gradient-to-br from-neutral-50 to-white p-3 shadow-none duration-500"
        style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
      >
        <div className="mb-2.5 flex items-center gap-2">
          <PathIcon state="done" />
          <p className="text-[11px] font-semibold tracking-wide text-neutral-600 uppercase">
            {step.label}
          </p>
        </div>
        <WorkforceSummary
          draft={draft}
          editable={channelsEditable}
          onToggleChannel={onToggleChannel}
        />
      </li>
    );
  }

  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 shadow-none duration-400"
      style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
    >
      <PathIcon state="done" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-600">{step.label}</p>
        <p className="line-clamp-2 text-sm font-medium text-neutral-900">{step.value || "—"}</p>
      </div>
    </li>
  );
}

export function GuidedQueueDraftPreview({
  draft,
  onClose,
}: {
  draft: QueueDraft;
  onClose: () => void;
}) {
  const { applyDraftEvent } = useQueueDraft();
  const channelsEditable =
    draft.staffingComplete === true ||
    draft.channels !== undefined ||
    draft.question === "review";

  function handleToggleChannel(shift: ShiftType, agentId: string, channel: ChannelKey) {
    if (!agentId || !channelsEditable) return;
    applyDraftEvent(toggleAgentChannel(draft, shift, agentId, channel));
  }

  const steps = buildSteps(draft);
  const progress = progressFromSteps(steps);
  const current = steps.find((item) => item.state === "current");
  const upcoming = steps.filter((item) => item.state === "pending");
  const completed = steps.filter((item) => item.state === "done");
  const completedEndRef = useRef<HTMLDivElement>(null);
  const prevCompletedCountRef = useRef(0);

  useEffect(() => {
    if (completed.length <= prevCompletedCountRef.current) {
      prevCompletedCountRef.current = completed.length;
      return;
    }

    const delay = Math.min((completed.length - 1) * 70 + 80, 500);
    const timer = window.setTimeout(() => {
      completedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, delay);

    prevCompletedCountRef.current = completed.length;
    return () => window.clearTimeout(timer);
  }, [completed.length]);

  return (
    <div className={contentPanel("animate-in fade-in duration-500")}>
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] bg-gradient-to-br from-white via-white to-neutral-50 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[18px] font-semibold text-neutral-900">Queue setup</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PanelExpandButton side="right" />
            <IconButton onClick={onClose} aria-label="Close setup">
              <PanelRightClose className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-sm text-neutral-600">
            <span className="font-medium text-neutral-700">{progress}% complete</span>
            <span>
              {completed.length} done · {upcoming.length + (current ? 1 : 0)} left
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-neutral-200">
            {progress < 100 ? (
              <div className="guided-progress-remaining pointer-events-none absolute inset-0" aria-hidden />
            ) : null}
            <div
              className="relative h-full bg-[#111111] transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-5 py-4">
        <p className="mb-3 text-base font-semibold capitalize text-neutral-700">
          Up next
        </p>

        {current ? (
          <div
            key={current.id}
            className={cn(
              "animate-in fade-in slide-in-from-top-2 rounded-xl border bg-white px-3.5 py-3 duration-500",
              current.state === "current"
                ? "border-neutral-900/15"
                : "border-neutral-200",
            )}
          >
            {current.kind === "workforce" ? (
              <div className="flex items-start gap-2.5">
                <PathIcon state="current" />
                <div className="min-w-0 flex-1">
                  <CurrentWorkforceCard draft={draft} />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <PathIcon state="current" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900">{current.label}</p>
                  {current.value ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{current.value}</p>
                  ) : (
                    <p className="mt-0.5 text-sm text-neutral-600">Answer in the conversation</p>
                  )}
                  {draft.choices && draft.choices.length > 0 &&
                  (current.id === "team" || current.id === "hours") ? (
                    <ChoiceList label={draft.choicesLabel} choices={draft.choices} />
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {upcoming.length > 0 ? (
          <ul className="mt-2.5 space-y-0.5">
            {upcoming.map((item, index) => (
              <li
                key={item.id}
                className="animate-in fade-in flex items-center gap-2.5 rounded-lg px-1 py-1.5 duration-300"
                style={{ animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
              >
                <PathIcon state="pending" />
                <span className="text-sm text-neutral-600">{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {draft.ready === true ? (
          <StatusBanner tone="success" icon={Sparkles} className="animate-in fade-in zoom-in-95 mt-3 duration-500">
            Ready to publish — say <strong>create queue</strong> in the chat.
          </StatusBanner>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-5 pt-3 pb-2">
          <p className="text-base font-semibold capitalize text-neutral-700">
            Completed
          </p>
          {completed.length > 0 ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-900">
              {completed.length}
            </span>
          ) : null}
        </div>

        {completed.length === 0 ? (
          <p className="animate-in fade-in px-5 pb-4 text-sm text-neutral-400 duration-500">
            Answers will appear here as you go.
          </p>
        ) : (
          <PanelScrollArea className="min-h-0 flex-1 px-5 pb-4">
            <ul className="space-y-2">
              {completed.map((step, index) => (
                <CompletedRow
                  key={step.id}
                  step={step}
                  draft={draft}
                  index={index}
                  channelsEditable={channelsEditable}
                  onToggleChannel={handleToggleChannel}
                />
              ))}
            </ul>
            <div ref={completedEndRef} aria-hidden className="h-px shrink-0" />
          </PanelScrollArea>
        )}
      </div>
    </div>
  );
}
