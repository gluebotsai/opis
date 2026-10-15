import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router";

import type { ContactGuidedDraft, QueueGuidedDraft } from "@/features/assistant/assistant-api";

export type CopilotSurface =
  | "queues-list"
  | "queue-create"
  | "queue-edit"
  | "dashboard"
  | "analytics"
  | "inbox"
  | "contacts-list"
  | "contacts-detail"
  | "tasks-list"
  | "tasks-detail"
  | "monitoring"
  | "performance"
  | "other";

export type CopilotPerformancePeriod = {
  range?: "today" | "7d" | "30d";
  start?: string;
  end?: string;
};

export type CopilotPageSnapshot = {
  surface: CopilotSurface;
  path: string;
  queueId?: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  taskId?: string;
  conversationId?: string;
  recordLabel?: string;
  /** My Performance date window for NLP-scoped SQL */
  range?: "today" | "7d" | "30d";
  start?: string;
  end?: string;
  contactDraft?: ContactGuidedDraft | null;
  queueDraft?: QueueGuidedDraft | null;
  incidentId?: string;
};

type CopilotPageContextValue = {
  snapshot: CopilotPageSnapshot;
  setRecordLabel: (label: string | undefined) => void;
  setConversationId: (conversationId: string | undefined) => void;
  setWorkspaceContact: (contact: WorkspaceContactContext | undefined) => void;
  setPerformancePeriod: (period: CopilotPerformancePeriod | undefined) => void;
  setContactDraft: (draft: ContactGuidedDraft | null) => void;
  setQueueDraft: (draft: QueueGuidedDraft | null) => void;
  setIncidentId: (incidentId: string | undefined) => void;
};

export type WorkspaceContactContext = {
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

const CopilotPageContext = createContext<CopilotPageContextValue | null>(null);

function presentContactField(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const QUEUES_LIST_PATH = "/admin/workforce/queues";
const CONTACTS_PATHS = ["/admin/contacts", "/agent/contacts"];
const TASKS_PATH = "/agent/tasks";
const MONITORING_PATH = "/admin/monitoring";

function surfaceFromLocation(pathname: string, search: URLSearchParams): CopilotSurface {
  if (pathname === QUEUES_LIST_PATH) {
    if (search.get("create") === "1") return "queue-create";
    if (search.get("queue")) return "queue-edit";
    return "queues-list";
  }
  if (CONTACTS_PATHS.includes(pathname)) {
    return search.get("contact") ? "contacts-detail" : "contacts-list";
  }
  if (pathname === TASKS_PATH) {
    return search.get("task") ? "tasks-detail" : "tasks-list";
  }
  if (pathname === MONITORING_PATH) {
    return "monitoring";
  }
  if (pathname.includes("/performance")) return "performance";
  if (pathname.startsWith("/admin/dashboard/analytics")) return "analytics";
  if (pathname.startsWith("/admin/dashboard")) return "dashboard";
  if (pathname.startsWith("/agent/workspace") || pathname.startsWith("/admin/workspace")) {
    return "inbox";
  }
  return "other";
}

function queueIdFromLocation(pathname: string, search: URLSearchParams): string | undefined {
  if (pathname === QUEUES_LIST_PATH) {
    return search.get("queue") ?? undefined;
  }
  return undefined;
}

export function CopilotPageProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [recordLabel, setRecordLabel] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [workspaceContact, setWorkspaceContact] = useState<WorkspaceContactContext | undefined>();
  const [performancePeriod, setPerformancePeriod] = useState<
    CopilotPerformancePeriod | undefined
  >();
  const [contactDraft, setContactDraft] = useState<ContactGuidedDraft | null>(null);
  const [queueDraft, setQueueDraft] = useState<QueueGuidedDraft | null>(null);
  const [incidentId, setIncidentId] = useState<string | undefined>();

  const snapshot = useMemo<CopilotPageSnapshot>(
    () => {
      const surface = surfaceFromLocation(pathname, searchParams);
      const onWorkspace = surface === "inbox";
      return {
      surface,
      path: pathname,
      queueId: queueIdFromLocation(pathname, searchParams),
      contactId: onWorkspace
        ? presentContactField(workspaceContact?.contactId)
        : CONTACTS_PATHS.includes(pathname)
          ? searchParams.get("contact") ?? undefined
          : undefined,
      contactName: onWorkspace ? presentContactField(workspaceContact?.contactName) : undefined,
      contactEmail: onWorkspace ? presentContactField(workspaceContact?.contactEmail) : undefined,
      contactPhone: onWorkspace ? presentContactField(workspaceContact?.contactPhone) : undefined,
      taskId: pathname === TASKS_PATH ? searchParams.get("task") ?? undefined : undefined,
      conversationId: surface === "inbox"
        ? conversationId
        : undefined,
      recordLabel,
      contactDraft,
      queueDraft,
      incidentId:
        surface === "analytics" ? incidentId : undefined,
      ...(surface === "performance" ||
      surface === "dashboard" ||
      surface === "analytics"
        ? {
            range: performancePeriod?.range,
            start: performancePeriod?.start,
            end: performancePeriod?.end,
          }
        : {}),
    };
    },
    [contactDraft, conversationId, incidentId, pathname, performancePeriod, queueDraft, recordLabel, searchParams, workspaceContact],
  );

  const value = useMemo(
    () => ({
      snapshot,
      setRecordLabel,
      setConversationId,
      setWorkspaceContact,
      setPerformancePeriod,
      setContactDraft,
      setQueueDraft,
      setIncidentId,
    }),
    [snapshot],
  );

  return <CopilotPageContext.Provider value={value}>{children}</CopilotPageContext.Provider>;
}

export function useCopilotPage() {
  const ctx = useContext(CopilotPageContext);
  if (!ctx) {
    throw new Error("useCopilotPage must be used within CopilotPageProvider");
  }
  return ctx;
}
