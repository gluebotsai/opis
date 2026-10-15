import type { QueueGuidedDraft } from "@/features/assistant/assistant-api";
import type { QueueAgentPickerItem, QueueAgentPickerPayload } from "@/components/workforce/queue-agent-picker";
import type { QueueChannelPickerPayload } from "@/components/workforce/queue-channel-picker";
import type { QueueStaffingActionsPayload } from "@/components/workforce/queue-staffing-actions";
import type { QueueStaffingFormPayload } from "@/components/workforce/queue-staffing-form";
import type {
  QueueDraft,
  QueueDraftChannel,
  QueueStatus,
  ShiftAgentAssignment,
  ShiftType,
} from "@/features/workforce/queues/types";
import { SHIFT_TYPES } from "@/features/workforce/queues/types";

type QueueAgentChoiceRow = NonNullable<QueueDraft["agentChoices"]>["available"][number];

function asAgentChoice(value: unknown): QueueAgentChoiceRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" ? row.name : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    workEmail: typeof row.workEmail === "string" ? row.workEmail : null,
    currentQueueId: typeof row.currentQueueId === "string" ? row.currentQueueId : null,
    currentQueueName: typeof row.currentQueueName === "string" ? row.currentQueueName : null,
    currentQueueStatus:
      row.currentQueueStatus === "active" || row.currentQueueStatus === "inactive"
        ? row.currentQueueStatus
        : null,
  };
}

export function pickerFromEligibleAgents(
  agents: unknown,
  extras?: { shift?: string; queueName?: string },
): QueueAgentPickerPayload | null {
  if (!Array.isArray(agents)) return null;
  const available: QueueAgentPickerItem[] = [];
  const elsewhere: QueueAgentPickerItem[] = [];
  for (const raw of agents) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name
        : [row.firstName, row.lastName].filter((part) => typeof part === "string").join(" ").trim();
    if (!id || !name) continue;
    const item: QueueAgentPickerItem = {
      id,
      name,
      subtitle: typeof row.workEmail === "string" ? row.workEmail : "",
      currentQueueId: typeof row.currentQueueId === "string" ? row.currentQueueId : null,
      currentQueueName: typeof row.currentQueueName === "string" ? row.currentQueueName : null,
      currentQueueStatus:
        row.currentQueueStatus === "active" || row.currentQueueStatus === "inactive"
          ? row.currentQueueStatus
          : null,
    };
    if (item.currentQueueId) elsewhere.push(item);
    else available.push(item);
  }
  if (available.length === 0 && elsewhere.length === 0) return null;
  return {
    shift: extras?.shift,
    queueName: extras?.queueName,
    available,
    elsewhere,
  };
}

export function parseQueueAgentPicker(
  draft: Pick<QueueGuidedDraft, "agentChoices" | "nextField" | "fields"> | QueueDraft,
): QueueAgentPickerPayload | null {
  const raw =
    "agentChoices" in draft && draft.agentChoices
      ? draft.agentChoices
      : null;
  if (!raw) return null;
  const available = (raw.available ?? [])
    .map((item) => asAgentChoice(item))
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item): QueueAgentPickerItem => ({
      id: item.id,
      name: item.name,
      subtitle: item.workEmail ?? "",
      currentQueueId: item.currentQueueId,
      currentQueueName: item.currentQueueName,
      currentQueueStatus: item.currentQueueStatus,
    }));
  const elsewhere = (raw.elsewhere ?? [])
    .map((item) => asAgentChoice(item))
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item): QueueAgentPickerItem => ({
      id: item.id,
      name: item.name,
      subtitle: item.workEmail ?? otherQueueLabel(item) ?? "",
      currentQueueId: item.currentQueueId,
      currentQueueName: item.currentQueueName,
      currentQueueStatus: item.currentQueueStatus,
    }));
  if (available.length === 0 && elsewhere.length === 0) return null;
  const shift =
    (typeof raw.shift === "string" && raw.shift) ||
    ("fields" in draft && typeof draft.fields?.currentShift === "string"
      ? draft.fields.currentShift
      : undefined) ||
    ("currentShift" in draft ? draft.currentShift : undefined);
  const queueName =
    (typeof raw.queueName === "string" && raw.queueName) ||
    ("fields" in draft && typeof draft.fields?.name === "string" ? draft.fields.name : undefined) ||
    ("name" in draft ? draft.name : undefined);
  return {
    shift,
    queueName,
    available,
    elsewhere,
  };
}

function lastAssignedAgent(
  draft: Pick<QueueGuidedDraft, "fields"> | QueueDraft,
  shift?: string,
): { id?: string; name?: string } {
  const raw =
    "fields" in draft ? draft.fields?.shiftAgentAssignments : draft.shiftAgentAssignments;
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const row = (shift && record[shift]) || Object.values(record).at(-1);
  if (!row || typeof row !== "object") return {};
  const parsed = parseAssignmentRow(row as Record<string, unknown>);
  if (!parsed) return {};
  return {
    id: parsed.agentIds.at(-1),
    name: parsed.agentNames.at(-1),
  };
}

export function parseQueueChannelPicker(
  draft: Pick<QueueGuidedDraft, "channelChoices" | "nextField" | "fields" | "choices"> | QueueDraft,
): QueueChannelPickerPayload | null {
  const isChannelStep =
    ("nextField" in draft && draft.nextField === "agentChannels") ||
    ("question" in draft && draft.question === "agent-channels") ||
    Boolean("channelChoices" in draft && draft.channelChoices);
  if (!isChannelStep) return null;

  const raw = "channelChoices" in draft ? draft.channelChoices : undefined;
  const shift =
    (typeof raw?.shift === "string" && raw.shift) ||
    ("fields" in draft && typeof draft.fields?.currentShift === "string"
      ? draft.fields.currentShift
      : undefined) ||
    ("currentShift" in draft ? draft.currentShift : undefined);
  const inferred = lastAssignedAgent(draft, shift);
  const agentName =
    (typeof raw?.agentName === "string" && raw.agentName.trim()) ||
    ("fields" in draft && typeof draft.fields?.currentAgentName === "string"
      ? draft.fields.currentAgentName
      : undefined) ||
    ("currentAgentName" in draft ? draft.currentAgentName : undefined) ||
    inferred.name;
  if (!agentName) return null;

  const channels = normalizeChannels(raw?.channels) ?? undefined;
  return {
    agentId:
      (typeof raw?.agentId === "string" && raw.agentId) ||
      ("fields" in draft && typeof draft.fields?.currentAgentId === "string"
        ? draft.fields.currentAgentId
        : undefined) ||
      ("currentAgentId" in draft ? draft.currentAgentId : undefined) ||
      inferred.id,
    agentName,
    shift,
    channels,
  };
}

export function parseQueueStaffingActions(
  draft: Pick<QueueGuidedDraft, "staffingActions" | "nextField" | "fields"> | QueueDraft,
): QueueStaffingActionsPayload | null {
  const raw = "staffingActions" in draft ? draft.staffingActions : undefined;
  const isAddAnother =
    ("nextField" in draft && draft.nextField === "addAnotherAgent") ||
    ("question" in draft && draft.question === "add-another-agent");
  if (!raw && !isAddAnother) return null;

  const actions = (raw?.actions ?? [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = typeof item.id === "string" ? item.id : "";
      const label = typeof item.label === "string" ? item.label : "";
      const message = typeof item.message === "string" ? item.message : "";
      if (!id || !label || !message) return null;
      return { id, label, message };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  const currentShift =
    (typeof raw?.currentShift === "string" && raw.currentShift) ||
    ("fields" in draft && typeof draft.fields?.currentShift === "string"
      ? draft.fields.currentShift
      : undefined) ||
    ("currentShift" in draft ? draft.currentShift : undefined);
  const otherShifts = Array.isArray(raw?.otherShifts)
    ? raw.otherShifts.filter((item): item is string => typeof item === "string")
    : undefined;

  if (actions.length === 0 && currentShift) {
    const shiftTypes =
      ("fields" in draft ? draft.fields?.shiftTypes : "shiftTypes" in draft ? draft.shiftTypes : undefined) ?? [];
    const extras = shiftTypes.filter((shift) => typeof shift === "string" && shift !== currentShift);
    const fallback = extras.map((shift) => ({
      id: `shift-${shift}`,
      label: `Staff ${shift} next`,
      message: `Staff the ${shift} shift next.`,
    }));
    fallback.push({
      id: "done",
      label: "Done staffing",
      message: "We're done staffing.",
    });
    return { currentShift, otherShifts: extras, actions: fallback };
  }

  const filtered = currentShift
    ? actions.filter((action) => action.id !== `shift-${currentShift}`)
    : actions;
  if (filtered.length === 0) return null;
  return { currentShift, otherShifts, actions: filtered };
}

function otherQueueLabel(item: { currentQueueName?: string | null; currentQueueStatus?: string | null }) {
  if (!item.currentQueueName) return null;
  const statusLabel = item.currentQueueStatus === "inactive" ? "Inactive" : "Active";
  return `On ${item.currentQueueName} · ${statusLabel}`;
}

const FIELD_TO_QUESTION: Record<
  NonNullable<QueueGuidedDraft["nextField"]>,
  NonNullable<QueueDraft["question"]>
> = {
  name: "name",
  team: "team",
  description: "description",
  status: "status",
  businessHours: "business-hours",
  shifts: "shifts",
  staffing: "staffing",
  staffingMode: "staffing",
  shiftAgents: "staffing",
  agentChannels: "staffing",
  addAnotherAgent: "staffing",
  channels: "staffing",
  review: "review",
};

const QUESTION_TO_FIELD = {
  ...(Object.fromEntries(
    Object.entries(FIELD_TO_QUESTION).map(([field, question]) => [question, field]),
  ) as Record<NonNullable<QueueDraft["question"]>, NonNullable<QueueGuidedDraft["nextField"]>>),
  staffing: "staffing",
} as Record<NonNullable<QueueDraft["question"]>, NonNullable<QueueGuidedDraft["nextField"]>>;

const STAFFING_NEXT_FIELDS = new Set<NonNullable<QueueGuidedDraft["nextField"]>>([
  "staffing",
  "staffingMode",
  "shiftAgents",
  "agentChannels",
  "addAnotherAgent",
  "channels",
]);

function pickerItemFromUnknown(value: unknown): QueueAgentPickerItem | null {
  const row = asAgentChoice(value);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subtitle: row.workEmail ?? otherQueueLabel(row) ?? "",
    currentQueueId: row.currentQueueId,
    currentQueueName: row.currentQueueName,
    currentQueueStatus: row.currentQueueStatus,
  };
}

export function parseQueueStaffingForm(
  draft: Pick<QueueGuidedDraft, "staffingForm" | "agentChoices" | "nextField" | "fields"> | QueueDraft,
): QueueStaffingFormPayload | null {
  const nextField = "nextField" in draft ? draft.nextField : undefined;
  const question = "question" in draft ? draft.question : undefined;
  const raw = "staffingForm" in draft ? draft.staffingForm : undefined;
  const isStaffing =
    Boolean(raw) ||
    (typeof nextField === "string" && STAFFING_NEXT_FIELDS.has(nextField)) ||
    question === "staffing" ||
    question === "staffing-mode" ||
    question === "shift-agents" ||
    question === "agent-channels" ||
    question === "add-another-agent" ||
    question === "channels";
  if (!isStaffing) return null;

  const availableSource = raw?.available ?? ("agentChoices" in draft ? draft.agentChoices?.available : undefined);
  const elsewhereSource = raw?.elsewhere ?? ("agentChoices" in draft ? draft.agentChoices?.elsewhere : undefined);
  const available = (availableSource ?? [])
    .map((item) => pickerItemFromUnknown(item))
    .filter((item): item is QueueAgentPickerItem => item != null);
  const elsewhere = (elsewhereSource ?? [])
    .map((item) => pickerItemFromUnknown(item))
    .filter((item): item is QueueAgentPickerItem => item != null);

  const shiftTypes =
    normalizeShiftTypes(raw?.shiftTypes) ??
    ("fields" in draft ? normalizeShiftTypes(draft.fields?.shiftTypes) : undefined) ??
    ("shiftTypes" in draft ? draft.shiftTypes : undefined) ??
    [];
  if (shiftTypes.length === 0 && available.length === 0 && elsewhere.length === 0 && !raw) {
    return null;
  }

  const assignments =
    normalizeAssignments(raw?.assignments) ??
    ("fields" in draft ? normalizeAssignments(draft.fields?.shiftAgentAssignments) : undefined) ??
    ("shiftAgentAssignments" in draft ? draft.shiftAgentAssignments : undefined);

  const queueName =
    (typeof raw?.queueName === "string" && raw.queueName) ||
    ("fields" in draft && typeof draft.fields?.name === "string" ? draft.fields.name : undefined) ||
    ("name" in draft ? draft.name : undefined);

  return {
    shiftTypes,
    queueName,
    available,
    elsewhere,
    assignments,
    doneMessage: typeof raw?.doneMessage === "string" ? raw.doneMessage : undefined,
  };
}

export function queueDraftToGuidedDraft(draft: QueueDraft): QueueGuidedDraft | null {
  if (!draft.guided) return null;
  const nextField = draft.question ? QUESTION_TO_FIELD[draft.question] ?? null : null;
  const hoursSkipped = draft.businessHoursId === "";
  const fields: QueueGuidedDraft["fields"] = {};
  if (draft.name) fields.name = draft.name;
  if (draft.teamName) fields.teamName = draft.teamName;
  if (draft.teamId) fields.teamId = draft.teamId;
  if (draft.description !== undefined) fields.description = draft.description;
  if (draft.status) fields.status = draft.status;
  if (draft.businessHoursId !== undefined) fields.businessHoursId = draft.businessHoursId;
  if (draft.businessHoursName) fields.businessHoursName = draft.businessHoursName;
  if (hoursSkipped) fields.businessHoursSkipped = true;
  if (draft.shiftTypes?.length) fields.shiftTypes = draft.shiftTypes;
  if (draft.staffingMode) fields.staffingMode = draft.staffingMode;
  if (draft.staffingComplete) fields.staffingComplete = true;
  if (draft.staffingSkipped) fields.staffingSkipped = true;
  if (draft.currentShift) fields.currentShift = draft.currentShift;
  if (draft.currentAgentId) fields.currentAgentId = draft.currentAgentId;
  if (draft.currentAgentName) fields.currentAgentName = draft.currentAgentName;
  if (draft.shiftAgentAssignments) {
    fields.shiftAgentAssignments = draft.shiftAgentAssignments as Record<string, unknown>;
  }
  if (draft.channels?.length) fields.channels = draft.channels;
  return {
    mode: "create",
    fields,
    nextField,
    ready: draft.ready === true,
  };
}

const FIELD_TO_STEP: Record<
  NonNullable<QueueGuidedDraft["nextField"]>,
  NonNullable<QueueDraft["step"]>
> = {
  name: "details",
  team: "details",
  description: "details",
  status: "details",
  businessHours: "hours",
  shifts: "shifts",
  staffing: "agents",
  staffingMode: "agents",
  shiftAgents: "agents",
  agentChannels: "agents",
  addAnotherAgent: "agents",
  channels: "agents",
  review: "review",
};

export function normalizeQueueStatus(value: unknown): QueueStatus | undefined {
  if (value === "active" || value === "inactive") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/\binactive\b|\bdisabled\b|\boff\b|\bwait\b|\blater\b|\bpaused\b/.test(normalized)) {
    return "inactive";
  }
  if (/\bactive\b|\benabled\b|\bon\b|\blive\b/.test(normalized) && !/^inact/.test(normalized)) {
    return "active";
  }
  if (/^inact/.test(normalized)) return "inactive";
  if (/^act/.test(normalized)) return "active";

  const levenshtein = (a: string, b: string) => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      }
    }
    return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
  };

  const inactiveDistance = levenshtein(normalized, "inactive");
  const activeDistance = levenshtein(normalized, "active");
  if (inactiveDistance <= 2 && inactiveDistance < activeDistance) return "inactive";
  if (activeDistance <= 2 && activeDistance <= inactiveDistance) return "active";
  return undefined;
}

function normalizeShiftKey(value: string): ShiftType | undefined {
  return SHIFT_TYPES.find((shift) => shift.toLowerCase() === value.trim().toLowerCase());
}

function normalizeShiftTypes(value: unknown): ShiftType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<string>(SHIFT_TYPES);
  const shifts = value.filter((item): item is ShiftType => typeof item === "string" && allowed.has(item));
  return shifts.length ? shifts : undefined;
}

function normalizeChannels(value: unknown): QueueDraftChannel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<QueueDraftChannel>([
    "calls",
    "email",
    "chat",
    "whatsapp",
    "instagram",
    "facebook",
  ]);
  const channels = value.filter(
    (item): item is QueueDraftChannel => typeof item === "string" && allowed.has(item as QueueDraftChannel),
  );
  return channels.length ? channels : undefined;
}

function parseAssignmentRow(raw: Record<string, unknown>): ShiftAgentAssignment | undefined {
  const agentIds: string[] = [];
  const agentNames: string[] = [];
  const channelByAgentId: Record<string, QueueDraftChannel[]> = {};

  const agentsPayload = raw.agents;
  if (Array.isArray(agentsPayload)) {
    for (const item of agentsPayload) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? row.userId ?? row.agentId ?? "").trim();
      const name = String(row.name ?? row.agentName ?? "").trim();
      if (!id && !name) continue;
      agentIds.push(id || name);
      agentNames.push(name || id);
      const channels = normalizeChannels(row.channels);
      if (channels?.length) {
        if (id) channelByAgentId[id] = channels;
        if (name) channelByAgentId[name] = channels;
      }
    }
  } else {
    const rawIds = raw.agentIds;
    const rawNames = raw.agentNames;
    if (Array.isArray(rawIds)) {
      rawIds.forEach((item, index) => {
        if (typeof item !== "string") return;
        agentIds.push(item);
        const name = Array.isArray(rawNames) ? rawNames[index] : undefined;
        agentNames.push(typeof name === "string" ? name : "");
      });
    } else if (Array.isArray(rawNames)) {
      rawNames.forEach((item) => {
        if (typeof item !== "string") return;
        agentNames.push(item);
        agentIds.push("");
      });
    }

    const channelMap = raw.channelByAgentId;
    if (channelMap && typeof channelMap === "object") {
      for (const [key, channels] of Object.entries(channelMap as Record<string, unknown>)) {
        const normalized = normalizeChannels(channels);
        if (normalized?.length) channelByAgentId[key] = normalized;
      }
    }
  }

  if (!agentIds.length && !agentNames.length) return undefined;
  while (agentNames.length < agentIds.length) agentNames.push("");
  while (agentIds.length < agentNames.length) agentIds.push("");

  return {
    agentIds,
    agentNames,
    channelByAgentId: Object.keys(channelByAgentId).length ? channelByAgentId : undefined,
  };
}

function normalizeAssignments(value: unknown): Partial<Record<ShiftType, ShiftAgentAssignment>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const assignments: Partial<Record<ShiftType, ShiftAgentAssignment>> = {};
  for (const [shiftKey, raw] of entries) {
    const shift = normalizeShiftKey(shiftKey);
    if (!shift || !raw || typeof raw !== "object") continue;
    const parsed = parseAssignmentRow(raw as Record<string, unknown>);
    if (parsed) assignments[shift] = parsed;
  }
  return Object.keys(assignments).length ? assignments : undefined;
}

function mergeShiftAssignments(
  previous: Partial<Record<ShiftType, ShiftAgentAssignment>> | undefined,
  incoming: Partial<Record<ShiftType, ShiftAgentAssignment>> | undefined,
): Partial<Record<ShiftType, ShiftAgentAssignment>> | undefined {
  if (!incoming) return previous;
  const merged: Partial<Record<ShiftType, ShiftAgentAssignment>> = { ...(previous ?? {}) };

  for (const [shift, assignment] of Object.entries(incoming) as Array<[ShiftType, ShiftAgentAssignment]>) {
    const existing = merged[shift];
    if (!existing) {
      merged[shift] = assignment;
      continue;
    }

    const agentIds = [...existing.agentIds];
    const agentNames = [...existing.agentNames];
    const channelByAgentId = { ...(existing.channelByAgentId ?? {}) };

    assignment.agentIds.forEach((id, index) => {
      const name = assignment.agentNames[index] ?? "";
      const lookupId = id || name;
      const existingIndex = agentIds.findIndex((item, itemIndex) => {
        if (id && item === id) return true;
        const existingName = agentNames[itemIndex] ?? "";
        return Boolean(name) && existingName.toLowerCase() === name.toLowerCase();
      });

      if (existingIndex >= 0) {
        if (name) agentNames[existingIndex] = name;
        if (id) agentIds[existingIndex] = id;
      } else {
        agentIds.push(lookupId);
        agentNames.push(name || lookupId);
      }

      const channels =
        (id ? assignment.channelByAgentId?.[id] : undefined) ??
        (name ? assignment.channelByAgentId?.[name] : undefined) ??
        (lookupId ? assignment.channelByAgentId?.[lookupId] : undefined);
      if (channels?.length) {
        const targetId = agentIds[existingIndex >= 0 ? existingIndex : agentIds.length - 1] ?? lookupId;
        channelByAgentId[targetId] = channels;
        if (name) channelByAgentId[name] = channels;
      }
    });

    merged[shift] = {
      agentIds,
      agentNames,
      channelByAgentId: Object.keys(channelByAgentId).length ? channelByAgentId : undefined,
    };
  }

  return Object.keys(merged).length ? merged : undefined;
}

function syncSelectedAgents(next: QueueDraft) {
  const assignments = next.shiftAgentAssignments ?? {};
  const agentIds: string[] = [];
  const agentNames: string[] = [];

  for (const shift of next.shiftTypes ?? []) {
    const assignment = assignments[shift];
    if (!assignment) continue;
    assignment.agentIds.forEach((id, index) => {
      const name = assignment.agentNames[index] ?? id;
      const key = id || name;
      if (!agentIds.includes(key)) {
        agentIds.push(key);
        agentNames.push(name);
      }
    });
  }

  next.selectedAgentIds = agentIds.length ? agentIds : undefined;
  next.selectedAgentNames = agentNames.length ? agentNames : undefined;
  next.agentCount = agentIds.length;
}

/** Merge an LLM queue draft event into the running preview draft. */
export function queueGuidedDraftToQueueDraft(
  draft: QueueGuidedDraft,
  previous: QueueDraft = {},
): QueueDraft {
  const fields = draft.fields;
  const nextField = draft.nextField;
  const next: QueueDraft = {
    ...previous,
    guided: true,
    question: nextField ? FIELD_TO_QUESTION[nextField] : undefined,
    step: nextField ? FIELD_TO_STEP[nextField] : undefined,
    ready: draft.ready === true,
    skills: previous.skills ?? [],
    pendingStatus: undefined,
  };

  if (typeof fields.name === "string") next.name = fields.name;
  if (typeof fields.teamId === "string") next.teamId = fields.teamId;
  if (typeof fields.teamName === "string") next.teamName = fields.teamName;
  if ("description" in fields) {
    next.description = typeof fields.description === "string" ? fields.description : "";
  }

  const status = normalizeQueueStatus(fields.status);
  if (status) {
    next.status = status;
  }

  if (fields.businessHoursSkipped === true) {
    next.businessHoursId = "";
    next.businessHoursName =
      typeof fields.businessHoursName === "string" && fields.businessHoursName.trim()
        ? fields.businessHoursName
        : "Default (always open)";
  } else {
    if (typeof fields.businessHoursId === "string") next.businessHoursId = fields.businessHoursId;
    if (typeof fields.businessHoursName === "string") next.businessHoursName = fields.businessHoursName;
  }

  const shiftTypes = normalizeShiftTypes(fields.shiftTypes);
  if (shiftTypes) next.shiftTypes = shiftTypes;

  if (typeof fields.staffingMode === "string") {
    const mode = fields.staffingMode.trim().toLowerCase();
    next.staffingMode = mode.includes("all") ? "all" : mode.includes("specific") ? "specific" : fields.staffingMode;
  }
  if (fields.staffingComplete === true) next.staffingComplete = true;
  if (fields.staffingSkipped === true) {
    next.staffingSkipped = true;
    next.staffingComplete = true;
  }

  if (
    typeof fields.currentShift === "string" &&
    SHIFT_TYPES.includes(fields.currentShift as ShiftType)
  ) {
    next.currentShift = fields.currentShift as ShiftType;
  }

  if (typeof fields.currentAgentId === "string") next.currentAgentId = fields.currentAgentId;
  if (typeof fields.currentAgentName === "string") next.currentAgentName = fields.currentAgentName;

  const assignments = normalizeAssignments(fields.shiftAgentAssignments);
  if (assignments) {
    next.shiftAgentAssignments = mergeShiftAssignments(previous.shiftAgentAssignments, assignments);
    syncSelectedAgents(next);
  }

  if (!next.currentAgentName) {
    const inferred = lastAssignedAgent(next, next.currentShift);
    if (inferred.name) next.currentAgentName = inferred.name;
    if (inferred.id && !next.currentAgentId) next.currentAgentId = inferred.id;
  }

  const channels = normalizeChannels(fields.channels);
  if (channels) {
    next.channels = channels;
  }

  if (Array.isArray(draft.choices) && draft.choices.length > 0) {
    next.choices = draft.choices.filter((item): item is string => typeof item === "string");
    next.choicesLabel = typeof draft.choicesLabel === "string" ? draft.choicesLabel : undefined;
  } else if (
    nextField !== "team" &&
    nextField !== "businessHours" &&
    nextField !== "shifts"
  ) {
    next.choices = undefined;
    next.choicesLabel = undefined;
  }

  next.agentChoices = undefined;
  next.channelChoices = undefined;
  next.staffingActions = undefined;

  if (nextField && STAFFING_NEXT_FIELDS.has(nextField)) {
    const staffingForm = parseQueueStaffingForm(draft);
    if (staffingForm) {
      next.staffingForm = staffingForm;
      next.question = "staffing";
      next.step = "agents";
      if (!next.shiftTypes?.length && staffingForm.shiftTypes.length) {
        next.shiftTypes = staffingForm.shiftTypes;
      }
      if (staffingForm.assignments) {
        next.shiftAgentAssignments = mergeShiftAssignments(
          next.shiftAgentAssignments,
          staffingForm.assignments,
        );
        syncSelectedAgents(next);
      }
    }
  } else {
    next.staffingForm = undefined;
  }

  return next;
}
