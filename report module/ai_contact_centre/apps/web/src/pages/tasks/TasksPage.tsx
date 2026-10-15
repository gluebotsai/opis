import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { CopilotWorkspace } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { TasksSummaryPanel } from "@/components/tasks/tasks-summary-panel";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { ASSISTANT_REFRESH_TASKS } from "@/features/assistant/assistant-api";
import { tasksApi } from "@/features/tasks/api";
import type { AgentTask, AgentTaskTab } from "@/features/tasks/types";
import {
  filterTasksByTab,
  searchTasks,
  sortTasks,
  taskTabCounts,
} from "@/features/tasks/tasks-utils";
import { isSessionError } from "@/store/slices/auth-slice";

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTaskId = searchParams.get("task");
  const [expandedSide, setExpandedSide] = useState<"left" | "right">(
    selectedTaskId ? "right" : "left",
  );
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<AgentTaskTab>("admin_assigned");
  const { setRecordLabel } = useCopilotPage();

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tasksApi.listTasks();
      setTasks(result.tasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load tasks";
      if (!isSessionError(message)) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    function refreshTasks() {
      void loadTasks();
    }
    window.addEventListener(ASSISTANT_REFRESH_TASKS, refreshTasks);
    return () => window.removeEventListener(ASSISTANT_REFRESH_TASKS, refreshTasks);
  }, [loadTasks]);

  useEffect(() => {
    setExpandedSide(selectedTaskId ? "right" : "left");
  }, [selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    setRecordLabel(selectedTask?.title);
    return () => setRecordLabel(undefined);
  }, [selectedTask?.title, setRecordLabel]);

  const counts = useMemo(() => taskTabCounts(tasks), [tasks]);
  const visibleTasks = useMemo(() => {
    const filtered = filterTasksByTab(tasks, tab);
    return sortTasks(searchTasks(filtered, search));
  }, [search, tab, tasks]);

  function openTask(taskId: string) {
    setSearchParams({ task: taskId });
    setExpandedSide("right");
  }

  function closeTask() {
    setSearchParams({});
    setExpandedSide("left");
  }

  async function completeTask(taskId: string) {
    const { task } = await tasksApi.updateTask(taskId, "complete");
    setTasks((current) => current.map((item) => (item.id === taskId ? task : item)));
    await loadTasks();
  }

  async function dismissTask(taskId: string) {
    await tasksApi.updateTask(taskId, "dismiss");
    await loadTasks();
    closeTask();
  }

  async function acceptSuggestion(taskId: string) {
    const { task } = await tasksApi.updateTask(taskId, "accept_suggestion");
    setTasks((current) => current.map((item) => (item.id === taskId ? task : item)));
    await loadTasks();
  }

  return (
    <CopilotWorkspace
      title="My Tasks"
      subtitle="Callbacks and follow-ups from your conversations."
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={<EmbeddedCopilotPanel />}
    >
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          onClose={closeTask}
          onComplete={(taskId) => void completeTask(taskId)}
          onDismiss={(taskId) => void dismissTask(taskId)}
          onAcceptSuggestion={(taskId) => void acceptSuggestion(taskId)}
        />
      ) : (
        <TasksSummaryPanel
          tasks={visibleTasks}
          selectedId={selectedTaskId}
          search={search}
          tab={tab}
          counts={counts}
          loading={loading}
          error={error}
          onSearchChange={setSearch}
          onTabChange={setTab}
          onSelectTask={openTask}
          onRefresh={() => void loadTasks()}
        />
      )}
    </CopilotWorkspace>
  );
}
