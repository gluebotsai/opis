import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { canManageCompliance, normalizeRole } from "@/lib/rbac";
import {
  dismissPrivacyRequest,
  executePrivacyRequest,
  fetchPrivacyRequests,
  type PrivacyRequest,
} from "@/services/privacy-requests";
import { useAppSelector } from "@/store";
import {
  CHIP_BASE,
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  SUCCESS_FLASH_CLASS,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  data_deletion: "Data deletion",
  data_access: "Data access",
};

function statusTone(status: string): string {
  switch (status) {
    case "pending_review":
      return `${CHIP_BASE} ${TONE_WARNING}`;
    case "executed":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "dismissed":
      return `${CHIP_BASE} ${TONE_MUTED}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}

function confidenceTone(confidence: string): string {
  switch (confidence) {
    case "high":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "medium":
      return `${CHIP_BASE} ${TONE_INFO}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}

/**
 * Deep-link review surface for privacy requests (email / in-app bell).
 * Not a Configuration nav module — admins arrive via notification CTA.
 */
export function PrivacyRequestsPage() {
  const { requestId } = useParams<{ requestId?: string }>();
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const [items, setItems] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPrivacyRequests();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems(result.items);
    } catch {
      setError("Failed to load privacy requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!requestId || loading) return;
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [requestId, loading, items]);

  if (!canManageCompliance(role)) {
    return <Navigate to="/" replace />;
  }

  const onExecute = async (item: PrivacyRequest) => {
    const confirmMsg =
      item.requestType === "data_deletion"
        ? `Permanently delete ${item.contactName ?? "this contact"} and all related CRM records? This cannot be undone.`
        : `Mark this data-access request as handled? You are responsible for actually sending the export outside the CRM.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(item.id);
    setError(null);
    try {
      const result = await executePrivacyRequest(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        item.requestType === "data_deletion"
          ? "Contact deleted."
          : "Request marked as executed.",
      );
      await reload();
    } catch {
      setError("Failed to execute privacy request.");
    } finally {
      setBusyId(null);
    }
  };

  const onDismiss = async (item: PrivacyRequest) => {
    if (!window.confirm("Dismiss this privacy request (no action taken)?")) return;
    setBusyId(item.id);
    setError(null);
    try {
      const result = await dismissPrivacyRequest(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("Request dismissed.");
      await reload();
    } catch {
      setError("Failed to dismiss privacy request.");
    } finally {
      setBusyId(null);
    }
  };

  const pending = items.filter((i) => i.status === "pending_review");
  const resolved = items.filter((i) => i.status !== "pending_review");
  const focused = requestId
    ? items.find((i) => i.id === requestId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className={PAGE_H1_CLASS}>Privacy request review</h1>
      <p className="mt-2 max-w-2xl text-sm text-text-secondary">
        You&rsquo;re here from an email or in-app alert. Approve to execute the
        request, or dismiss if it is not a real privacy action. The agent never
        deletes data on its own.
      </p>

      {message ? (
        <p className={`mt-4 text-sm ${SUCCESS_FLASH_CLASS}`} role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={`mt-4 text-sm ${TONE_DANGER}`} role="alert">
          {error}
        </p>
      ) : null}

      {requestId && !loading && !focused ? (
        <p className={`mt-4 text-sm ${TONE_WARNING}`} role="status">
          That request is not in the queue (already resolved or from another
          org). Showing all open items below.
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
        <h2 className={SECTION_H2_CLASS}>Needs review</h2>
        {loading ? (
          <p className="mt-3 text-sm text-text-caption">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-3 text-sm text-text-caption">
            No privacy requests waiting for review.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((item) => {
              const isFocus = item.id === requestId;
              return (
                <li
                  key={item.id}
                  ref={isFocus ? focusRef : undefined}
                  id={`privacy-request-${item.id}`}
                  className={`rounded-lg border p-4 ${
                    isFocus
                      ? "border-brand ring-2 ring-brand/30"
                      : "border-border-default"
                  }`}
                >
                  {isFocus ? (
                    <p className={`mb-2 text-xs font-medium ${TONE_WARNING}`}>
                      Opened from your notification
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        {item.contactName ?? "Unknown contact"}
                      </span>
                      <span className={`${CHIP_BASE} ${TONE_INFO}`}>
                        {REQUEST_TYPE_LABELS[item.requestType] ??
                          item.requestType}
                      </span>
                      <span className={confidenceTone(item.confidence)}>
                        {item.confidence} confidence
                      </span>
                    </div>
                    <span className="text-xs text-text-caption">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {item.reason ? (
                    <p className="mt-2 text-sm text-text-secondary">
                      {item.reason}
                    </p>
                  ) : null}

                  {item.draftConfirmation ? (
                    <div className="mt-3 rounded-lg bg-subtle p-3">
                      <p className="text-xs font-medium text-text-caption">
                        Draft acknowledgment (copy/send manually, or adapt)
                      </p>
                      <p className="mt-1 text-sm text-text-primary">
                        {item.draftConfirmation}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    <Link
                      to={`/contact/${item.contactId}`}
                      className="font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                    >
                      Open contact
                    </Link>
                    <Link
                      to={`/inbox?thread=${item.activityId}`}
                      className="font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                    >
                      Open inbox thread
                    </Link>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      className="h-9"
                      disabled={busyId === item.id}
                      onClick={() => void onExecute(item)}
                    >
                      {busyId === item.id
                        ? "Working…"
                        : item.requestType === "data_deletion"
                          ? "Approve & delete"
                          : "Approve as handled"}
                    </Button>
                    <Button
                      type="button"
                      variant="tertiary"
                      className="h-9"
                      disabled={busyId === item.id}
                      onClick={() => void onDismiss(item)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
        <h2 className={SECTION_H2_CLASS}>Recently resolved</h2>
        {resolved.length === 0 ? (
          <p className="mt-3 text-sm text-text-caption">Nothing resolved yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border-default">
            {resolved.slice(0, 25).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {item.contactName ?? "Unknown contact"}
                  </p>
                  <p className="text-xs text-text-caption">
                    {REQUEST_TYPE_LABELS[item.requestType] ?? item.requestType}
                    {" · "}
                    {item.reviewedAt
                      ? new Date(item.reviewedAt).toLocaleString()
                      : ""}
                  </p>
                </div>
                <span className={statusTone(item.status)}>{item.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
