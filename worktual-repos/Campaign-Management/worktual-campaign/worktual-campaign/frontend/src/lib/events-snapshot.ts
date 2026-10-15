/**
 * Events snapshot for reports / dashboard agents — server DB first, local cache fallback.
 */
import { listDraftEvents, listLaunchedEvents } from "@/lib/opportunity-events-store";
import { listFormSubmissions } from "@/lib/form-submissions-store";
import { fetchAgentEventsSnapshot } from "@/services/opportunity-events.api";

export function buildEventsSnapshotLocal() {
  const launched = listLaunchedEvents();
  const drafts = listDraftEvents();
  const submissions = launched.flatMap((ev) =>
    listFormSubmissions(ev.id).map((s) => ({
      id: s.id,
      formId: s.formId,
      formSlug: s.formSlug,
      answers: s.answers,
      createdAt: s.createdAt,
    })),
  );
  return {
    launched,
    drafts,
    submissions,
    captured_at: new Date().toISOString(),
    source: "local" as const,
  };
}

export async function buildEventsSnapshot() {
  try {
    const snap = await fetchAgentEventsSnapshot();
    return {
      launched: snap.launched,
      drafts: snap.drafts,
      submissions: snap.submissions,
      captured_at: snap.captured_at,
      source: snap.source === "server" ? ("server" as const) : ("local" as const),
    };
  } catch {
    return buildEventsSnapshotLocal();
  }
}
