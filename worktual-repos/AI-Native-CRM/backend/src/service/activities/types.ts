import type { ActivityType, TaskStatus } from "@prisma/client";

export type ActivityFeedStatus = "upcoming" | "overdue" | "logged";

export type ActivityFeedItem = {
  id: string;
  type: ActivityType;
  subject: string;
  bodyPreview: string | null;
  disposition: string | null;
  dueAt: string | null;
  createdAt: string;
  status: ActivityFeedStatus;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  companyId: string | null;
  companyName: string | null;
  createdByUserId: string | null;
  assigneeUserId: string | null;
  taskStatus: TaskStatus | null;
  threadId: string | null;
  gmailThreadId: string | null;
  emailDirection: "outbound" | "inbound" | null;
  folder: string;
};

export type ActivityStats = {
  total: number;
  upcoming: number;
  overdue: number;
  logged: number;
};
