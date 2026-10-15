import type { ReactNode } from "react";
import { Check, Circle, Lock } from "lucide-react";
import { PanelScrollArea } from "@/components/ui/PanelScrollArea";
import { VISIBLE_CAMPAIGN_CHANNELS } from "@/lib/campaign-channels";
import {
  CAMPAIGN_GUIDED_FIELDS,
  computeMissingCampaignKeys,
  displayCampaignGuidedValue,
  isCampaignFieldComplete,
  type CampaignGuidedKey,
  type CampaignGuidedSnapshot,
} from "@/lib/campaign-guided-fields";

type CampaignGuidedPreviewProps = {
  snap: CampaignGuidedSnapshot;
  extras?: ReactNode;
  /** Kept for callers; no longer shown as a separate Up next panel. */
  nextQuestion?: string | null;
  nextKeyOverride?: CampaignGuidedKey | null;
  channelReadyById?: Record<string, boolean>;
  /** Hide fields from this overview (e.g. templates live in chat on rec-run). */
  hiddenKeys?: CampaignGuidedKey[];
};

export function CampaignGuidedPreview({
  snap,
  extras,
  nextKeyOverride = null,
  channelReadyById = {},
  hiddenKeys = [],
}: CampaignGuidedPreviewProps) {
  const hide = new Set(hiddenKeys);
  const fieldDefs = CAMPAIGN_GUIDED_FIELDS.filter(
    ({ optional, key }) => !optional && !hide.has(key),
  );
  const missing = computeMissingCampaignKeys(snap).filter((key) => !hide.has(key));
  const nextKey =
    nextKeyOverride && missing.includes(nextKeyOverride)
      ? nextKeyOverride
      : missing[0] ?? null;
  const ready = missing.length === 0;
  const completedCount = fieldDefs.filter(({ key }) =>
    isCampaignFieldComplete(key, snap),
  ).length;
  const progress = Math.round(
    (completedCount / Math.max(fieldDefs.length, 1)) * 100,
  );

  return (
    <div className="animate-in fade-in flex w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-[0_8px_30px_rgba(15,23,42,0.06)] duration-500">
      <div className="shrink-0 border-b border-neutral-100 bg-gradient-to-br from-white via-white to-neutral-50 px-5 py-4">
        <p className="text-sm font-medium text-neutral-500">Campaign setup</p>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-neutral-500">
            <span className="font-medium text-neutral-700">
              {progress}% complete
            </span>
            <span>
              {completedCount} of {fieldDefs.length} fields
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Configured channels
          </p>
          <div className="flex flex-wrap gap-1.5">
            {VISIBLE_CAMPAIGN_CHANNELS.map((ch) => {
              const isReady = Boolean(channelReadyById[ch.id]);
              const Icon = ch.icon;
              return (
                <span
                  key={ch.id}
                  title={
                    isReady
                      ? "Configured and ready"
                      : "Not configured — finish Configuration first"
                  }
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                    isReady
                      ? "border-neutral-200 bg-white text-neutral-900"
                      : "border-neutral-100 bg-neutral-50 text-neutral-400"
                  }`}
                >
                  {isReady ? (
                    <Icon className="size-3" strokeWidth={2} />
                  ) : (
                    <Lock className="size-3" strokeWidth={2} />
                  )}
                  {ch.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <PanelScrollArea className="px-5 py-4">
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Fields (in order)
          </p>
          <ul className="space-y-2">
            {fieldDefs.map(({ key, label }, index) => {
              const done = isCampaignFieldComplete(key, snap);
              const active = key === nextKey && !ready;
              const value = displayCampaignGuidedValue(key, snap);
              return (
                <li
                  key={key}
                  className={`animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 duration-300 ${
                    done
                      ? "border-emerald-200 bg-emerald-50/60 shadow-sm"
                      : active
                        ? "border-neutral-900/15 bg-white"
                        : "border-neutral-100 bg-white"
                  }`}
                  style={{
                    animationDelay: `${index * 40}ms`,
                    animationFillMode: "both",
                  }}
                >
                  {done ? (
                    <span className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <Circle
                      className={`mt-[3px] size-4 shrink-0 ${
                        active ? "fill-neutral-900 text-neutral-900" : "text-neutral-300"
                      }`}
                      strokeWidth={active ? 2.5 : 2}
                    />
                  )}
                  <div className="min-w-0 flex-1 leading-snug">
                    <p
                      className={`text-sm leading-5 ${
                        done
                          ? "font-medium text-emerald-800"
                          : active
                            ? "font-medium text-neutral-900"
                            : "text-neutral-400"
                      }`}
                    >
                      {label}
                    </p>
                    {value ? (
                      <p
                        className={`mt-0.5 whitespace-pre-wrap break-words text-sm font-medium ${
                          done ? "text-neutral-900" : "text-neutral-600"
                        }`}
                      >
                        {value}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {extras ? <section className="mt-5">{extras}</section> : null}
      </PanelScrollArea>
    </div>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  web: "Web push",
  push: "App push",
};

export function CampaignSummaryRecap({
  recap,
}: {
  recap: {
    name?: string;
    goal?: string;
    objective?: string;
    audienceCount?: number | null;
    channels?: string[];
    templateIds?: string[];
  };
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Name", value: recap.name?.trim() || "—" },
    { label: "Goal", value: recap.goal?.trim() || "—" },
    { label: "Objective", value: recap.objective?.trim() || "—" },
    {
      label: "Audience",
      value:
        recap.audienceCount != null && recap.audienceCount > 0
          ? `${recap.audienceCount} contact${recap.audienceCount === 1 ? "" : "s"}`
          : "—",
    },
    {
      label: "Channels",
      value: (recap.channels || [])
        .map((c) => CHANNEL_LABELS[c.toLowerCase()] || c)
        .join(", ") || "—",
    },
    {
      label: "Templates",
      value: (recap.templateIds || []).filter(Boolean).join(", ") || "—",
    },
  ];

  return (
    <div className="animate-in fade-in flex w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-[0_8px_30px_rgba(15,23,42,0.06)] duration-500">
      <div className="shrink-0 border-b border-neutral-100 bg-gradient-to-br from-white via-white to-neutral-50 px-5 py-4">
        <p className="text-sm font-medium text-neutral-500">Campaign recap</p>
        <p className="mt-1 text-sm text-neutral-800">Ready to launch</p>
      </div>
      <PanelScrollArea className="px-5 py-4">
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.label}
              className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {row.label}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-neutral-900">
                {row.value}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-neutral-500">
          Confirm in chat to launch now, or pick a send time.
        </p>
      </PanelScrollArea>
    </div>
  );
}
