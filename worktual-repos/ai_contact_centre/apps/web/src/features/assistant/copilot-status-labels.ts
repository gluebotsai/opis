import type { CopilotPageSnapshot } from "@/features/assistant/copilot-page-context";
import type { QueueDraftField } from "@/features/assistant/assistant-api";

const PHASE_LABELS: Record<string, string> = {
  understanding: "Understanding your question…",
  ontology_layer: "Exploring the knowledge graph…",
  concepts: "Finding relevant metrics…",
  planning: "Planning the analysis…",
  semantic_layer: "Utilizing the semantic layer…",
  kpi: "Generating KPI…",
  querying: "Writing the analytics query…",
  fetching: "Fetching data…",
  charting: "Constructing the chart…",
  knowledge: "Searching knowledge…",
  writing: "Generating response…",
  thinking: "Understanding your question…",
  routing: "Routing you there…",
};

const TOOL_LABELS: Record<string, string> = {
  ask_ontology_layer: "Exploring the knowledge graph…",
  ask_semantic_layer: "Utilizing the semantic layer…",
  generate_performance_report: "Generating KPI…",
  get_dashboard_analytics_snapshot: "Loading Analytics…",
  get_analytics_hourly_volume: "Loading hourly volume…",
  generate_plot: "Constructing the chart…",
  sql_analytics: "Writing the analytics query…",
  get_metrics: "Loading metric definitions…",
  get_metric: "Loading metric details…",
  get_metric_schema: "Checking the data schema…",
  list_metric_domains: "Loading metric domains…",
  list_active_metrics: "Checking active metrics…",
  stage_queue_draft: "Updating the queue preview…",
  list_queues: "Checking your queues…",
  list_teams: "Checking which teams are available…",
  list_business_hours: "Checking business hours options…",
  list_eligible_agents: "Finding agents who can join this queue…",
  list_agents: "Checking who's available…",
  list_presence: "Checking who's online…",
  create_queue: "Creating your queue…",
  update_queue: "Updating the queue…",
  update_queue_status: "Updating the queue…",
  delete_queue: "Deleting the queue…",
  stage_contact_draft: "Updating the contact preview…",
  list_contacts: "Searching contacts…",
  get_contact: "Opening the contact profile…",
  create_contact: "Saving the new contact…",
  update_contact: "Saving contact changes…",
  list_tasks: "Checking your tasks…",
  get_task: "Opening task details…",
  update_task: "Updating the task…",
  open_task_workspace: "Opening the linked workspace…",
  get_monitoring_snapshot: "Loading live monitoring…",
  get_agent_attendance: "Checking agent attendance…",
  get_not_ready_escalation_insight: "Reading escalation insight…",
  get_contact_callback_channels: "Checking callback channels…",
  create_callback_task: "Assigning the callback…",
  force_agent_logout: "Logging the agent out…",
  set_agent_presence: "Updating agent presence…",
  acknowledge_not_ready_escalation: "Acknowledging the escalation…",
  acknowledge_proactive_callback: "Acknowledging the proactive callback…",
  get_conversation_context: "Reading the conversation…",
  suggest_reply: "Drafting a suggested reply…",
  summarize_conversation: "Summarizing the conversation…",
  contact_enrich: "Updating contact details…",
  get_organization_details: "Looking up organization details…",
  get_organization_knowledge: "Searching knowledge…",
  get_skill: "Loading skill guidance…",
  list_skills: "Checking available skills…",
  navigate: "Routing you there…",
  route_to_agent: "Routing to the right specialist…",
};

const QUEUE_FIELD_LABELS: Partial<Record<QueueDraftField, string>> = {
  name: "Noting the queue name…",
  team: "Matching your team…",
  description: "Saving the description…",
  status: "Setting the queue status…",
  businessHours: "Checking business hours…",
  shifts: "Saving your shift choices…",
  staffing: "Opening the staffing form…",
  staffingMode: "Planning how to staff the queue…",
  shiftAgents: "Adding agents to the preview…",
  agentChannels: "Setting up channels for this agent…",
  addAnotherAgent: "Checking if you need more agents…",
  review: "Putting the final preview together…",
};

/** ~1.5s so each progress step is readable before replacing. */
export const COPILOT_STATUS_DWELL_MS = 1500;

export function introStatusLabel(_surface?: CopilotPageSnapshot["surface"]) {
  return PHASE_LABELS.understanding!;
}

export function toolStatusLabel(tool: string) {
  return TOOL_LABELS[tool] ?? "Working on that for you…";
}

export function queueDraftStatusLabel(nextField?: QueueDraftField | null) {
  if (nextField && QUEUE_FIELD_LABELS[nextField]) return QUEUE_FIELD_LABELS[nextField]!;
  return "Updating the queue preview…";
}

export function routingStatusLabelForPath(path: string | null | undefined) {
  const raw = (path ?? "").trim().toLowerCase();
  if (!raw) return "Routing you there…";

  const checks: Array<{ needles: string[]; label: string }> = [
    { needles: ["live-monitoring", "/monitoring", "monitoring"], label: "Routing to live monitoring…" },
    { needles: ["contacts"], label: "Routing to contacts…" },
    { needles: ["workforce/queues", "/queues"], label: "Routing to queues…" },
    { needles: ["workforce"], label: "Routing to workforce…" },
    { needles: ["tasks"], label: "Routing to tasks…" },
    { needles: ["inbox", "workspace"], label: "Routing to inbox…" },
    { needles: ["performance", "my-performance"], label: "Routing to performance…" },
    { needles: ["dashboard/analytics"], label: "Routing to analytics…" },
    { needles: ["analytics", "reports", "dashboard"], label: "Routing to the dashboard…" },
    { needles: ["settings"], label: "Routing to settings…" },
    { needles: ["channels"], label: "Routing to channels…" },
    { needles: ["teams"], label: "Routing to teams…" },
    { needles: ["agents"], label: "Routing to agents…" },
  ];

  for (const { needles, label } of checks) {
    if (needles.some((needle) => raw.includes(needle))) return label;
  }
  return "Routing you there…";
}

export function resolveCopilotStatusLabel(input: {
  phase?: string;
  label?: string;
  tool?: string;
  surface?: CopilotPageSnapshot["surface"];
}) {
  if (
    input.label &&
    ["ontology_layer", "concepts", "planning"].includes(input.phase ?? "")
  ) {
    return input.label;
  }

  if (input.phase && PHASE_LABELS[input.phase]) {
    return PHASE_LABELS[input.phase]!;
  }

  if (input.phase === "tool" && input.label) {
    if (TOOL_LABELS[input.label]) return TOOL_LABELS[input.label]!;
    if (!/^running /i.test(input.label) && input.label.includes("…")) {
      return input.label;
    }
    return toolStatusLabel(input.label);
  }

  if (input.phase === "routing" && input.label) {
    return input.label;
  }

  const toolName =
    input.tool ??
    (input.label?.startsWith("tool:") ? input.label.slice("tool:".length) : undefined) ??
    input.label?.match(/^Running (.+)$/)?.[1];

  if (toolName && TOOL_LABELS[toolName]) {
    return TOOL_LABELS[toolName];
  }

  const normalized = input.label?.trim().toLowerCase();
  if (
    input.phase === "thinking" ||
    normalized === "working" ||
    normalized === "thinking" ||
    normalized === "reviewing your dashboard…"
  ) {
    return PHASE_LABELS.understanding!;
  }

  if (normalized === "writing my reply…" || normalized === "writing my reply...") {
    return PHASE_LABELS.writing!;
  }

  if (input.label && !/^running /i.test(input.label)) {
    return input.label;
  }

  return "Working on that for you…";
}

/** Queues progress labels and replaces the previous one after a dwell. */
export function createStatusPresenter(
  setLabel: (label: string) => void,
  dwellMs: number = COPILOT_STATUS_DWELL_MS,
) {
  let queue: string[] = [];
  let draining = false;
  let lastShown = "";
  let cancelled = false;
  let stopped = false;

  async function drain() {
    if (draining) return;
    draining = true;
    while (!cancelled && !stopped && queue.length > 0) {
      const next = queue.shift()!;
      if (next === lastShown) continue;
      lastShown = next;
      setLabel(next);
      await new Promise((resolve) => setTimeout(resolve, dwellMs));
    }
    draining = false;
  }

  return {
    enqueue(label: string) {
      if (stopped || !label.trim()) return;
      if (queue[queue.length - 1] === label) return;
      if (!draining && queue.length === 0 && lastShown === label) return;
      queue.push(label);
      void drain();
    },
    /** Jump to this label and drop pending steps (e.g. reply started / done). */
    replaceNow(label: string) {
      if (stopped) return;
      queue = [];
      lastShown = label;
      setLabel(label);
    },
    /** Hide the chip and ignore further progress (card/reply has started). */
    stop() {
      stopped = true;
      cancelled = true;
      queue = [];
      draining = false;
      lastShown = "";
      setLabel("");
    },
    reset() {
      cancelled = true;
      stopped = false;
      queue = [];
      draining = false;
      lastShown = "";
      cancelled = false;
    },
  };
}
