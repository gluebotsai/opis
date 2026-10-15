import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { buildCopilotSilentFallback } from "@/features/assistant/copilot-silent-fallback";
import {
  ASSISTANT_CANCEL_CONTACT_PREVIEW,
  ASSISTANT_CONTACT_DRAFT,
  ASSISTANT_CONTACT_PREVIEW,
  ASSISTANT_QUEUE_DRAFT,
  ASSISTANT_WORKSPACE_CONTACT_UPDATED,
  ASSISTANT_WORKSPACE_OPEN_CONVERSATION,
  dispatchAssistantRefresh,
  recordCopilotTurn,
  streamCopilotMessage,
  type CopilotLlmHistoryMessage,
  type ContactConfirmation,
} from "@/features/assistant/assistant-api";
import {
  isWorkspaceCopilotPath,
  workspaceConversationIdFromPath,
} from "@/features/assistant/copilot-workspace-stay";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { newId } from "@/lib/new-id";
import { store } from "@/store";
import {
  appendCopilotChatMessage,
  applyCopilotChatMessages,
  selectCopilotChatSession,
  setCopilotRunnerState,
  updateCopilotChatMessage,
} from "@/store/slices/copilot-chat-session-slice";
import {
  helpText,
  type ChatMessage,
  type ToolMessage,
} from "@/features/assistant/copilot-engine";
import type { CopilotPageSnapshot } from "@/features/assistant/copilot-page-context";
import {
  parseQueueStaffingForm,
  queueDraftToGuidedDraft,
  queueGuidedDraftToQueueDraft,
} from "@/features/assistant/queue-guided-draft";
import {
  createStatusPresenter,
  introStatusLabel,
  queueDraftStatusLabel,
  resolveCopilotStatusLabel,
  routingStatusLabelForPath,
} from "@/features/assistant/copilot-status-labels";
import { useQueueDraft } from "@/features/workforce/queues/queue-draft-context";

function summarizeToolResultForHistory(message: ToolMessage): string | null {
  if (message.status !== "success" || !message.result || typeof message.result !== "object") {
    return null;
  }
  const result = message.result as Record<string, unknown>;
  if (
    message.tool === "generate_performance_report" ||
    message.tool === "generate_plot" ||
    message.tool === "ask_semantic_layer" ||
    message.tool === "sql_analytics" ||
    message.tool === "get_dashboard_analytics_snapshot" ||
    message.tool === "get_analytics_hourly_volume"
  ) {
    if (result.type === "plot" || result.chartType === "kpi" || result.chartType) {
      const title = String(result.title ?? "chart");
      const kpis = Array.isArray(result.kpis) ? result.kpis : [];
      const parts = kpis
        .slice(0, 8)
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as { label?: unknown; value?: unknown };
          if (row.label == null || row.value == null) return null;
          return `${String(row.label)}: ${String(row.value)}`;
        })
        .filter((part): part is string => Boolean(part));
      return parts.length
        ? `<p>Already shown card "${title}" (${parts.join(", ")}). Do not refetch unless asked.</p>`
        : `<p>Already shown card "${title}". Do not refetch unless asked.</p>`;
    }
    if (result.type === "performance_report") {
      const title = String(result.title ?? "Performance Report");
      return `<p>Already shown full report card "${title}". Do not refetch unless asked.</p>`;
    }
  }
  return null;
}

function buildCopilotLlmHistory(messages: ChatMessage[]): CopilotLlmHistoryMessage[] {
  const history: CopilotLlmHistoryMessage[] = [];
  for (const message of messages) {
    if (message.kind === "text") {
      history.push({ role: message.role, content: message.content });
      continue;
    }
    const summary = summarizeToolResultForHistory(message);
    if (summary) {
      history.push({ role: "assistant", content: summary });
    }
  }
  return history.slice(-20);
}

function toolResultPersisted(result: Record<string, unknown> | undefined): boolean {
  return Boolean(result && !result._confirmation_required);
}

function contactIdFromToolResult(tool: string, result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const data = result as {
    ambiguous?: unknown;
    search?: unknown;
    contact?: { id?: unknown };
    contacts?: Array<{ id?: unknown }>;
  };
  if (tool === "get_contact") {
    if (data.ambiguous) return null;
    const id = data.contact?.id;
    return typeof id === "string" && id.trim() ? id : null;
  }
  if (tool === "list_contacts") {
    if (!String(data.search ?? "").trim()) return null;
    if (!Array.isArray(data.contacts) || data.contacts.length !== 1) return null;
    const id = data.contacts[0]?.id;
    return typeof id === "string" && id.trim() ? id : null;
  }
  return null;
}

function contactsPathForSnapshot(snapshot: CopilotPageSnapshot): string | null {
  if (snapshot.surface !== "contacts-list" && snapshot.surface !== "contacts-detail") {
    return null;
  }
  const path = snapshot.path.split("?")[0];
  return path || null;
}

function workspaceCopilotActive(snapshot: CopilotPageSnapshot): boolean {
  return snapshot.surface === "inbox" || isWorkspaceCopilotPath(snapshot.path);
}

function friendlyStatusLabel(
  label: string,
  surface?: CopilotPageSnapshot["surface"],
  phase?: string,
) {
  return resolveCopilotStatusLabel({ label, surface, phase });
}

export function useCopilotRunner(
  snapshot: CopilotPageSnapshot,
  role: "admin" | "agent",
  options?: { persistToRedux?: boolean },
) {
  const persistToRedux = options?.persistToRedux ?? false;
  const dispatch = useAppDispatch();
  const reduxSession = useAppSelector(selectCopilotChatSession);
  const navigate = useNavigate();
  const { applyDraftEvent, clearDraft } = useQueueDraft();
  const skipQueueDraftAfterCreateRef = useRef(false);
  const skipContactDraftAfterSaveRef = useRef(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [localStreaming, setLocalStreaming] = useState(false);
  const [localStatusLabel, setLocalStatusLabel] = useState("Ready when you are");

  const loading = persistToRedux ? reduxSession.loading : localLoading;
  const streaming = persistToRedux ? reduxSession.streaming : localStreaming;
  const statusLabel = persistToRedux ? reduxSession.statusLabel : localStatusLabel;

  const setLoading = useCallback(
    (value: boolean) => {
      if (persistToRedux) {
        dispatch(setCopilotRunnerState({ loading: value }));
        return;
      }
      setLocalLoading(value);
    },
    [dispatch, persistToRedux],
  );

  const setStreaming = useCallback(
    (value: boolean) => {
      if (persistToRedux) {
        dispatch(setCopilotRunnerState({ streaming: value }));
        return;
      }
      setLocalStreaming(value);
    },
    [dispatch, persistToRedux],
  );

  const setStatusLabel = useCallback(
    (value: string) => {
      if (persistToRedux) {
        dispatch(setCopilotRunnerState({ statusLabel: value }));
        return;
      }
      setLocalStatusLabel(value);
    },
    [dispatch, persistToRedux],
  );

  const submit = useCallback(
    async (
      text: string,
      currentMessages: ChatMessage[],
      setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
      submitOptions?: { confirmedActions?: string[]; suppressUserMessage?: boolean },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMessage: ChatMessage = {
          id: newId(),
          kind: "text",
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
      };

      if (!submitOptions?.suppressUserMessage) {
        if (persistToRedux) {
          dispatch(appendCopilotChatMessage(userMessage));
        } else {
          setMessages((prev) => [...prev, userMessage]);
        }
      }

      setLoading(true);
      setStreaming(false);
      const statusPresenter = createStatusPresenter(setStatusLabel);
      statusPresenter.enqueue(introStatusLabel(snapshot.surface));
      const stayOnWorkspace = workspaceCopilotActive(snapshot);

      const publishWorkspaceContact = (contactId: string | null | undefined) => {
        if (!stayOnWorkspace || !contactId) return;
        window.dispatchEvent(
          new CustomEvent(ASSISTANT_WORKSPACE_CONTACT_UPDATED, { detail: { contactId } }),
        );
      };

      const followCopilotPath = (path: string, options?: { announce?: boolean }) => {
        if (!stayOnWorkspace) {
          if (options?.announce) {
            statusPresenter.enqueue(routingStatusLabelForPath(path));
          }
          navigate(path);
          return;
        }
        const conversationId = workspaceConversationIdFromPath(path);
        if (!conversationId) return;
        if (options?.announce) {
          statusPresenter.enqueue("Opening that conversation…");
        }
        window.dispatchEvent(
          new CustomEvent(ASSISTANT_WORKSPACE_OPEN_CONVERSATION, {
            detail: { conversationId },
          }),
        );
      };

      const pushMessage = (message: ChatMessage) => {
        if (persistToRedux) {
          dispatch(appendCopilotChatMessage(message));
          return;
        }
        setMessages((prev) => [...prev, message]);
      };

      const updateMessage = (id: string, patch: Partial<ChatMessage>) => {
        if (persistToRedux) {
          dispatch(updateCopilotChatMessage({ id, patch }));
          return;
        }
        setMessages((prev) =>
          prev.map((message) => (message.id === id ? ({ ...message, ...patch } as ChatMessage) : message)),
        );
      };

      const mapMessages = (mapper: (messages: ChatMessage[]) => ChatMessage[]) => {
        if (persistToRedux) {
          const current = store.getState().copilotChatSession.messages;
          dispatch(applyCopilotChatMessages(mapper(Array.isArray(current) ? current : [])));
          return;
        }
        setMessages((prev) => mapper(prev));
      };

      const readMessages = () => {
        if (!persistToRedux) return currentMessages;
        const current = store.getState().copilotChatSession.messages;
        return Array.isArray(current) ? current : [];
      };

      try {
        let streamingMessageId: string | null = null;
        let streamError: string | null = null;
        let streamedResponse = "";
        let completedTurnId: string | null = null;
        let contactSavedDuringTurn = false;
        let lastToolMessage: ToolMessage | null = null;
        let pendingStaffingForm: ReturnType<typeof parseQueueStaffingForm> = null;
        const streamStartedAt = performance.now();
        const history = buildCopilotLlmHistory(readMessages());

        try {
          await streamCopilotMessage(trimmed, role, {
            context: {
              path: snapshot.path,
              surface: snapshot.surface,
              recordLabel: snapshot.recordLabel,
              queueId: snapshot.queueId,
              contactId: snapshot.contactId,
              contactName: snapshot.contactName,
              contactEmail: snapshot.contactEmail,
              contactPhone: snapshot.contactPhone,
              taskId: snapshot.taskId,
              conversationId: snapshot.conversationId,
              range: snapshot.range,
              start: snapshot.start,
              end: snapshot.end,
              incidentId: snapshot.incidentId,
              contactDraft: skipContactDraftAfterSaveRef.current
                ? null
                : snapshot.contactDraft ?? null,
              queueDraft: skipQueueDraftAfterCreateRef.current
                ? null
                : queueDraftToGuidedDraft(store.getState().queueCreateSession.draft),
            },
            history,
            onEvent: (event) => {
              if (event.event === "status") {
                // Show "Generating response…" until the first text/card arrives.
                if (event.data.phase === "writing") {
                  statusPresenter.replaceNow("Generating response…");
                  return;
                }
                statusPresenter.enqueue(
                  friendlyStatusLabel(event.data.label, snapshot.surface, event.data.phase),
                );
                return;
              }

              if (event.event === "tool_call") {
                // Progress for tools is already streamed via `status` events.
                return;
              }

              if (event.event === "text_delta") {
                setStreaming(true);
                // Don't keep a progress chip under the streaming reply.
                statusPresenter.stop();
                streamedResponse += event.data.delta;
                if (!streamingMessageId) {
                  streamingMessageId = newId();
            pushMessage({
                    id: streamingMessageId,
              kind: "text",
              role: "assistant",
                    content: event.data.delta,
                    queueStaffingForm: pendingStaffingForm ?? undefined,
              createdAt: new Date().toISOString(),
            });
                  pendingStaffingForm = null;
                } else {
                  const messageId = streamingMessageId;
                  mapMessages((messages) =>
                    messages.map((message) =>
                      message.id === messageId && message.kind === "text"
                        ? { ...message, content: message.content + event.data.delta }
                        : message,
                    ),
                  );
                }
                return;
              }

              if (event.event === "contact_draft") {
                skipContactDraftAfterSaveRef.current = false;
                statusPresenter.enqueue("Updating the contact preview…");
                if (contactSavedDuringTurn) return;
                window.dispatchEvent(
                  new CustomEvent(ASSISTANT_CONTACT_DRAFT, { detail: event.data }),
                );
                return;
              }

              if (event.event === "queue_draft") {
                skipQueueDraftAfterCreateRef.current = false;
                statusPresenter.enqueue(queueDraftStatusLabel(event.data.nextField));
                const currentDraft = store.getState().queueCreateSession.draft;
                applyDraftEvent(queueGuidedDraftToQueueDraft(event.data, currentDraft));
                window.dispatchEvent(
                  new CustomEvent(ASSISTANT_QUEUE_DRAFT, { detail: event.data }),
                );
                window.dispatchEvent(new CustomEvent(ASSISTANT_CANCEL_CONTACT_PREVIEW));
                window.dispatchEvent(
                  new CustomEvent(ASSISTANT_CONTACT_DRAFT, { detail: null }),
                );
                const staffingForm = parseQueueStaffingForm(event.data);
                const extras = {
                  ...(staffingForm ? { queueStaffingForm: staffingForm } : {}),
                };
                if (streamingMessageId && Object.keys(extras).length > 0) {
                  updateMessage(streamingMessageId, extras);
                } else if (staffingForm) {
                  pendingStaffingForm = staffingForm;
                }
                if (snapshot.surface !== "queue-create" && !stayOnWorkspace) {
                  navigate("/admin/workforce/queues?create=1");
                }
                return;
              }

              if (event.event === "block") {
                if (event.data.kind === "tool") {
                  const toolMsg = event.data as ToolMessage;
                  mapMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === toolMsg.id);
                    if (idx >= 0) {
                      const copy = [...prev];
                      copy[idx] = { ...copy[idx], ...toolMsg } as ChatMessage;
                      return copy;
                    }
                    return [...prev, toolMsg as ChatMessage];
                  });
                  if (toolMsg.status === "success" || toolMsg.status === "error") {
                    lastToolMessage = toolMsg;
                  }

                  // KPI/chart cards are the answer surface — don't keep cycling
                  // progress labels underneath them (or flash Generating response twice).
                  if (
                    event.data.status === "success" &&
                    [
                      "ask_ontology_layer",
                      "generate_performance_report",
                      "generate_plot",
                      "ask_semantic_layer",
                      "sql_analytics",
                      "get_dashboard_analytics_snapshot",
                      "get_analytics_hourly_volume",
                    ].includes(event.data.tool)
                  ) {
                    const result = event.data.result as Record<string, unknown> | undefined;
                    const looksLikeCard =
                      result?.type === "plot" ||
                      result?.type === "performance_report" ||
                      result?.type === "explanation" ||
                      result?.chartType === "kpi" ||
                      Boolean(result?.chartType);
                    if (looksLikeCard) {
                      statusPresenter.stop();
                    }
                  }

                  if (event.data.status === "success" && event.data.tool === "create_queue") {
                    const result = event.data.result as Record<string, unknown> | undefined;
                    if (toolResultPersisted(result) && result?.id) {
                      skipQueueDraftAfterCreateRef.current = true;
                      dispatchAssistantRefresh("queues");
                      clearDraft();
                      followCopilotPath("/admin/workforce/queues");
                    }
                  }
                  if (
                    event.data.status === "success" &&
                    ["update_queue", "update_queue_status", "delete_queue"].includes(
                      event.data.tool,
                    )
                  ) {
                    const result = event.data.result as Record<string, unknown> | undefined;
                    if (toolResultPersisted(result)) {
                      dispatchAssistantRefresh("queues");
                    }
                  }
                  if (
                    event.data.status === "success" &&
                    [
                      "create_callback_task",
                      "force_agent_logout",
                      "set_agent_presence",
                      "acknowledge_not_ready_escalation",
                      "acknowledge_proactive_callback",
                    ].includes(event.data.tool)
                  ) {
                    const result = event.data.result as Record<string, unknown> | undefined;
                    if (toolResultPersisted(result)) {
                      dispatchAssistantRefresh("monitoring");
                    }
                  }
                  if (
                    event.data.status === "success" &&
                    ["get_contact", "list_contacts"].includes(event.data.tool)
                  ) {
                    const contactId = contactIdFromToolResult(
                      event.data.tool,
                      event.data.result,
                    );
                    const contactsPath = contactsPathForSnapshot(snapshot);
                    if (contactId && contactsPath && snapshot.contactId !== contactId) {
                      followCopilotPath(`${contactsPath}?contact=${contactId}`);
                    }
                    publishWorkspaceContact(contactId);
                  }
                  if (
                    event.data.status === "success" &&
                    ["create_contact", "update_contact"].includes(event.data.tool)
                  ) {
                    contactSavedDuringTurn = true;
                    skipContactDraftAfterSaveRef.current = true;
                    dispatchAssistantRefresh("contacts");
                    const result = event.data.result as
                      | { contact?: { id?: string } }
                      | undefined;
                    window.dispatchEvent(new CustomEvent(ASSISTANT_CANCEL_CONTACT_PREVIEW));
                    if (result?.contact?.id) {
                      if (stayOnWorkspace) {
                        publishWorkspaceContact(result.contact.id);
                      } else {
                        navigate(`${snapshot.path}?contact=${result.contact.id}`);
                      }
                    }
                  }
                  if (event.data.status === "success" && event.data.tool === "update_task") {
                    dispatchAssistantRefresh("tasks");
                  }
                  if (
                    event.data.status === "success" &&
                    event.data.tool === "open_task_workspace"
                  ) {
                    const result = event.data.result as { path?: string } | undefined;
                    if (result?.path) {
                      followCopilotPath(result.path, { announce: true });
                    }
                  }
                  if (event.data.status === "success" && "tool" in event.data) {
                    const toolName = event.data.tool as string;
                    if (toolName === "navigate") {
                      const result = (event.data as { result?: { path?: string } }).result;
                      if (result?.path) {
                        followCopilotPath(result.path, { announce: true });
                      }
                    }
                  }
                }
                return;
              }

              if (event.event === "action") {
                if (event.data.type === "navigate") {
                  followCopilotPath(event.data.path, { announce: true });
                }
                if (event.data.type === "refresh") dispatchAssistantRefresh(event.data.resource);
                return;
              }

              if (event.event === "confirmation_required") {
                if (
                  ["create_contact", "update_contact"].includes(event.data.tool) &&
                  event.data.preview
                ) {
                  const confirmation: ContactConfirmation = {
                    ...event.data,
                    tool: event.data.tool as ContactConfirmation["tool"],
                    preview: event.data.preview,
                  };
                  window.dispatchEvent(
                    new CustomEvent(ASSISTANT_CONTACT_PREVIEW, { detail: confirmation }),
                  );
                  pushMessage({
                    id: newId(),
                    kind: "text",
                    role: "assistant",
                    content: `<p>${event.data.message}</p><p>Review the preview and confirm to continue.</p>`,
                    createdAt: new Date().toISOString(),
                  });
                }
                return;
              }

              if (event.event === "error") streamError = event.data.message;
              if (event.event === "done") {
                completedTurnId = event.data.turnId;
                const chain = event.data.routingChain;
                const terminal =
                  Array.isArray(chain) && chain.length > 0
                    ? chain[chain.length - 1]
                    : event.data.route;
                if (terminal && terminal !== "queue") {
                  const current = store.getState().queueCreateSession.draft;
                  if (current.guided) {
                    clearDraft();
                  }
                }
                if (streamingMessageId) {
                  updateMessage(streamingMessageId, {
                    copilotTurnId: event.data.turnId,
                    ...(pendingStaffingForm ? { queueStaffingForm: pendingStaffingForm } : {}),
                  });
                  pendingStaffingForm = null;
                } else if (pendingStaffingForm) {
                  streamingMessageId = newId();
                  pushMessage({
                    id: streamingMessageId,
                    kind: "text",
                    role: "assistant",
                    content: "<p>Add people on the staffing form, then click Done staffing.</p>",
                    queueStaffingForm: pendingStaffingForm,
                    createdAt: new Date().toISOString(),
                  });
                  pendingStaffingForm = null;
                }
              }
              },
            });
          if (streamError) throw new Error(streamError);
          if (!streamedResponse.trim()) {
            const fallback = buildCopilotSilentFallback(lastToolMessage, { stayOnWorkspace });
            if (fallback) {
              pushMessage({
                id: newId(),
                kind: "text",
                role: "assistant",
                content: fallback,
                createdAt: new Date().toISOString(),
              });
              streamedResponse = fallback;
            }
          }
          if (streamedResponse.trim()) {
            const recorded = await recordCopilotTurn({
              id: completedTurnId ?? undefined,
              conversationId: snapshot.conversationId,
              surface: snapshot.surface,
              agentInput: trimmed,
              copilotResponse: streamedResponse,
              suggestionText:
                snapshot.surface === "inbox" ? streamedResponse : undefined,
              latencyMs: Math.round(performance.now() - streamStartedAt),
            });
            if (streamingMessageId && recorded.id) {
              updateMessage(streamingMessageId, { copilotTurnId: recorded.id });
            }
          }
        } catch (error) {
          const detail =
            error instanceof Error && error.message.trim() ? error.message.trim() : null;
          const billingIssue =
            detail &&
            (detail.includes("credit balance") ||
              detail.includes("credit_limit") ||
              detail.includes("402"));
            pushMessage({
              id: newId(),
              kind: "text",
              role: "assistant",
            content: billingIssue
              ? `The co-worker model provider is temporarily unavailable (billing/credits). ${helpText(role)}`
              : detail
                ? `I couldn't complete that request: ${detail}`
                : `I couldn't reach the language model. ${helpText(role)}`,
              createdAt: new Date().toISOString(),
            });
        }
      } finally {
        statusPresenter.replaceNow("Ready when you are");
        setLoading(false);
        setStreaming(false);
      }
    },
    [
      applyDraftEvent,
      clearDraft,
      dispatch,
      loading,
      navigate,
      persistToRedux,
      role,
      snapshot,
      setLoading,
      setStatusLabel,
      setStreaming,
    ],
  );

  return { loading, streaming, statusLabel, resetGuidedCreate: clearDraft, submit };
}
