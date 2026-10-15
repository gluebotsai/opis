import { Info } from "lucide-react";
import { Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";

import type { ConversationSentiment, SentimentAxis } from "@/features/workspace/sentiment";
import {
  SENTIMENT_LABEL_TEXT,
  sentimentChipClassName,
  sentimentDotClassName,
  sentimentScoreClassName,
} from "@/features/workspace/sentiment";
import { cn } from "@/lib/utils";

type SentimentChipProps = {
  axis: SentimentAxis;
  className?: string;
  compact?: boolean;
  showLabel?: boolean;
};

export function SentimentChip({
  axis,
  className,
  compact = false,
  showLabel = true,
}: SentimentChipProps) {
  const labelText = SENTIMENT_LABEL_TEXT[axis.label] ?? axis.label;
  const title = axis.rationale
    ? `${labelText} · ${axis.score} — ${axis.rationale}`
    : `${labelText} · ${axis.score}`;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        sentimentChipClassName(axis.label),
        className,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", sentimentDotClassName(axis.label))}
        aria-hidden="true"
      />
      {showLabel ? <span className="truncate">{labelText}</span> : null}
      {!compact ? <span className="shrink-0 tabular-nums">{axis.score}</span> : null}
    </span>
  );
}

type SentimentSummaryRowProps = {
  title: string;
  axis: SentimentAxis;
};

export function SentimentSummaryRow({ title, axis }: SentimentSummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/60 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-700">{title}</p>
        {axis.rationale ? (
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-600">{axis.rationale}</p>
        ) : null}
      </div>
      <SentimentChip axis={axis} className="shrink-0" />
    </div>
  );
}

function SentimentInfoTooltip({
  heading,
  axis,
}: {
  heading: string;
  axis: SentimentAxis;
}) {
  const labelText = SENTIMENT_LABEL_TEXT[axis.label] ?? axis.label;

  return (
    <div className="max-w-[16rem] space-y-1">
      <p className="text-[12px] font-semibold text-white">{heading}</p>
      <p className="text-[12px] text-white/90">
        {labelText} · {axis.score}
      </p>
      {axis.rationale ? (
        <p className="text-[12px] leading-snug text-white/75">{axis.rationale}</p>
      ) : null}
    </div>
  );
}

function useSentimentAxisPulse(
  axis: SentimentAxis,
  {
    enabled = false,
    durationMs = 5000,
    resetKey,
  }: {
    enabled?: boolean;
    durationMs?: number;
    resetKey?: string;
  } = {},
) {
  const [pulsing, setPulsing] = useState(false);
  const previousKey = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const axisKey = `${axis.label}:${axis.score}`;

  useEffect(() => {
    previousKey.current = null;
    setPulsing(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;

    if (previousKey.current !== null && previousKey.current !== axisKey) {
      setPulsing(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setPulsing(false);
        timeoutRef.current = null;
      }, durationMs);
    } else if (previousKey.current === null) {
      previousKey.current = axisKey;
      return;
    }

    previousKey.current = axisKey;

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [axisKey, durationMs, enabled]);

  return pulsing;
}

function HeaderSentimentSegment({
  title,
  heading,
  axis,
  pulseOnChange = false,
  pulseResetKey,
  className,
}: {
  title: string;
  heading: string;
  axis: SentimentAxis;
  pulseOnChange?: boolean;
  pulseResetKey?: string;
  className?: string;
}) {
  const labelText = SENTIMENT_LABEL_TEXT[axis.label] ?? axis.label;
  const pulsing = useSentimentAxisPulse(axis, {
    enabled: pulseOnChange,
    resetKey: pulseResetKey,
  });

  return (
    <Tooltip
      title={<SentimentInfoTooltip heading={heading} axis={axis} />}
      placement="bottom"
      color="#171717"
      mouseEnterDelay={0.15}
    >
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-[#f3f4f6] px-2 py-1 transition-colors",
          className,
          pulsing && "animate-sentiment-heartbeat bg-amber-50/70 ring-1 ring-amber-200/70",
        )}
      >
        <span className="shrink-0 text-[14px] font-medium capitalize leading-5 text-neutral-600">
          {title}
        </span>
        <span
          className={cn("size-2 shrink-0 rounded-full", sentimentDotClassName(axis.label))}
          aria-hidden="true"
        />
        <span
          className={cn(
            "shrink-0 text-[14px] font-semibold tabular-nums leading-5 text-[#171717]",
            sentimentScoreClassName(axis.label),
          )}
        >
          {axis.score}
        </span>
        <span className="min-w-0 truncate text-[14px] font-semibold capitalize leading-5 text-[#171717]">
          {labelText}
        </span>
      </span>
    </Tooltip>
  );
}

function CompactSentimentItem({
  title,
  heading,
  axis,
  mini = false,
  showTitle = false,
  pulseOnChange = false,
  pulseResetKey,
}: {
  title: string;
  heading: string;
  axis: SentimentAxis;
  mini?: boolean;
  showTitle?: boolean;
  pulseOnChange?: boolean;
  pulseResetKey?: string;
}) {
  const labelText = SENTIMENT_LABEL_TEXT[axis.label] ?? axis.label;
  const displayTitle = showTitle || !mini;
  const pulsing = useSentimentAxisPulse(axis, {
    enabled: pulseOnChange,
    resetKey: pulseResetKey,
  });

  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center rounded-md border font-medium leading-none !text-neutral-900",
        mini ? "gap-0.5 px-1 py-0.5 text-[9px]" : "gap-1.5 px-2 py-1 text-[11px]",
        sentimentChipClassName(axis.label),
        pulsing && "animate-sentiment-heartbeat",
      )}
    >
      {displayTitle ? (
        <span
          className={cn(
            "shrink-0 font-medium !text-neutral-600",
            mini ? "rounded bg-white/90 px-1 py-px text-[8px]" : "text-[10px]",
          )}
        >
          {title}
        </span>
      ) : null}
      <span
        className={cn(
          "shrink-0 rounded-full",
          mini ? "size-1" : "size-1.5",
          sentimentDotClassName(axis.label),
        )}
        aria-hidden="true"
      />
      <span className={cn("truncate !text-neutral-900", mini && "max-w-[4.5rem]")}>
        {labelText}
      </span>
      <span className="shrink-0 tabular-nums !text-neutral-900">{axis.score}</span>
      <Tooltip
        title={<SentimentInfoTooltip heading={heading} axis={axis} />}
        placement="bottom"
        color="#171717"
        mouseEnterDelay={0.15}
      >
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded-sm text-neutral-700 transition-colors hover:text-neutral-900"
          aria-label={`${heading} details`}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className={mini ? "size-2.5" : "size-3"} aria-hidden="true" />
        </button>
      </Tooltip>
    </span>
  );
}

function DialogSentimentCard({
  title,
  heading,
  axis,
}: {
  title: string;
  heading: string;
  axis: SentimentAxis;
}) {
  const labelText = SENTIMENT_LABEL_TEXT[axis.label] ?? axis.label;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-neutral-600">{title}</p>
        <Tooltip
          title={<SentimentInfoTooltip heading={heading} axis={axis} />}
          placement="bottom"
          color="#171717"
          mouseEnterDelay={0.15}
        >
          <button
            type="button"
            className="inline-flex shrink-0 items-center rounded-sm text-neutral-400 transition-colors hover:text-neutral-700"
            aria-label={`${heading} details`}
            onClick={(event) => event.stopPropagation()}
          >
            <Info className="size-3" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", sentimentDotClassName(axis.label))}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-medium text-neutral-900">{labelText}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-700">
          {axis.score}
        </span>
      </div>
    </div>
  );
}

export function SessionSentimentPanel({
  sentiment,
  className,
  customerTitle = "Customer",
  agentTitle = "You",
}: {
  sentiment: ConversationSentiment;
  className?: string;
  customerTitle?: string;
  agentTitle?: string;
}) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      <DialogSentimentCard title={customerTitle} heading="Customer mood" axis={sentiment.customer} />
      <DialogSentimentCard title={agentTitle} heading="Your tone" axis={sentiment.agent} />
    </div>
  );
}

export function SessionSentimentInline({
  sentiment,
  className,
  mini = false,
  showTitles = false,
  customerTitle = "Customer",
  agentTitle = "You",
  pulseOnChange = false,
  pulseResetKey,
  variant = "default",
}: {
  sentiment: ConversationSentiment;
  className?: string;
  mini?: boolean;
  showTitles?: boolean;
  customerTitle?: string;
  agentTitle?: string;
  pulseOnChange?: boolean;
  pulseResetKey?: string;
  variant?: "default" | "header";
}) {
  if (variant === "header") {
    return (
      <div className={cn("inline-flex min-w-0 flex-wrap items-center gap-2", className)}>
        <HeaderSentimentSegment
          title={customerTitle}
          heading="Customer mood"
          axis={sentiment.customer}
          pulseOnChange={pulseOnChange}
          pulseResetKey={pulseResetKey}
        />
        <HeaderSentimentSegment
          title={agentTitle === "You" ? "You" : agentTitle}
          heading="Your tone"
          axis={sentiment.agent}
          pulseOnChange={pulseOnChange}
          pulseResetKey={pulseResetKey}
        />
      </div>
    );
  }

  return (
    <div className={cn("inline-flex shrink-0 items-center", mini ? "gap-1" : "gap-2", className)}>
      <CompactSentimentItem
        title={customerTitle}
        heading="Customer mood"
        axis={sentiment.customer}
        mini={mini}
        showTitle={showTitles}
        pulseOnChange={pulseOnChange}
        pulseResetKey={pulseResetKey}
      />
      <CompactSentimentItem
        title={agentTitle}
        heading="Your tone"
        axis={sentiment.agent}
        mini={mini}
        showTitle={showTitles}
        pulseOnChange={pulseOnChange}
        pulseResetKey={pulseResetKey}
      />
    </div>
  );
}
