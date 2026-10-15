export type LatencyMetric = {
  label: string;
  ms: number;
};

export async function measure(label: string, fn: () => Promise<void>): Promise<LatencyMetric> {
  const started = performance.now();
  await fn();
  return { label, ms: Math.round(performance.now() - started) };
}

export function printLatencyReport(metrics: LatencyMetric[]) {
  const lines = metrics
    .map((metric) => `  ${metric.label.padEnd(42)} ${String(metric.ms).padStart(5)} ms`)
    .join("\n");
  console.log(`\n── UI latency report ──\n${lines}\n`);
}

export function assertLatency(metrics: LatencyMetric[], budgetMs: Record<string, number>) {
  for (const metric of metrics) {
    const budget = budgetMs[metric.label];
    if (budget === undefined) continue;
    if (metric.ms > budget) {
      throw new Error(`${metric.label} took ${metric.ms}ms (budget ${budget}ms)`);
    }
  }
}
