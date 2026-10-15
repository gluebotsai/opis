import type { StructuredAnalytics } from "@/services/agent-stream";

export type CoworkerAttachment = {
  name: string;
  size: number;
  kind?: "pdf" | "csv" | "file";
};

export type CoworkerEmailDraft = {
  draftId: string;
  to: string;
  subject: string;
  body: string;
  contactId?: string;
  scheduleId?: string;
  sendAt?: string;
  status: "draft" | "scheduled" | "sent";
  error?: string;
};

export type CoworkerMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  /** Workspace-button prompt sent to the agent — do not render in chat. */
  hidden?: boolean;
  attachment?: CoworkerAttachment;
  analytics?: StructuredAnalytics;
  /** Saved Inbox draft that stays in the thread with Send now. */
  emailDraft?: CoworkerEmailDraft;
};

export type CoworkerSuggestion = {
  id: string;
  label: string;
  /** If set, applied as a composer fill; otherwise used as send text. */
  prompt: string;
};

export type PanelExpand = "default" | "chat" | "draft" | "chatFull";
