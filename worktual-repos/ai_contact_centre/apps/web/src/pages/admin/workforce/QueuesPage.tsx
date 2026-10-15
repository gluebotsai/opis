import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { CopilotWorkspace } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { QueueSummaryPanel } from "@/components/assistant/queue-summary-panel";
import { GuidedQueueDraftPreview } from "@/components/workforce/guided-queue-preview";
import { QueueManagePanel } from "@/components/workforce/queue-manage-panel";
import { QueueModuleTabs } from "@/components/workforce/queue-module-tabs";
import { RoutingProfilePanel } from "@/components/workforce/routing-profile-panel";
import { ASSISTANT_REFRESH_QUEUES, ASSISTANT_QUEUE_DRAFT } from "@/features/assistant/assistant-api";
import type { QueueGuidedDraft } from "@/features/assistant/assistant-api";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { queueDraftToGuidedDraft } from "@/features/assistant/queue-guided-draft";
import { queuesApi } from "@/features/workforce/queues/api";
import { useQueueDraft } from "@/features/workforce/queues/queue-draft-context";
import { isSessionError } from "@/store/slices/auth-slice";
import type { BusinessHours, Queue, QueueStatus, Team } from "@/features/workforce/queues/types";

export default function QueuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { draft, clearDraft } = useQueueDraft();
  const { setQueueDraft: setPageQueueDraft } = useCopilotPage();
  const selectedQueueId = searchParams.get("queue");
  const routingTab = searchParams.get("tab") === "routing";
  const createMode = searchParams.get("create") === "1" && !selectedQueueId;
  const editMode = searchParams.get("edit") === "1";
  const [expandedSide, setExpandedSide] = useState<"left" | "right">(
    selectedQueueId ? "right" : "left",
  );
  const [queues, setQueues] = useState<Queue[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [schedules, setSchedules] = useState<BusinessHours[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedQueueId) {
      setExpandedSide("right");
      return;
    }
    if (!createMode && !draft.guided) {
      setExpandedSide("left");
    }
  }, [selectedQueueId, createMode, draft.guided]);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const [queuesRes, teamsRes, hoursRes] = await Promise.all([
        queuesApi.listQueues({
          sort: "updatedAt",
          order: "desc",
          pageSize: 100,
        }),
        queuesApi.listTeams(),
        queuesApi.listBusinessHours(),
      ]);
      setQueues(queuesRes.queues);
      setTeams(teamsRes.teams);
      setSchedules(hoursRes.schedules);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load queues";
      if (!isSessionError(message)) {
        setError(message);
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPageQueueDraft(queueDraftToGuidedDraft(draft));
    return () => setPageQueueDraft(null);
  }, [draft, setPageQueueDraft]);

  const showingRouting = routingTab && !selectedQueueId && !createMode && !draft.guided;
  const showingList = !selectedQueueId && !createMode && !draft.guided && !showingRouting;
  const wasShowingList = useRef(showingList);

  useEffect(() => {
    const returningToList = showingList && !wasShowingList.current;
    wasShowingList.current = showingList;
    if (returningToList) {
      void load({ silent: true });
    }
  }, [showingList]);

  useEffect(() => {
    function onRefresh() {
      void load({ silent: true });
    }
    function showQueueDraft(event: Event) {
      const detail = (event as CustomEvent<QueueGuidedDraft>).detail;
      if (!detail) return;
      setExpandedSide("right");
      if (!selectedQueueId && !createMode) {
        setSearchParams({ create: "1" });
      }
    }
    window.addEventListener(ASSISTANT_REFRESH_QUEUES, onRefresh);
    window.addEventListener(ASSISTANT_QUEUE_DRAFT, showQueueDraft);
    return () => {
      window.removeEventListener(ASSISTANT_REFRESH_QUEUES, onRefresh);
      window.removeEventListener(ASSISTANT_QUEUE_DRAFT, showQueueDraft);
    };
  }, [createMode, selectedQueueId, setSearchParams]);

  const teamNameById = useMemo(
    () => Object.fromEntries(teams.map((team) => [team.id, team.name])),
    [teams],
  );
  const hoursNameById = useMemo(
    () => Object.fromEntries(schedules.map((schedule) => [schedule.id, schedule.name])),
    [schedules],
  );

  function openQueue(queueId: string) {
    setSearchParams({ queue: queueId });
    setExpandedSide("right");
  }

  function exitQueueEdit(queueId: string) {
    setSearchParams({ queue: queueId });
  }

  function openCreate() {
    setSearchParams({ create: "1" });
  }

  function setModuleTab(tab: "queue" | "routing") {
    if (tab === "routing") {
      setSearchParams({ tab: "routing" });
    } else {
      setSearchParams({});
    }
    setExpandedSide("left");
  }

  function closePanel() {
    setSearchParams({});
    setExpandedSide("left");
  }

  async function handleStatusChange(queue: Queue, status: QueueStatus) {
    if (queue.status === status) return;
    if (
      status === "inactive" &&
      !window.confirm(
        `Set "${queue.name}" to Inactive? New conversations will not route to this queue.`,
      )
    ) {
      return;
    }

    const previous = queue.status;
    setStatusUpdatingId(queue.id);
    setError(null);
    setQueues((prev) =>
      prev.map((item) =>
        item.id === queue.id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
      ),
    );
    try {
      const { queue: updated } = await queuesApi.updateQueue(queue.id, { status });
      setQueues((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setQueues((prev) =>
        prev.map((item) => (item.id === queue.id ? { ...item, status: previous } : item)),
      );
      setError(err instanceof Error ? err.message : "Failed to update queue status");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  function handleQueueSaved(queueId: string) {
    void load();
    setSearchParams({ queue: queueId });
    setExpandedSide("right");
  }

  function closeGuidedPreview() {
    if (
      !window.confirm("Discard this queue setup? Your answers in the conversation will be cleared.")
    ) {
      return;
    }
    clearDraft();
    if (createMode) {
      closePanel();
    }
  }

  return (
    <CopilotWorkspace
        title="Queues"
        subtitle="Create queues, assign agents to shifts, and configure their channels."
        expandedSide={expandedSide}
        onExpandedSideChange={setExpandedSide}
        copilot={<EmbeddedCopilotPanel onOpenQueue={openQueue} />}
      >
        {selectedQueueId ? (
          <QueueManagePanel
            key={selectedQueueId}
            mode="edit"
            queueId={selectedQueueId}
            initialEditing={editMode}
            onClose={closePanel}
            onSaved={handleQueueSaved}
            onDeleted={(queueId) => {
              setQueues((prev) => prev.filter((queue) => queue.id !== queueId));
              closePanel();
              void load({ silent: true });
            }}
            onExitEdit={() => exitQueueEdit(selectedQueueId)}
          />
        ) : draft.guided ? (
          <GuidedQueueDraftPreview draft={draft} onClose={closeGuidedPreview} />
        ) : createMode ? (
          <QueueManagePanel
            key="create"
            mode="create"
            onClose={closePanel}
            onSaved={handleQueueSaved}
          />
        ) : showingRouting ? (
          <RoutingProfilePanel onModuleTabChange={setModuleTab} />
        ) : (
          <QueueSummaryPanel
            queues={queues}
            teamNameById={teamNameById}
            hoursNameById={hoursNameById}
            search={search}
            onSearchChange={setSearch}
            loading={loading}
            error={error}
            statusUpdatingId={statusUpdatingId}
            onStatusChange={(queue, status) => void handleStatusChange(queue, status)}
            onSelectQueue={openQueue}
            onCreateQueue={openCreate}
            onRefresh={() => void load()}
            moduleTabs={<QueueModuleTabs value="queue" onChange={setModuleTab} />}
          />
        )}
    </CopilotWorkspace>
  );
}
