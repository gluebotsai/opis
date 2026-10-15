import { ArrowLeft, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { channelLabel } from "@/components/monitoring/monitoring-utils";
import { IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { isCallbackEligibleChannel } from "@/features/monitoring/map-monitoring-snapshot";
import {
  callbackTaskStatusLabel,
  callbackTaskStatusTone,
  canAssignMissedCallback,
  latestMissedAttempt,
  missedFollowUpDisplayLabel,
  missedFollowUpDisplayTone,
  resolveMissedGroupCallback,
  resolveMissedGroupConnected,
} from "@/features/monitoring/monitoring-queue-utils";
import type {
  CallbackInteraction,
  MissedInteraction,
  WaitingInteraction,
} from "@/features/monitoring/types";

import { formatDuration, formatRelativeTime, slaTone, StatusBadge } from "./monitoring-shared";

const MISSED_LABELS: Record<MissedInteraction["reason"], string> = {
  missed_call: "Missed call",
  abandoned_call: "Abandoned call",
  abandoned_chat: "Abandoned chat",
  failed_transfer: "Failed transfer",
};

function slaLabel(sla: WaitingInteraction["sla"]): string {
  if (sla === "healthy") return "Healthy";
  if (sla === "at_risk") return "At risk";
  return "Breached";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-right text-xs font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function DetailCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[#bfbfbf] rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/70 px-3.5">
      {children}
    </div>
  );
}

function AssignCallbackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[38px] items-center rounded-lg bg-neutral-900 px-3.5 text-xs font-semibold text-white transition hover:bg-neutral-800"
    >
      Assign callback
    </button>
  );
}

type MonitoringQueueDetailPanelProps = {
  title: string;
  subtitle?: string;
  backLabel: string;
  contactId?: string | null;
  onClose: () => void;
  children: ReactNode;
};

export function MonitoringQueueDetailPanel({
  title,
  subtitle,
  backLabel,
  contactId,
  onClose,
  children,
}: MonitoringQueueDetailPanelProps) {
  const contactPath = contactId
    ? `/admin/contacts?contact=${encodeURIComponent(contactId)}`
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton onClick={onClose} className="shrink-0" aria-label={backLabel}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
            {subtitle ? (
              <p className="truncate text-[11px] text-neutral-600">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {contactPath ? (
          <Link
            to={contactPath}
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-xs font-medium text-neutral-700 transition hover:border-[#bfbfbf] hover:bg-neutral-50"
          >
            View contact
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <PanelScrollArea className="min-h-0 flex-1 px-4 py-4">{children}</PanelScrollArea>
    </div>
  );
}

export function WaitingDetailPanel({
  row,
  onAssignCallback,
}: {
  row: WaitingInteraction;
  onAssignCallback?: (row: WaitingInteraction) => void;
}) {
  const canAssignCallback =
    Boolean(onAssignCallback) && isCallbackEligibleChannel(row.channel);

  return (
    <div className="space-y-4">
      <DetailCard>
        <DetailRow label="Channel" value={channelLabel(row.channel)} />
        <DetailRow label="Queue" value={row.queue} />
        <DetailRow label="Queue position" value={`#${row.position}`} />
        <DetailRow label="Waiting time" value={formatDuration(row.waitingSeconds)} />
        <DetailRow label="Priority" value={row.priority} />
        <div className="flex items-center justify-between gap-3 py-2.5">
          <span className="text-xs text-neutral-600">SLA</span>
          <StatusBadge label={slaLabel(row.sla)} tone={slaTone(row.sla)} />
        </div>
      </DetailCard>

      {canAssignCallback ? (
        <div className="flex justify-end">
          <AssignCallbackButton onClick={() => onAssignCallback!(row)} />
        </div>
      ) : null}
    </div>
  );
}

export function MissedDetailPanel({
  attempts,
  onAssignCallback,
}: {
  attempts: MissedInteraction[];
  onAssignCallback?: (row: MissedInteraction) => void;
}) {
  const row = latestMissedAttempt(attempts);
  if (!row) return null;

  const callback = resolveMissedGroupCallback(attempts);
  const connected = resolveMissedGroupConnected(attempts);
  const followUpContext = {
    connectedAfterMiss: connected.connectedAfterMiss,
    callbackAssigned: callback.callbackAssigned,
    callbackStatus: callback.callbackStatus,
    callbackAssignmentSource: callback.callbackAssignmentSource,
    channel: row.channel,
  };
  const canAssignCallback =
    canAssignMissedCallback({
      connectedAfterMiss: connected.connectedAfterMiss,
      callbackAssigned: callback.callbackAssigned,
      callbackStatus: callback.callbackStatus,
      callbackAssignmentSource: callback.callbackAssignmentSource,
      channel: row.channel,
    }) && Boolean(onAssignCallback);

  return (
    <div className="space-y-4">
      <DetailCard>
        <DetailRow label="Channel" value={channelLabel(row.channel)} />
        <DetailRow label="Queue" value={row.queue} />
        <DetailRow label="Reason" value={MISSED_LABELS[row.reason]} />
        <DetailRow label="Attempts (24h)" value={`${attempts.length} missed`} />
        <DetailRow
          label="Latest wait"
          value={row.waitSeconds ? formatDuration(row.waitSeconds) : "—"}
        />
        <DetailRow label="Latest occurred" value={formatRelativeTime(row.occurredAt)} />
        <div className="flex items-center justify-between gap-3 py-2.5">
          <span className="text-xs text-neutral-600">Follow-up status</span>
          <StatusBadge
            label={missedFollowUpDisplayLabel(followUpContext)}
            tone={missedFollowUpDisplayTone(followUpContext)}
          />
        </div>
        {connected.connectedAgentName ? (
          <DetailRow label="Connected by" value={connected.connectedAgentName} />
        ) : null}
        {connected.connectedAt ? (
          <DetailRow
            label="Connected at"
            value={formatRelativeTime(connected.connectedAt)}
          />
        ) : null}
        {callback.callbackAssigned && callback.callbackAssignedAgentName ? (
          <DetailRow
            label={
              callback.callbackStatus === "completed"
                ? "Callback completed by"
                : callback.callbackAssignmentSource === "coworker"
                  ? "Coworker assigned to"
                  : "Callback assigned to"
            }
            value={callback.callbackAssignedAgentName}
          />
        ) : null}
      </DetailCard>

      {attempts.length > 1 ? (
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-2">
          <p className="py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Attempt history
          </p>
          <ul>
            {attempts.map((attempt) => (
              <li key={attempt.id} className={cn("py-2.5 text-xs", listRowDividerClassName())}>
                <p className="font-medium text-neutral-900">
                  {formatRelativeTime(attempt.occurredAt)}
                </p>
                <p className="mt-0.5 text-neutral-600">
                  {channelLabel(attempt.channel)} · {attempt.queue}
                </p>
                <p className="mt-0.5 text-neutral-600">
                  Waited {attempt.waitSeconds ? formatDuration(attempt.waitSeconds) : "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canAssignCallback ? (
        <div className="flex justify-end">
          <AssignCallbackButton onClick={() => onAssignCallback!(row)} />
        </div>
      ) : null}
    </div>
  );
}

export function CallbackDetailPanel({ tasks }: { tasks: CallbackInteraction[] }) {
  const row = tasks[0];
  if (!row) return null;

  return (
    <div className="space-y-4">
      <DetailCard>
        <DetailRow label="Channel" value={channelLabel(row.channel)} />
        <DetailRow label="Queue" value={row.queue} />
        <DetailRow label="Assigned agent" value={row.assignedAgentName} />
        <DetailRow label="Task" value={row.title} />
        <DetailRow label="Assigned by" value={row.assignedBy ?? "—"} />
        <DetailRow label="Priority" value={row.priority} />
        <div className="flex items-center justify-between gap-3 py-2.5">
          <span className="text-xs text-neutral-600">Callback status</span>
          <StatusBadge
            label={callbackTaskStatusLabel(row.status)}
            tone={callbackTaskStatusTone(row.status)}
          />
        </div>
        <DetailRow label="Created" value={formatRelativeTime(row.createdAt)} />
        {row.completedAt ? (
          <DetailRow label="Completed" value={formatRelativeTime(row.completedAt)} />
        ) : null}
      </DetailCard>

      {tasks.length > 1 ? (
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-2">
          <p className="py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Callback tasks ({tasks.length})
          </p>
          <ul>
            {tasks.map((task) => (
              <li key={task.taskId} className={cn("py-2.5 text-xs", listRowDividerClassName())}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-neutral-900">{task.title}</p>
                  <StatusBadge
                    label={callbackTaskStatusLabel(task.status)}
                    tone={callbackTaskStatusTone(task.status)}
                  />
                </div>
                <p className="mt-0.5 text-neutral-600">
                  {task.assignedAgentName} · {formatRelativeTime(task.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
