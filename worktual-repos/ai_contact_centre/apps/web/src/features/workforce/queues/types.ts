export type QueueStatus = "active" | "inactive";

export type CallType = "inbound" | "outbound" | "both";

export type ShiftType = "Regular" | "Morning" | "Afternoon" | "Evening" | "Night" | "Custom";

export type WeekDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type Team = {
  id: string;
  name: string;
  status: "active" | "inactive";
  businessHoursId: string | null;
};

export type EligibleAgent = {
  id: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  teamId: string | null;
  skill: string | null;
  skills: string[];
  status: "active" | "inactive";
  businessHoursId: string | null;
  shiftTypes: ShiftType[];
  currentQueueId?: string | null;
  currentQueueName?: string | null;
  currentQueueStatus?: QueueStatus | null;
};

export type BusinessHourShift = {
  id: string;
  businessHoursId: string;
  shiftType: ShiftType;
  dayOfWeek: WeekDay;
  endDayOfWeek: WeekDay | null;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakStartTime: string | null;
  breakEndTime: string | null;
  breakStartTime2: string | null;
  breakEndTime2: string | null;
};

export type BusinessHours = {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
  status: "active" | "inactive";
  openTime: string | null;
  closeTime: string | null;
  workingDays: WeekDay[];
  shifts: BusinessHourShift[];
};

export type QueueAgent = {
  userId: string;
  /** Shift this agent covers on the queue (agents nest under shifts in setup UX). */
  shiftType: ShiftType;
  handlesCalls: boolean;
  handlesEmail: boolean;
  handlesChat: boolean;
  handlesWhatsapp: boolean;
  handlesInstagram: boolean;
  handlesFacebook: boolean;
  chatConcurrency: number;
  emailConcurrency: number;
  socialConcurrency: number;
  whatsappConcurrency: number;
  instagramConcurrency: number;
  facebookConcurrency: number;
  callType: CallType;
  firstName?: string | null;
  lastName?: string | null;
  workEmail?: string | null;
};

export type MissedCallbackGraceMinutes = 0 | 5 | 10 | 15 | 30;

export type Queue = {
  id: string;
  name: string;
  description: string | null;
  teamId: string;
  businessHoursId: string | null;
  shiftTypes: ShiftType[];
  skills: string[];
  status: QueueStatus;
  missedCallbackGraceMinutes: MissedCallbackGraceMinutes | null;
  maxHandleMinutes?: number;
  wrapUpMinutes?: number;
  maxWaitMode?: "unlimited" | "limited";
  maxWaitMinutes?: number | null;
  maxWaitCallback?: boolean;
  maxWaitVoicemail?: boolean;
  announcementFrequencySeconds?: number;
  announcementSlotId?: string;
  announcementAudioPath?: string | null;
  announcementAudioName?: string | null;
  createdAt: string;
  updatedAt: string;
  agents: QueueAgent[];
};

export type QueueInput = {
  name: string;
  description?: string | null;
  teamId: string;
  businessHoursId: string | null;
  shiftTypes: ShiftType[];
  skills?: string[];
  status: QueueStatus;
  missedCallbackGraceMinutes?: MissedCallbackGraceMinutes | null;
};

export type QueueListQuery = {
  page?: number;
  pageSize?: number;
  teamId?: string;
  status?: QueueStatus;
  sort?: "name" | "updatedAt" | "status";
  order?: "asc" | "desc";
};

export type QueueListResponse = {
  queues: Queue[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type QueueDraftChannel =
  | "calls"
  | "email"
  | "chat"
  | "whatsapp"
  | "instagram"
  | "facebook";

export type ShiftAgentAssignment = {
  agentIds: string[];
  agentNames: string[];
  channelByAgentId?: Partial<Record<string, QueueDraftChannel[]>>;
};

export type QueueDraft = {
  guided?: boolean;
  question?:
    | "name"
    | "team"
    | "description"
    | "status"
    | "business-hours"
    | "shifts"
    | "staffing"
    | "staffing-mode"
    | "shift-agents"
    | "agent-channels"
    | "add-another-agent"
    | "agents"
    | "channels"
    | "review";
  name?: string;
  description?: string;
  teamId?: string;
  teamName?: string;
  businessHoursId?: string;
  businessHoursName?: string;
  shiftTypes?: ShiftType[];
  skills?: string[];
  status?: QueueStatus;
  pendingStatus?: QueueStatus;
  staffingMode?: "specific" | "all" | string;
  staffingComplete?: boolean;
  staffingSkipped?: boolean;
  currentAgentId?: string;
  currentAgentName?: string;
  agentCount?: number;
  currentShift?: ShiftType;
  shiftsPendingAgents?: ShiftType[];
  shiftAgentAssignments?: Partial<Record<ShiftType, ShiftAgentAssignment>>;
  selectedAgentIds?: string[];
  selectedAgentNames?: string[];
  channels?: QueueDraftChannel[];
  step?: "details" | "hours" | "shifts" | "agents" | "channels" | "review";
  ready?: boolean;
  choices?: string[];
  choicesLabel?: string;
  agentChoices?: {
    shift?: string;
    queueName?: string;
    available: Array<{
      id: string;
      name: string;
      workEmail?: string | null;
      currentQueueId?: string | null;
      currentQueueName?: string | null;
      currentQueueStatus?: QueueStatus | null;
    }>;
    elsewhere: Array<{
      id: string;
      name: string;
      workEmail?: string | null;
      currentQueueId?: string | null;
      currentQueueName?: string | null;
      currentQueueStatus?: QueueStatus | null;
    }>;
  };
  channelChoices?: {
    agentId?: string;
    agentName: string;
    shift?: string;
    channels?: QueueDraftChannel[];
  };
  staffingActions?: {
    currentShift?: string;
    otherShifts?: string[];
    actions: Array<{ id: string; label: string; message: string }>;
  };
  staffingForm?: {
    shiftTypes: ShiftType[];
    queueName?: string;
    available: Array<{
      id: string;
      name: string;
      subtitle?: string;
      currentQueueId?: string | null;
      currentQueueName?: string | null;
      currentQueueStatus?: QueueStatus | null;
    }>;
    elsewhere: Array<{
      id: string;
      name: string;
      subtitle?: string;
      currentQueueId?: string | null;
      currentQueueName?: string | null;
      currentQueueStatus?: QueueStatus | null;
    }>;
    assignments?: Partial<Record<ShiftType, ShiftAgentAssignment>>;
    doneMessage?: string;
  };
};

export const MISSED_CALLBACK_GRACE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "0", label: "Immediate" },
  { value: "5", label: "After 5 minutes" },
  { value: "10", label: "After 10 minutes" },
  { value: "15", label: "After 15 minutes" },
  { value: "30", label: "After 30 minutes" },
] as const;

export type MissedCallbackGraceOptionValue =
  (typeof MISSED_CALLBACK_GRACE_OPTIONS)[number]["value"];

export function graceMinutesToOption(
  value: MissedCallbackGraceMinutes | null | undefined,
): MissedCallbackGraceOptionValue {
  if (value == null) return "off";
  return String(value) as MissedCallbackGraceOptionValue;
}

export function optionToGraceMinutes(
  value: MissedCallbackGraceOptionValue,
): MissedCallbackGraceMinutes | null {
  if (value === "off") return null;
  return Number(value) as MissedCallbackGraceMinutes;
}

export const SHIFT_TYPES: ShiftType[] = [
  "Regular",
  "Morning",
  "Afternoon",
  "Evening",
  "Night",
  "Custom",
];

export const QUEUE_DRAFT_CHANNELS: QueueDraftChannel[] = [
  "calls",
  "email",
  "chat",
  "whatsapp",
  "instagram",
  "facebook",
];

export const WEEK_DAYS: WeekDay[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function agentDisplayName(agent: EligibleAgent): string {
  return `${agent.firstName} ${agent.lastName}`.trim();
}

/** Shift tabs and times come from the business-hours template. Empty shifts stay visible. */
export function queueDisplayShiftTypes(
  templateShifts: Array<{ shiftType: ShiftType }>,
): ShiftType[] {
  return [...new Set(templateShifts.map((shift) => shift.shiftType).filter(Boolean))];
}

export function queueAgentProfile(
  agent: QueueAgent,
  agentById: Record<string, EligibleAgent>,
): EligibleAgent | undefined {
  const listed = agentById[String(agent.userId)];
  if (listed) return listed;
  const firstName = agent.firstName?.trim() ?? "";
  const lastName = agent.lastName?.trim() ?? "";
  const workEmail = agent.workEmail?.trim() ?? "";
  if (!firstName && !lastName && !workEmail) return undefined;
  return {
    id: String(agent.userId),
    firstName,
    lastName,
    workEmail,
    teamId: null,
    skill: null,
    skills: [],
    status: "active",
    businessHoursId: null,
    shiftTypes: [],
  };
}

export function emptyQueueAgent(userId: string, shiftType: ShiftType): QueueAgent {
  return {
    userId,
    shiftType,
    handlesCalls: false,
    handlesEmail: false,
    handlesChat: true,
    handlesWhatsapp: false,
    handlesInstagram: false,
    handlesFacebook: false,
    chatConcurrency: 1,
    emailConcurrency: 1,
    socialConcurrency: 1,
    whatsappConcurrency: 1,
    instagramConcurrency: 1,
    facebookConcurrency: 1,
    callType: "both",
  };
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 5);
}
