import type { ChatMessage } from "@/features/assistant/copilot-engine";
import {
  AssistantMessageContent,
  extractPlotData,
} from "@/components/assistant/assistant-message-content";
import { PlotChartCard, type PlotChartData } from "@/components/assistant/plot-chart-card";
import { QueueStaffingFormCard } from "@/components/assistant/queue-staffing-form-card";
import {
  PerformanceReportCard,
  type PerformanceReportData,
} from "@/components/assistant/performance-report-card";
import { useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { messageBubbleClassName } from "@/components/ui/message-bubble-styles";

export function CopilotMessageList({
  messages,
  onUseSuggestion,
}: {
  messages: ChatMessage[];
  onOpenQueue?: (id: string) => void;
  createQueueActionLabel?: string;
  createQueuePreview?: boolean;
  onUseSuggestion?: (text: string, copilotTurnId?: string) => void;
}) {
  const panels = useCopilotWorkspacePanels();
  const panelExpanded = panels?.expandedSide === "left";
  const items = Array.isArray(messages) ? messages : [];
  const lastAssistantId = [...items]
    .reverse()
    .find((message) => message.kind === "text" && message.role === "assistant")?.id;

  return (
    <>
      {items.map((message) => {
        if (message.kind === "tool") {
          const toolResult = message.result as
            | (PlotChartData & { type?: string; plots?: PlotChartData[] })
            | undefined;
          const plotCards =
            message.status === "success" &&
            toolResult &&
            (message.tool === "generate_plot" ||
              message.tool === "ask_semantic_layer" ||
              message.tool === "get_dashboard_analytics_snapshot" ||
              message.tool === "get_analytics_hourly_volume" ||
              toolResult.type === "plot" ||
              toolResult.chartType === "kpi")
              ? Array.isArray(toolResult.plots) && toolResult.plots.length > 0
                ? toolResult.plots
                : [toolResult]
              : [];
          if (plotCards.length > 0) {
            return (
              <div key={message.id} className="flex w-full justify-start">
                <div className="flex w-full flex-col gap-3">
                  {plotCards.map((plot, index) => (
                    <PlotChartCard key={`${message.id}-plot-${index}`} plot={plot} />
                  ))}
                </div>
              </div>
            );
          }
          if (
            message.tool === "generate_performance_report" &&
            message.status === "success" &&
            message.result
          ) {
            const result = message.result as PerformanceReportData;
            return (
              <div key={message.id} className="flex w-full justify-start">
                <div className="w-full">
                  <PerformanceReportCard report={result} />
                </div>
              </div>
            );
          }
          return null;
        }

        const isUser = message.role === "user";

        if (isUser) {
          return (
            <div key={message.id} className="flex w-full min-w-0 justify-end">
              <div className={messageBubbleClassName({ outgoing: true, panelExpanded })}>
                <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed [overflow-wrap:anywhere]">
                  {message.content}
                </p>
              </div>
            </div>
          );
        }

        const { text: cleanText, plot } = extractPlotData(message.content);

        return (
          <div key={message.id} className="flex w-full flex-col justify-start gap-[10px]">
            {cleanText.trim() ? (
              <div className="min-w-0 break-words text-[#171717] [overflow-wrap:anywhere]">
                <AssistantMessageContent
                  content={cleanText}
                />
                {onUseSuggestion && message.id !== "welcome" ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    onClick={() => onUseSuggestion(cleanText, message.copilotTurnId)}
                  >
                    Use as reply
                  </button>
                ) : null}
              </div>
            ) : null}

            {message.queueStaffingForm ? (
              <QueueStaffingFormCard
                payload={message.queueStaffingForm}
                disabled={message.id !== lastAssistantId}
              />
            ) : null}

            {plot ? (
              <div className="w-full">
                <PlotChartCard plot={plot} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
