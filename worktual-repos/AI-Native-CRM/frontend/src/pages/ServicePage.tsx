import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchServiceTickets, type ServiceTicketRow } from "@/services/service";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  CHIP_BASE,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

function serviceTicketStatusTone(status: string): string {
  switch (status.toLowerCase()) {
    case "open":
    case "new":
      return `${CHIP_BASE} ${TONE_INFO}`;
    case "in_progress":
    case "pending":
      return `${CHIP_BASE} ${TONE_WARNING}`;
    case "resolved":
    case "closed":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "cancelled":
    case "canceled":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}

export function ServicePage() {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<ServiceTicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchServiceTickets();
      setConfigured(data.configured);
      setItems(data.items);
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Service.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workspace = (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {loading ? (
        <p className="text-sm text-text-caption">Loading tickets…</p>
      ) : !configured ? (
        <div className="rounded-xl border border-dashed border-border-default bg-subtle px-6 py-12 text-center text-sm text-text-caption">
          Service MS is not configured. Set{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">
            SERVICE_MS_URL
          </code>{" "}
          to enable ticket list and onboarding handoff.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-default bg-surface px-6 py-8 text-sm text-text-danger">
          {error}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
          {items.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-text-caption">
              No tickets returned from Service MS.
            </div>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-default bg-subtle text-text-caption">
                <tr>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Deal</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border-default/70 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {t.subject}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {t.companyName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {t.dealId ? (
                        <Link
                          to={`/sales/${t.dealId}`}
                          className="text-text-link hover:underline"
                        >
                          View deal
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={serviceTicketStatusTone(t.status)}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-caption">
                      {t.createdAt
                        ? new Date(t.createdAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="service"
      title="Service"
      welcome="I'm your **service agent**. Ask me about open tickets — the ticket list stays fully usable on the right."
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do in Service?",
        },
      ]}
      surface="list"
      workspaceTitle="Service"
      workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.service}
      workspace={workspace}
      onAfterTool={() => void load()}
    />
  );
}
