import { useState, type ReactNode } from "react";
import { CalendarClock, MoreVertical } from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from "recharts";

type OutcomeSlice = {
  name: string;
  value: number;
  color: string;
};

export function OutcomesDonut({
  selected,
  sent,
  failed,
  bounced,
  pending,
  showPending,
  selectedLabel = "Selected",
}: {
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  pending: number;
  showPending: boolean;
  selectedLabel?: string;
}) {
  const slices: OutcomeSlice[] = [
    { name: "Sent", value: sent, color: "#16a34a" },
    { name: "Failed", value: failed, color: "#dc2626" },
    { name: "Bounced", value: bounced, color: "#f97316" },
    ...(showPending
      ? [{ name: "Pending", value: pending, color: "#a3a3a3" }]
      : []),
  ].filter((s) => s.value > 0);

  const pieData = slices.length
    ? slices
    : [{ name: "Empty", value: 1, color: "#e5e5e5" }];

  const legend = [
    { name: "Sent", value: sent, color: "#16a34a" },
    { name: "Failed", value: failed, color: "#dc2626" },
    { name: "Bounced", value: bounced, color: "#f97316" },
    ...(showPending
      ? [{ name: "Pending", value: pending, color: "#a3a3a3" }]
      : []),
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-3 shadow-sm">
      <div className="relative mx-auto h-44 w-full max-w-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={78}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-2xl font-semibold tabular-nums text-text-primary">
            {selected.toLocaleString()}
          </p>
          <p className="text-[11px] text-text-caption">{selectedLabel}</p>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {legend.map((item) => (
          <li
            key={item.name}
            className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.name}{" "}
            <span className="font-semibold tabular-nums text-text-primary">
              {item.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type ChannelKpiTone =
  | "selected"
  | "sent"
  | "failed"
  | "opened"
  | "clicked"
  | "neutral";

export type ChannelKpi = {
  label: string;
  value: string;
  tone?: ChannelKpiTone;
};

const PILL_TONE: Record<ChannelKpiTone, string> = {
  selected: "bg-sky-50 text-sky-800",
  sent: "bg-emerald-50 text-emerald-800",
  failed: "bg-red-50 text-red-700",
  opened: "bg-violet-50 text-violet-800",
  clicked: "bg-indigo-50 text-indigo-800",
  neutral: "bg-neutral-100 text-neutral-700",
};

function toneFor(item: ChannelKpi): ChannelKpiTone {
  if (item.tone) return item.tone;
  const label = item.label.toLowerCase();
  if (label === "selected") return "selected";
  if (label === "sent") return "sent";
  if (label === "failed" || label === "bounced") return "failed";
  if (label === "opened") return "opened";
  if (label === "clicked") return "clicked";
  return "neutral";
}

function MetricPillCard({ item }: { item: ChannelKpi }) {
  const tone = toneFor(item);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-3 shadow-sm">
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONE[tone]}`}
      >
        {item.label}
      </span>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
        {item.value}
      </p>
    </div>
  );
}

export function ChannelMetricPills({ metrics }: { metrics: ChannelKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {metrics.map((item) => (
        <MetricPillCard key={item.label} item={item} />
      ))}
    </div>
  );
}

/** Channel dropdown: launch row + pill count cards. */
export function ChannelKpiCard({
  launchLabel,
  launchWhen,
  metrics,
  title,
  winner,
  muted,
  extras,
  menu,
}: {
  launchLabel: string;
  launchWhen: string;
  metrics: ChannelKpi[];
  title?: string;
  winner?: boolean;
  muted?: boolean;
  extras?: ReactNode;
  menu?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={muted ? "opacity-80" : ""}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {title ? (
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-semibold text-neutral-800">{title}</p>
              {winner ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Winner
                </span>
              ) : null}
            </div>
          ) : null}
          <p className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <CalendarClock
              className="size-3.5 shrink-0 text-indigo-500"
              strokeWidth={1.75}
            />
            {launchLabel}
            <span className="font-medium text-neutral-800">{launchWhen}</span>
          </p>
        </div>
        {menu ? (
          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50"
              aria-label="More actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreVertical className="size-4" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div className="absolute top-8 right-0 z-20 min-w-[8rem] overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                <div onClick={() => setMenuOpen(false)}>{menu}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        <ChannelMetricPills metrics={metrics} />
      </div>

      {extras ? (
        <div className="mt-3 text-xs text-neutral-600">{extras}</div>
      ) : null}
    </div>
  );
}
