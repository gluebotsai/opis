import { humanizeMonitoringCode } from "@/components/monitoring/monitoring-shared";
import { SentimentSummaryRow } from "@/components/workspace/sentiment-chip";
import type { WorkspaceConversation } from "@/features/workspace/types";

function OutcomeValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b-[0.6px] border-[#bfbfbf] pb-2 last:border-b-0 last:pb-0">
      <p className="text-xs text-neutral-600">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-xs font-medium leading-relaxed text-neutral-900">
        {value}
      </p>
    </div>
  );
}

export function hasConversationOutcomeDetails(conversation: WorkspaceConversation): boolean {
  const closed = Boolean(
    conversation.endedAt ||
      conversation.resolvedAt ||
      conversation.status === "resolved",
  );
  return Boolean(
    conversation.dispositionCode ||
      conversation.dispositionNote ||
      conversation.resolutionCode ||
      conversation.resolutionSummary ||
      (closed && conversation.sentiment),
  );
}

export function WorkspaceConversationOutcome({
  conversation,
}: {
  conversation: WorkspaceConversation;
}) {
  if (!hasConversationOutcomeDetails(conversation)) return null;
  const showResolution =
    Boolean(conversation.resolutionCode) &&
    conversation.resolutionCode !== conversation.dispositionCode;
  const showResolutionSummary =
    Boolean(conversation.resolutionSummary) &&
    conversation.resolutionSummary?.trim() !== conversation.dispositionNote?.trim();
  const showSentimentSummary =
    Boolean(conversation.sentiment?.summary) &&
    conversation.sentiment?.summary?.trim() !== conversation.dispositionNote?.trim() &&
    conversation.sentiment?.summary?.trim() !== conversation.resolutionSummary?.trim();

  return (
    <div className="space-y-3">
      {conversation.dispositionCode ? (
        <OutcomeValueRow
          label="Disposition"
          value={humanizeMonitoringCode(conversation.dispositionCode)}
        />
      ) : null}
      {conversation.dispositionNote ? (
        <OutcomeValueRow label="Disposition summary" value={conversation.dispositionNote} />
      ) : null}
      {showResolution && conversation.resolutionCode ? (
        <OutcomeValueRow
          label="Resolution"
          value={humanizeMonitoringCode(conversation.resolutionCode)}
        />
      ) : null}
      {showResolutionSummary && conversation.resolutionSummary ? (
        <OutcomeValueRow label="Resolution summary" value={conversation.resolutionSummary} />
      ) : null}
      {showSentimentSummary && conversation.sentiment?.summary ? (
        <OutcomeValueRow label="Sentiment summary" value={conversation.sentiment.summary} />
      ) : null}
      {conversation.sentiment ? (
        <div className="space-y-2">
          <SentimentSummaryRow
            title="Customer sentiment"
            axis={conversation.sentiment.customer}
          />
          <SentimentSummaryRow title="Agent tone" axis={conversation.sentiment.agent} />
        </div>
      ) : null}
    </div>
  );
}
