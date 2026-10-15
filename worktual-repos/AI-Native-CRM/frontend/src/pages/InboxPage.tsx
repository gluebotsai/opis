import { useCallback, useEffect, useRef, useState } from "react";
import { InboxClient } from "@/components/inbox/InboxClient";
import {
  fetchInboxContacts,
  fetchInboxThreads,
  type InboxContactOption,
  type InboxItem,
} from "@/services/inbox";
import { InboxPageSkeleton } from "./InboxPageSkeleton";

export function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [contacts, setContacts] = useState<InboxContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Monotonic fetch id — never apply an older response over a newer one. */
  const reloadSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const reload = useCallback(async (_opts?: { force?: boolean }) => {
    const seq = ++reloadSeqRef.current;
    try {
      const [threads, contactResult] = await Promise.all([
        fetchInboxThreads(80),
        fetchInboxContacts(),
      ]);
      // Drop only if a newer fetch already painted (or is about to from a
      // later completion). Comparing against appliedSeq lets a post-sync
      // response land even when a concurrent poll bumped reloadSeq.
      if (seq < appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      setItems(threads.items);
      setContacts(contactResult.contacts);
      setError(null);
    } catch {
      if (seq < appliedSeqRef.current) return;
      setError("Failed to load inbox. Retrying in the background…");
    } finally {
      if (seq >= appliedSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return <InboxPageSkeleton />;
  }

  return (
    <div className="crm-fade-in flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      {error ? (
        <p
          className="shrink-0 border-b border-[#bfbfbf]/80 bg-white px-4 py-2 text-sm text-text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <InboxClient items={items} contacts={contacts} onReload={reload} />
      </div>
    </div>
  );
}
