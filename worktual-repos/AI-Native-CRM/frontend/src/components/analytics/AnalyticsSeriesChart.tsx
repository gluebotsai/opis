import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ANALYTICS_CHART_COLORS } from "@/components/analytics/chart-colors";

export function AnalyticsSeriesChart({
  title,
  kind,
  xKey,
  data,
  series,
}: {
  title: string;
  kind: "bar" | "line";
  xKey: string;
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label?: string; color?: string }>;
}) {
  if (data.length === 0) return null;

  return (
    <div className="mt-2 w-full border-t border-neutral-200/80 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-caption">{title}</p>
      <div className="mt-2 h-44 w-full min-w-0 rounded-lg border border-border-default bg-white p-2">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--clr-border-default)" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              {series.map((item, i) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label ?? item.key}
                  stroke={item.color ?? ANALYTICS_CHART_COLORS[i % ANALYTICS_CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--clr-border-default)" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              {series.map((item, i) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label ?? item.key}
                  fill={item.color ?? ANALYTICS_CHART_COLORS[i % ANALYTICS_CHART_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
