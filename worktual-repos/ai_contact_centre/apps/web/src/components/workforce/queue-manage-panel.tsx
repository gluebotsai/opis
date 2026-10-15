import { useEffect, useRef, useState } from "react";
import { ChevronLeft, LoaderCircle, Pencil, Trash2 } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { Button, IconButton } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { GuidedQueueDraftPreview } from "@/components/workforce/guided-queue-preview";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { QueueEditor, type QueueEditorHandle } from "@/components/workforce/queue-editor";
import { QueuePreview } from "@/components/workforce/queue-preview";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { queuesApi } from "@/features/workforce/queues/api";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { useQueueDraft } from "@/features/workforce/queues/queue-draft-context";
import type {
  BusinessHours,
  EligibleAgent,
  Queue,
  QueueStatus,
  Team,
} from "@/features/workforce/queues/types";

type QueueManagePanelProps = {
  mode: "create" | "edit";
  queueId?: string;
  initialEditing?: boolean;
  onClose: () => void;
  onSaved: (queueId: string) => void;
  onDeleted?: (queueId: string) => void;
  onExitEdit?: () => void;
};

export function QueueManagePanel({
  mode,
  queueId,
  initialEditing = false,
  onClose,
  onSaved,
  onDeleted,
  onExitEdit,
}: QueueManagePanelProps) {
  const isCreate = mode === "create";
  const editorRef = useRef<QueueEditorHandle>(null);
  const [queueName, setQueueName] = useState("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [schedules, setSchedules] = useState<BusinessHours[]>([]);
  const [eligibleAgents, setEligibleAgents] = useState<EligibleAgent[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(isCreate || initialEditing);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { setRecordLabel } = useCopilotPage();
  const { draft, clearDraft } = useQueueDraft();

  useEffect(() => {
    setIsEditing(isCreate || initialEditing);
    setConfirmingDelete(false);
  }, [isCreate, initialEditing, queueId]);

  useEffect(() => {
    setRecordLabel(queueName || undefined);
    return () => setRecordLabel(undefined);
  }, [queueName, setRecordLabel]);

  useEffect(() => {
    if (isCreate || !queueId) {
      setQueue(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadQueueDetail() {
      setLoading(true);
      setLoadError(null);
      try {
        const [queueRes, teamsRes, agentsRes, hoursRes] = await Promise.all([
          queuesApi.getQueue(queueId!),
          queuesApi.listTeams(),
          queuesApi.listEligibleAgents(queueId),
          queuesApi.listBusinessHours(),
        ]);
        if (cancelled) return;
        setQueue(queueRes.queue);
        setQueueName(queueRes.queue.name);
        setTeams(teamsRes.teams);
        setEligibleAgents(agentsRes.agents);
        setSchedules(hoursRes.schedules);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load queue");
          setQueue(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadQueueDetail();
    return () => {
      cancelled = true;
    };
  }, [isCreate, queueId]);

  const team = teams.find((item) => item.id === queue?.teamId) ?? null;
  const schedule =
    schedules.find((item) => item.id === queue?.businessHoursId) ?? null;

  function confirmClose() {
    if (!dirty) return true;
    return window.confirm("You have unsaved changes. Discard them and leave?");
  }

  function handleClose() {
    if (isEditing && dirty && !confirmClose()) return;
    if (isCreate) clearDraft();
    onClose();
  }

  function handleCancelEdit() {
    if (dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    setDirty(false);
    setIsEditing(false);
    onExitEdit?.();
  }

  function handleStartEdit() {
    setIsEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await editorRef.current?.save();
      if (isCreate) {
        clearDraft();
        setDirty(false);
        return;
      }
      setDirty(false);
      setIsEditing(false);
      onExitEdit?.();
    } finally {
      setSaving(false);
    }
  }

  function requestDelete() {
    if (!queueId || isCreate) return;
    setLoadError(null);
    setConfirmingDelete(true);
  }

  async function handleDelete() {
    if (!queueId || isCreate) return;
    setDeleting(true);
    setLoadError(null);
    try {
      await queuesApi.deleteQueue(queueId);
      if (onDeleted) {
        onDeleted(queueId);
      } else {
        onClose();
      }
    } catch (err) {
      setConfirmingDelete(false);
      setLoadError(err instanceof Error ? err.message : "Failed to delete queue");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleStatus(status: QueueStatus) {
    if (!queue || togglingStatus) return;
    setTogglingStatus(true);
    setLoadError(null);
    try {
      const { queue: updated } = await queuesApi.updateQueue(queue.id, { status });
      setQueue(updated);
      onSaved(updated.id);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to update queue status");
    } finally {
      setTogglingStatus(false);
    }
  }

  async function handleEditorSaved(savedQueueId: string) {
    if (isCreate) {
      onSaved(savedQueueId);
      return;
    }

    try {
      const [{ queue: refreshed }, agentsRes] = await Promise.all([
        queuesApi.getQueue(savedQueueId),
        queuesApi.listEligibleAgents(savedQueueId),
      ]);
      setQueue(refreshed);
      setQueueName(refreshed.name);
      setEligibleAgents(agentsRes.agents);
      onSaved(savedQueueId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to refresh queue");
      onSaved(savedQueueId);
    }
  }

  if (isCreate && draft.guided) {
    return <GuidedQueueDraftPreview draft={draft} onClose={handleClose} />;
  }

  const headerTitle = isCreate
    ? "New queue"
    : isEditing
      ? "Edit queue"
      : "Queue profile";

  return (
    <div className={contentPanelClassName}>
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-3 ${contentPanelHeaderBorderClassName}`}>
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            variant="ghostIcon"
            onClick={isEditing && !isCreate ? handleCancelEdit : handleClose}
            className="shrink-0 [&_svg]:size-[18px]"
            aria-label={isEditing && !isCreate ? "Back to queue profile" : "Back to queues"}
          >
            <ChevronLeft />
          </IconButton>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-neutral-900">{headerTitle}</h2>
            {isEditing ? (
              <p className="mt-0.5 truncate text-sm text-neutral-600">
                {isCreate ? "Add queue details" : "Update queue details"}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isCreate && isEditing ? (
            <>
              {dirty ? (
                <Button onClick={() => void handleSave()} disabled={saving || deleting || loading}>
                  {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                  Save
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handleCancelEdit} disabled={saving || deleting}>
                Cancel
              </Button>
              <IconButton
                variant="ghostIconDanger"
                onClick={requestDelete}
                disabled={deleting || saving}
                aria-label="Delete queue"
              >
                <Trash2 />
              </IconButton>
            </>
          ) : !isCreate ? (
            <>
              <IconButton
                onClick={handleStartEdit}
                aria-label="Edit queue"
                disabled={loading || !queue}
              >
                <Pencil />
              </IconButton>
              <IconButton
                variant="ghostIconDanger"
                onClick={requestDelete}
                disabled={loading || !queue || deleting}
                aria-label="Delete queue"
              >
                <Trash2 />
              </IconButton>
            </>
          ) : null}
          <PanelExpandButton side="right" />
        </div>
      </div>

      {confirmingDelete ? (
        <div className="mx-4 mt-3 shrink-0">
          <StatusBanner
            tone="warning"
            title="Delete this queue?"
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  Delete
                </Button>
              </>
            }
          >
            “{queueName || "This queue"}” and all agent assignments will be removed. This cannot be undone.
          </StatusBanner>
        </div>
      ) : null}

      {loadError ? (
        <div className="mx-4 mt-3 shrink-0">
          <StatusBanner tone="error">{loadError}</StatusBanner>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading queue…
        </div>
      ) : !isCreate && !queue ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-600">
          Queue not found.
        </div>
      ) : (
        <PanelScrollArea className="min-h-0 flex-1">
          <div className="space-y-[16px] px-4 py-4">
            {isEditing ? (
              <QueueEditor
                ref={editorRef}
                mode={mode}
                queueId={queueId}
                embedded
                onQueueNameChange={setQueueName}
                onDirtyChange={setDirty}
                onSaved={handleEditorSaved}
              />
            ) : queue ? (
              <QueuePreview
                queue={queue}
                team={team}
                schedule={schedule}
                eligibleAgents={eligibleAgents}
                togglingStatus={togglingStatus}
                onToggleStatus={handleToggleStatus}
              />
            ) : null}
          </div>
        </PanelScrollArea>
      )}

      {isCreate && !loading ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || deleting}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </div>
      ) : null}
    </div>
  );
}
