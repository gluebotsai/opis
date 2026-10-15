import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  ListTodo,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
} from "lucide-react";
import {
  CHIP_BASE,
  TONE_ACCENT,
  TONE_CAUTION,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  task: "Task",
  sms: "SMS",
};

export const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "task", label: "Task" },
  { value: "sms", label: "SMS" },
  { value: "note", label: "Note" },
];

export function activityTypeIcon(type: string): LucideIcon {
  switch (type) {
    case "call":
      return Phone;
    case "email":
      return Mail;
    case "meeting":
      return Calendar;
    case "sms":
      return MessageSquare;
    case "task":
      return ListTodo;
    default:
      return StickyNote;
  }
}

export function activityTypeTone(type: string): string {
  switch (type) {
    case "call":
      return TONE_ACCENT;
    case "email":
      return TONE_INFO;
    case "meeting":
      return TONE_CAUTION;
    case "sms":
      return TONE_SUCCESS;
    case "task":
      return TONE_WARNING;
    default:
      return TONE_MUTED;
  }
}

export function activityFeedStatusTone(
  status: "upcoming" | "overdue" | "logged" | string,
): string {
  switch (status) {
    case "upcoming":
      return `${CHIP_BASE} ${TONE_INFO}`;
    case "overdue":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    case "logged":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}

export function activityTypeDisplayLabel(type: string): string {
  return type === "meeting"
    ? "Schedule"
    : (ACTIVITY_TYPE_LABELS[type] ?? type);
}

export function ActivityTypeBadge({
  type,
  label,
  className = "",
}: {
  type: string;
  /** Overrides the type label, for rows the type alone describes poorly. */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`${CHIP_BASE} ${activityTypeTone(type)} ${className}`}>
      {label ?? activityTypeDisplayLabel(type)}
    </span>
  );
}

export function ActivityTypeIcon({
  type,
  size = "md",
  className = "",
}: {
  type: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = activityTypeIcon(type);
  const box = size === "sm" ? "size-8" : "size-9";
  const icon = size === "sm" ? "size-3.5" : "size-4";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${box} ${activityTypeTone(type)} ${className}`}
      aria-hidden
    >
      <Icon className={icon} strokeWidth={1.75} />
    </span>
  );
}
