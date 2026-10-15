export type AgentExecutionIds = {
  conversationId: string;
  runId: string;
  traceId: string;
  idempotencyKey: string;
  traceparent?: string;
};

export type AnalyticsChartSpec = {
  version?: "1.0";
  type: "bar" | "line" | "table" | "kpi" | "pie";
  title?: string;
  x?: string;
  y?: string | string[];
  series?: Array<{ key: string; label?: string; color?: string }>;
};

export type AnalyticsKpiItem = {
  label: string;
  value: string;
  hint?: string;
  change?: string;
};

export type AnalyticsVisual = {
  version: "1.0";
  kind: "kpi" | "bar" | "line" | "pie" | "table";
  title: string;
  description?: string;
  kpis?: AnalyticsKpiItem[];
  chart?: {
    xKey: string;
    data: Array<Record<string, string | number>>;
    series: Array<{ key: string; label?: string; color?: string }>;
  };
  table?: {
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, unknown>>;
  };
};

export type OntologyProgressStep = {
  kind: string;
  label: string;
  status?: string;
  detail?: string;
  phase?: string;
  stepId?: string;
  tool?: string;
};

export type StructuredAnalytics = {
  plan: Record<string, unknown>;
  findings: {
    summary: string;
    rows: Array<Record<string, unknown>>;
    comparison?: string;
  };
  chart?: AnalyticsChartSpec | null;
  visual?: AnalyticsVisual | null;
  visuals?: AnalyticsVisual[] | null;
  audit: Record<string, unknown> & {
    source?: string;
    progress?: OntologyProgressStep[];
  };
};

export type AgentEventType =
  | "token"
  | "progress"
  | "final"
  | "uiRefresh"
  | "step"
  | "error";

export type AgentStreamEvent = {
  version: "1.0";
  id: string;
  type: AgentEventType;
  organizationId: string;
  runId: string;
  traceId: string;
  conversationId?: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

const EVENT_TYPES = new Set<AgentEventType>([
  "token",
  "progress",
  "final",
  "uiRefresh",
  "step",
  "error",
]);

function containsSql(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsSql(item, depth + 1));
  return Object.entries(value).some(
    ([key, item]) =>
      /^(sql|queryText|rawQuery)$/i.test(key) || containsSql(item, depth + 1),
  );
}

export function parseAgentStreamEvent(raw: string): AgentStreamEvent | null {
  try {
    const event = JSON.parse(raw) as Partial<AgentStreamEvent>;
    if (
      event.version !== "1.0" ||
      typeof event.id !== "string" ||
      typeof event.runId !== "string" ||
      typeof event.traceId !== "string" ||
      typeof event.organizationId !== "string" ||
      typeof event.type !== "string" ||
      !EVENT_TYPES.has(event.type as AgentEventType) ||
      !event.data ||
      typeof event.data !== "object" ||
      containsSql(event.data)
    ) {
      return null;
    }
    return event as AgentStreamEvent;
  } catch {
    return null;
  }
}

export function openAgentEventStream(
  path: string,
  handlers: {
    onEvent: (event: AgentStreamEvent) => void;
    onError?: (event: Event) => void;
    cursor?: string;
  },
): () => void {
  const url = new URL(path, window.location.origin);
  if (handlers.cursor) url.searchParams.set("cursor", handlers.cursor);
  const source = new EventSource(url.toString(), { withCredentials: true });
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      const event = parseAgentStreamEvent((message as MessageEvent<string>).data);
      if (event) handlers.onEvent(event);
    });
  }
  if (handlers.onError) source.onerror = handlers.onError;
  return () => source.close();
}
