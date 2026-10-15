import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

export type SeoGenerateStage = {
  stage?: string;
  label?: string;
  detail?: string | null;
};

const PROGRESS_STEPS: { stage: string; label: string }[] = [
  { stage: "suggest_keywords", label: "Researching keywords" },
  { stage: "generate_content", label: "Writing content" },
  { stage: "repurpose_formats", label: "Creating social posts" },
  { stage: "done", label: "Ready" },
];

const STAGE_ALIAS: Record<string, string> = {
  domain_analysis: "suggest_keywords",
  keyword_research: "suggest_keywords",
  analyze_competition: "suggest_keywords",
  competitor_analysis: "suggest_keywords",
  content_draft: "generate_content",
  optimize_seo: "generate_content",
  seo_score: "generate_content",
  seo_optimize: "generate_content",
  repurpose: "repurpose_formats",
};

function canonicalStage(stage?: string): string {
  if (!stage) return "";
  return STAGE_ALIAS[stage] || stage;
}

function stageIndex(stage: string | undefined): number {
  const canon = canonicalStage(stage);
  if (!canon || canon === "done") return PROGRESS_STEPS.length - 1;
  if (canon === "error") return -1;
  const idx = PROGRESS_STEPS.findIndex((s) => s.stage === canon);
  return idx < 0 ? 0 : idx;
}

export function SeoGenerateProgress({
  progress,
  running,
}: {
  progress: SeoGenerateStage | null;
  running: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running || progress?.stage === "error" || progress?.stage === "done") {
      setTick(0);
      return;
    }
    const id = window.setInterval(() => {
      setTick((n) => Math.min(n + 1, PROGRESS_STEPS.length - 2));
    }, 4500);
    return () => window.clearInterval(id);
  }, [running, progress?.stage]);

  const reported = stageIndex(progress?.stage);
  const currentIdx =
    progress?.stage === "error"
      ? -1
      : Math.max(reported, running ? tick : reported);
  const currentStage =
    progress?.stage === "error"
      ? "error"
      : progress?.stage === "done"
        ? "done"
        : PROGRESS_STEPS[currentIdx]?.stage || "suggest_keywords";

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-violet-100 bg-white p-3.5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">
        {progress?.stage === "error" ? "Couldn’t finish" : "Thinking"}
      </p>
      {progress?.stage === "error" && progress.detail ? (
        <p className="mt-1 text-sm text-red-700">{progress.detail}</p>
      ) : null}
      <ol className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {PROGRESS_STEPS.map((step, idx) => {
          const done = currentStage === "done" || currentIdx > idx;
          const current = currentStage !== "done" && currentIdx === idx;
          return (
            <li
              key={step.stage}
              className={`flex items-center gap-2 text-sm ${
                done
                  ? "text-emerald-700"
                  : current
                    ? "font-medium text-violet-800"
                    : "text-neutral-400"
              }`}
            >
              {current && running ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : done ? (
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-3 w-3 text-emerald-600" />
                </span>
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-300" />
              )}
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
