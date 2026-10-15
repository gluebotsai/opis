import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Info, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router";

import { AgentAttentionDetailDialog } from "@/components/admin/agent-attention-detail-dialog";
import { Button } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { monitoringApi, type MonitoringSnapshot } from "@/features/monitoring/api";
import { cn } from "@/lib/utils";

const READ_ALERTS_KEY = "cc2-admin-notifications-read";

type SupervisorAlert = MonitoringSnapshot["alerts"][number] & (
  | {
      type: "agent_not_ready_escalated";
      agentId: string;
      escalationId: string;
      createdAt: string;
      insight?: {
        summary: string;
        suggestion: string;
        classification: string;
        classificationLabel?: string;
      };
    }
  | { type: "coworker_callback_assigned"; attemptId: string; taskId: string; createdAt: string }
  | {
      type: "sentiment_very_negative";
      conversationId: string;
      channel: string;
      customerName: string;
      agentName: string;
      queueName: string | null;
      subject: string | null;
      side: "customer" | "agent";
      createdAt: string;
    }
);

type EscalatedAlert = Extract<SupervisorAlert, { type: "agent_not_ready_escalated" }>;

function isSupervisorAlert(
  alert: MonitoringSnapshot["alerts"][number],
): alert is SupervisorAlert {
  if (alert.type === "agent_not_ready_escalated") {
    return (
      typeof alert.agentId === "string" &&
      typeof alert.escalationId === "string" &&
      typeof alert.createdAt === "string"
    );
  }
  if (alert.type === "coworker_callback_assigned") {
    return (
      typeof alert.attemptId === "string" &&
      typeof alert.taskId === "string" &&
      typeof alert.createdAt === "string"
    );
  }
  if (alert.type === "sentiment_very_negative") {
    return (
      typeof alert.conversationId === "string" &&
      typeof alert.channel === "string" &&
      typeof alert.customerName === "string" &&
      typeof alert.agentName === "string" &&
      typeof alert.createdAt === "string"
    );
  }
  return false;
}

function sortSupervisorAlertsByRecent(alerts: SupervisorAlert[]): SupervisorAlert[] {
  return [...alerts].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function readDismissedAlertIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(READ_ALERTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function dismissAlertId(id: string) {
  const next = readDismissedAlertIds();
  next.add(id);
  sessionStorage.setItem(READ_ALERTS_KEY, JSON.stringify([...next]));
}

function agentNameFromEscalatedAlert(alert: EscalatedAlert): string {
  const prefix = " needs attention";
  if (alert.title.endsWith(prefix)) {
    return alert.title.slice(0, -prefix.length);
  }
  return alert.title;
}

export function AdminNotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<SupervisorAlert[]>([]);
  const [agents, setAgents] = useState<MonitoringSnapshot["agents"]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedAlertIds());
  const [attentionDialog, setAttentionDialog] = useState<EscalatedAlert | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasLoadedOnceRef = useRef(false);

  const refresh = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? !hasLoadedOnceRef.current;
    if (showLoading) setLoading(true);
    try {
      const snapshot = await monitoringApi.getSnapshot();
      const supervisorAlerts = sortSupervisorAlertsByRecent(
        snapshot.alerts.filter(isSupervisorAlert),
      );
      setAlerts(supervisorAlerts);
      setAgents(snapshot.agents);
      hasLoadedOnceRef.current = true;
    } catch {
      // Keep last known alerts on refresh failure.
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh({ showLoading: false });
    const interval = window.setInterval(() => void refresh({ showLoading: false }), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const visibleAlerts = alerts.filter((alert) => !dismissedIds.has(alert.id));
  const unreadCount = visibleAlerts.length;

  function handleOpenMenu() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) void refresh({ showLoading: !hasLoadedOnceRef.current });
  }

  function markAlertRead(alert: SupervisorAlert) {
    dismissAlertId(alert.id);
    setDismissedIds((current) => new Set([...current, alert.id]));
  }

  function openEscalatedAttentionDialog(alert: EscalatedAlert) {
    markAlertRead(alert);
    setOpen(false);
    setAttentionDialog(alert);
  }

  async function openMonitoringForAlert(alert: SupervisorAlert) {
    if (alert.type === "agent_not_ready_escalated") {
      openEscalatedAttentionDialog(alert);
      return;
    }

    if (alert.type === "sentiment_very_negative") {
      markAlertRead(alert);
      setOpen(false);
      navigate("/admin/monitoring", {
        state: {
          tab: "queues",
          watchConversation: {
            id: alert.conversationId,
            channel: alert.channel,
            customer: alert.customerName,
            agentName: alert.agentName,
            queue: alert.queueName?.trim() || "—",
            intent: alert.subject?.trim() || "Active conversation",
          },
        },
      });
      return;
    }

    markAlertRead(alert);

    if (alert.type === "coworker_callback_assigned") {
      try {
        await monitoringApi.acknowledgeProactiveCallback(alert.attemptId);
        void refresh();
      } catch {
        // Navigation still helps even if acknowledge fails.
      }
      setOpen(false);
      navigate("/admin/monitoring", {
        state: { tab: "queues", highlightTaskId: alert.taskId },
      });
      return;
    }
  }

  async function handleViewAgentFromDialog(agentId: string, escalationId: string) {
    setAttentionDialog(null);
    try {
      await monitoringApi.acknowledgeNotReadyEscalation(escalationId);
      void refresh();
    } catch {
      // Navigation still helps even if acknowledge fails.
    }
    navigate("/admin/monitoring", {
      state: { tab: "agents", focusAgentId: agentId },
    });
  }

  async function dismissSingleAlert(alert: SupervisorAlert) {
    markAlertRead(alert);
    try {
      if (alert.type === "coworker_callback_assigned") {
        await monitoringApi.acknowledgeProactiveCallback(alert.attemptId);
      } else if (alert.type === "agent_not_ready_escalated") {
        await monitoringApi.acknowledgeNotReadyEscalation(alert.escalationId);
      }
      void refresh();
    } catch {
      // Dismissed locally even if acknowledge fails.
    }
  }

  function dismissAll() {
    for (const alert of visibleAlerts) {
      dismissAlertId(alert.id);
    }
    setDismissedIds(readDismissedAlertIds());
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <Button
          variant="panelIcon"
          aria-label="Supervisor notifications"
          className="relative text-neutral-700"
          onClick={handleOpenMenu}
        >
          <Bell />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white">
              {unreadCount}
            </span>
          ) : null}
        </Button>

        {open ? (
          <div className="absolute right-0 top-full z-30 mt-2 w-[22rem] overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-xl/30">
            <div className="flex items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-neutral-900">Supervisor alerts</p>
                <p className="text-xs text-neutral-600">
                  Agent attention, sentiment, and Co-worker callbacks
                </p>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-900"
                  onClick={dismissAll}
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loading && visibleAlerts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-neutral-600">Loading…</p>
              ) : null}
              {!loading && visibleAlerts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-neutral-600">No supervisor alerts</p>
              ) : null}
              {visibleAlerts.map((alert) => {
                const escalated = alert.type === "agent_not_ready_escalated";
                const sentiment = alert.type === "sentiment_very_negative";
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-start gap-1 transition hover:bg-neutral-50",
                      listRowDividerClassName("4"),
                      escalated || sentiment ? "bg-red-50/50" : "bg-sky-50/40",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
                      onClick={() => void openMonitoringForAlert(alert)}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                          escalated || sentiment
                            ? "bg-red-100 text-red-700"
                            : "bg-sky-100 text-sky-700",
                        )}
                      >
                        {escalated || sentiment ? (
                          <AlertTriangle className="size-4" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-neutral-900">
                            {alert.title}
                          </span>
                          {escalated ? (
                            <Info className="size-3.5 shrink-0 text-red-600" aria-hidden />
                          ) : null}
                          <span className="size-2 shrink-0 rounded-full bg-red-500" />
                        </span>
                        <span className="mt-0.5 block text-xs text-neutral-600">{alert.detail}</span>
                        <span className="mt-1 block text-[11px] text-neutral-400">
                          {escalated
                            ? "Open insight and coaching suggestion"
                            : sentiment
                              ? "Open the conversation to watch"
                              : "Open callbacks in Live Monitoring"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Dismiss ${alert.title}`}
                      className="mt-2.5 mr-2 shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-neutral-200/60 hover:text-neutral-700"
                      onClick={() => void dismissSingleAlert(alert)}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <AgentAttentionDetailDialog
        open={attentionDialog != null}
        agentId={attentionDialog?.agentId ?? ""}
        agentName={attentionDialog ? agentNameFromEscalatedAlert(attentionDialog) : ""}
        employeeId={
          attentionDialog
            ? agents.find((agent) => agent.agentId === attentionDialog.agentId)?.employeeId ?? null
            : null
        }
        escalationId={attentionDialog?.escalationId ?? ""}
        preview={
          attentionDialog?.insight
            ? {
                summary: attentionDialog.insight.summary,
                suggestion: attentionDialog.insight.suggestion,
                classification: attentionDialog.insight.classificationLabel,
              }
            : undefined
        }
        onClose={() => setAttentionDialog(null)}
        onViewAgent={(agentId, escalationId) => void handleViewAgentFromDialog(agentId, escalationId)}
      />
    </>
  );
}
