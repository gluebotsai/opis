import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  decideProcessConfirmationRequest,
  fetchProcessConfirmations,
  type ProcessConfirmationItem,
} from "@/services/process-confirmations";
import { ProcessApprovalsPageSkeleton } from "./ProcessApprovalsPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { BackLink } from "@/components/ui/BackLink";
import {
  CHIP_BASE,
  PAGE_H1_CLASS,
  TONE_WARNING,
} from "@/lib/ui-tones";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";

function actionLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

export function ProcessApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("id");
  const [items, setItems] = useState<ProcessConfirmationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [selectedSlots, setSelectedSlots] = useState<Record<string, string>>(
    {},
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProcessConfirmations("pending");
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ordered = useMemo(() => {
    if (!focusId) return items;
    const focus = items.find((i) => i.id === focusId);
    if (!focus) return items;
    return [focus, ...items.filter((i) => i.id !== focusId)];
  }, [items, focusId]);

  const decide = (id: string, decision: "approved" | "rejected") => {
    startTransition(async () => {
      setError(null);
      const res = await decideProcessConfirmationRequest(id, {
        decision,
        selectedSlotIso: selectedSlots[id] || null,
      });
      if (!res.ok) {
        setError(res.error || "Could not apply decision.");
        return;
      }
      if (focusId === id) {
        setSearchParams({}, { replace: true });
      }
      await reload();
    });
  };

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="process-approvals"
        title="Process approvals"
        welcome="I'm your **approvals agent**. Ask me about pending confirmations — the approval list stays fully usable on the right."
        chips={[
          {
            id: "chip-help",
            label: "What can you help with?",
            prompt: "What can you help me do with process approvals?",
          },
        ]}
        surface="list"
        workspace={<ProcessApprovalsPageSkeleton />}
      />
    );
  }

  const workspace = (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className={PAGE_H1_CLASS}>Process approvals</h1>
        <p className="mt-1 text-sm text-text-secondary">
          High-risk post-meeting actions need your confirmation before emailing
          the customer or closing commercially.
        </p>
      </div>

      {error ? (
        <p
          className="mb-4 rounded-lg border border-[#f5c6cb] bg-[#fdecea] px-3 py-2 text-sm text-text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {ordered.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm text-text-secondary">No pending approvals.</p>
          <BackLink to="/contact" className="mt-3">
            Back to contacts
          </BackLink>
        </div>
      ) : (
        <ul className="crm-fade-in space-y-4">
          {ordered.map((item) => {
            const payload = item.payload || {};
            const alts = Array.isArray(payload.alternatives)
              ? (payload.alternatives as Array<{
                  iso?: string;
                  label?: string;
                }>)
              : [];
            const brief =
              payload.brief && typeof payload.brief === "object"
                ? (payload.brief as { narrative?: string })
                : null;

            return (
              <li
                key={item.id}
                className={`rounded-md border bg-surface px-4 py-4 ${
                  focusId === item.id
                    ? "border-brand"
                    : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs uppercase tracking-wide text-text-caption">
                      {actionLabel(item.actionKind)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${CHIP_BASE} ${TONE_WARNING}`}>
                      Pending
                    </span>
                    <Link
                      to={`/contact/${item.contactId}`}
                      className="text-xs text-brand hover:underline"
                    >
                      Open contact
                    </Link>
                  </div>
                </div>
                {item.summary ? (
                  <RichStructuredContent
                    className="mt-2"
                    text={item.summary}
                    variant="compact"
                  />
                ) : null}
                {brief?.narrative ? (
                  <div className="mt-3 max-h-40 overflow-auto">
                    <RichStructuredContent
                      text={brief.narrative}
                      variant="document"
                    />
                  </div>
                ) : null}
                {alts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-text-caption">
                      Optional: book one slot instead of emailing alternatives
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {alts.map((a) => {
                        if (!a.iso) return null;
                        const selected = selectedSlots[item.id] === a.iso;
                        return (
                          <button
                            key={a.iso}
                            type="button"
                            onClick={() =>
                              setSelectedSlots((prev) => ({
                                ...prev,
                                [item.id]:
                                  prev[item.id] === a.iso ? "" : a.iso!,
                              }))
                            }
                            className={`rounded border px-2.5 py-1 text-xs ${
                              selected
                                ? "border-brand bg-brand/10 text-brand"
                                : "border-border text-text-secondary hover:border-brand/40"
                            }`}
                          >
                            {a.label || a.iso}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide(item.id, "approved")}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {selectedSlots[item.id] ? "Approve & book" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide(item.id, "rejected")}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-subtle disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="process-approvals"
      title="Process approvals"
      welcome="I'm your **approvals agent**. Ask me about pending confirmations — the approval list stays fully usable on the right."
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with process approvals?",
        },
      ]}
      surface="list"
      workspace={workspace}
      onAfterTool={() => void reload()}
    />
  );
}
