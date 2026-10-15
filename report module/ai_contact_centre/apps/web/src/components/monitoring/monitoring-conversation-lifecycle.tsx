import { useEffect, useState, type ReactNode } from "react";

import {
  conversationTotalSeconds,
  formatDuration,
  formatMonitoringDateTime,
  humanizeMonitoringCode,
} from "@/components/monitoring/monitoring-shared";
import { MonitoringConversationTranscript } from "@/components/monitoring/monitoring-conversation-transcript";
import { WorkspaceAccordion } from "@/components/workspace/workspace-accordion";
import {
  hasConversationOutcomeDetails,
  WorkspaceConversationOutcome,
} from "@/components/workspace/workspace-conversation-outcome";
import { workspaceApi } from "@/features/workspace/api";
import type { WorkspaceConversation } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type MonitoringConversationDetailSectionsProps = {
  conversationId: string;
  /** When set, loads via contact-linked read access (agents can open contact history). */
  contactId?: string | null;
  isPast?: boolean;
  contextRows?: ReactNode;
};

type ExpandedSection = "timeline" | "transcript" | "outcome";

function LifecycleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-right text-xs font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function useMonitoringConversationRecord(conversationId: string, contactId?: string | null) {
  const [conversation, setConversation] = useState<WorkspaceConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConversation(null);

    void workspaceApi
      .getConversation(conversationId, false, { contactId })
      .then((loaded) => {
        if (cancelled) return;
        setConversation(loaded);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Failed to load conversation details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contactId, conversationId]);

  return { conversation, loading, error };
}

export function MonitoringConversationDetailSections({
  conversationId,
  contactId = null,
  isPast = false,
  contextRows,
}: MonitoringConversationDetailSectionsProps) {
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>("timeline");
  const { conversation, loading, error } = useMonitoringConversationRecord(
    conversationId,
    contactId,
  );

  const closed =
    isPast || Boolean(conversation?.endedAt ?? conversation?.resolvedAt);
  const endedAt = conversation?.endedAt ?? conversation?.resolvedAt ?? null;
  const totalSeconds =
    conversation?.createdAt != null
      ? conversationTotalSeconds({
          createdAt: conversation.createdAt,
          endedAt: endedAt,
          resolvedAt: conversation.resolvedAt ?? null,
          isClosed: closed,
        })
      : 0;
  const handoffLabel = conversation?.handoffReason
    ? humanizeMonitoringCode(conversation.handoffReason)
    : null;
  const hasOutcomeDetails = conversation
    ? hasConversationOutcomeDetails(conversation)
    : false;

  function openSection(section: ExpandedSection) {
    setExpandedSection(section);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {loading ? (
        <div className="grid shrink-0 grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-[72px] animate-pulse rounded-lg bg-neutral-100" />
          ))}
        </div>
      ) : error ? (
        <p className="shrink-0 text-xs text-red-600">{error}</p>
      ) : (
        <div className="grid shrink-0 grid-cols-2 gap-3">
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] p-3">
            <p className="text-[10px] uppercase tracking-wide text-neutral-600">Total time</p>
            <p className="mt-1 text-sm font-medium tabular-nums text-neutral-900">
              {formatDuration(totalSeconds)}
            </p>
          </div>
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] p-3">
            <p className="text-[10px] uppercase tracking-wide text-neutral-600">Status</p>
            <p className="mt-1 text-sm font-medium text-neutral-900">
              {closed ? "Closed" : conversation?.status === "waiting" ? "Waiting" : "Active"}
            </p>
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white",
          expandedSection === "transcript" && "min-h-0 flex-1",
        )}
      >
        <WorkspaceAccordion
          title="Timeline"
          fillHeight={false}
          open={expandedSection === "timeline"}
          onOpenChange={(open) => {
            if (open) openSection("timeline");
          }}
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-4 animate-pulse rounded bg-neutral-100" />
              ))}
            </div>
          ) : error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : !conversation?.createdAt ? (
            <p className="text-xs text-neutral-600">Conversation timeline is not available.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <LifecycleRow
                  label="Started"
                  value={formatMonitoringDateTime(conversation.createdAt)}
                />
                {conversation.queuedAt ? (
                  <LifecycleRow
                    label="Handoff"
                    value={formatMonitoringDateTime(conversation.queuedAt)}
                  />
                ) : null}
                {conversation.assignedAt ? (
                  <LifecycleRow
                    label="Agent connected"
                    value={formatMonitoringDateTime(conversation.assignedAt)}
                  />
                ) : null}
                <LifecycleRow
                  label="Ended"
                  value={
                    endedAt ? formatMonitoringDateTime(endedAt) : closed ? "—" : "In progress"
                  }
                />
                {handoffLabel ? (
                  <LifecycleRow label="Handoff reason" value={handoffLabel} />
                ) : null}
              </div>
              {contextRows ? (
                <div className="space-y-2 border-t-[0.6px] border-[#bfbfbf] pt-3">{contextRows}</div>
              ) : null}
            </div>
          )}
        </WorkspaceAccordion>

        <WorkspaceAccordion
          title="Transcript"
          open={expandedSection === "transcript"}
          onOpenChange={(open) => {
            if (open) openSection("transcript");
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <MonitoringConversationTranscript
              conversationId={conversationId}
              contactId={contactId}
            />
          </div>
        </WorkspaceAccordion>

        {hasOutcomeDetails ? (
          <WorkspaceAccordion
            title="Outcome"
            fillHeight={false}
            open={expandedSection === "outcome"}
            onOpenChange={(open) => {
              if (open) openSection("outcome");
            }}
          >
            {conversation ? <WorkspaceConversationOutcome conversation={conversation} /> : null}
          </WorkspaceAccordion>
        ) : null}
      </div>
    </div>
  );
}
