export type TemplateGenerationProgressModel = {
  status: "started" | "generating" | "completed" | "failed";
  channels: string[];
  completed_channels: string[];
  failed_channels?: string[];
  current_channel?: string;
  stage?: string;
  label?: string;
  percent: number;
  generation_batch_id?: string;
};

export function TemplateGenerationProgress({
  progress,
  pulling = false,
}: {
  progress: TemplateGenerationProgressModel;
  pulling?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-4 ${
        progress.status === "failed" ? "border-red-300" : "border-border-default"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <p
          className={`font-medium ${
            progress.status === "failed" ? "text-red-800" : "text-text-primary"
          }`}
        >
          {progress.label || "Generating channel templates"}
        </p>
        <span className="text-text-caption">{progress.percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            progress.status === "failed" ? "bg-red-600" : "bg-black"
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(progress.channels || []).map((channel) => {
          const complete = (progress.completed_channels || []).includes(channel);
          const failed = (progress.failed_channels || []).includes(channel);
          const active =
            progress.status !== "completed" &&
            progress.status !== "failed" &&
            !complete &&
            !failed;
          return (
            <span
              key={channel}
              className={`rounded-full border px-2.5 py-1 text-xs capitalize ${
                failed
                  ? "border-red-600 bg-red-50 text-red-800"
                  : complete
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : active
                      ? "border-border-focus text-text-primary"
                      : "border-border-default text-text-caption"
              }`}
            >
              {failed ? `${channel} failed` : channel}
            </span>
          );
        })}
      </div>
      {pulling ? (
        <p className="mt-2 text-xs text-text-caption">Loading cards into chat…</p>
      ) : null}
      {progress.status === "failed" ? (
        <p className="mt-3 text-sm text-red-800">
          No template cards were created. Send a message to retry or change
          channels.
        </p>
      ) : null}
    </div>
  );
}
