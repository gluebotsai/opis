import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle, Search, UserX, X } from "lucide-react";
import { RefreshIcon } from "@/components/ui/refresh-icon";

import type { Queue } from "@/features/workforce/queues/types";
import { workspaceApi } from "@/features/workspace/api";
import type {
  WorkspaceDisposition,
  WorkspaceDispositionOption,
  WorkspaceTransferAgent,
  WorkspaceTransferInput,
  WorkspaceTransferMetadata,
  ConversationSentiment,
} from "@/features/workspace/types";
import { SessionSentimentPanel } from "@/components/workspace/sentiment-chip";
import { cn } from "@/lib/utils";

const EMPTY_DETAILS: WorkspaceDisposition = {
  resolution: "",
  disposition: "",
  conclusion: "",
  summary: "",
};

export const TRANSFERRED_WRAP_UP_SUMMARY = "Conversation transferred to another agent.";

function withTransferredWrapUp(
  details: WorkspaceDisposition,
  suggestion?: { dispositionCode?: string | null; summary?: string | null },
): WorkspaceDisposition {
  return {
    ...details,
    resolution: "transferred",
    disposition: suggestion?.dispositionCode ?? details.disposition,
    summary: suggestion?.summary?.trim() || details.summary.trim() || TRANSFERRED_WRAP_UP_SUMMARY,
  };
}

type DialogSelectOption = {
  value: string;
  label: string;
};

function DialogSelect({
  value,
  options,
  placeholder = "Select…",
  disabled = false,
  onChange,
}: {
  value: string;
  options: DialogSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 220 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      top: openUpward ? undefined : rect.bottom + 6,
      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
      zIndex: 80,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < 220 && rect.top > spaceBelow;
      setMenuStyle({
        position: "fixed",
        left: rect.left,
        width: rect.width,
        top: openUpward ? undefined : rect.bottom + 6,
        bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
        zIndex: 80,
      });
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label ?? placeholder;

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-2 pl-3 pr-3 text-left text-sm text-neutral-900 outline-none transition-colors",
          "hover:border-[#bfbfbf] focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100",
          "disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-600",
          !selected && "text-neutral-600",
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-neutral-600 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open
        ? createPortal(
            <ul
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="max-h-56 overflow-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-lg shadow-neutral-900/10"
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <li key={`${option.value}:${option.label}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-neutral-800 transition-colors",
                        "hover:bg-neutral-50",
                        isSelected && "bg-neutral-50 font-medium text-neutral-900",
                      )}
                    >
                      <Check
                        className={cn(
                          "size-3.5 shrink-0 text-neutral-900",
                          !isSelected && "opacity-0",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

function FieldSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-1.5" aria-hidden="true">
      <div className="h-3 w-28 rounded bg-neutral-200" />
      <div
        className="rounded-lg bg-neutral-100"
        style={{ height: rows === 1 ? 40 : rows * 26 }}
      />
    </div>
  );
}

function WrapUpFieldsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Generating wrap-up suggestions">
      <FieldSkeleton />
      <FieldSkeleton />
      <FieldSkeleton rows={3} />
      <p className="flex items-center gap-2 text-xs text-neutral-600">
        <LoaderCircle className="size-3.5 animate-spin" />
        Summarizing this agent session…
      </p>
    </div>
  );
}

function DialogShell({
  title,
  description,
  busy,
  submitLabel,
  canSubmit,
  onClose,
  onSubmit,
  panelClassName,
  contentClassName,
  footerClassName,
  dismissible = true,
  headerAside,
  children,
}: {
  title: string;
  description: string;
  busy: boolean;
  submitLabel: string;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => void;
  panelClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  dismissible?: boolean;
  headerAside?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy && dismissible) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dismissible, onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-action-title"
        className={cn(
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl",
          panelClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="workspace-action-title" className="text-base font-semibold text-neutral-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-neutral-600">{description}</p>
          </div>
          {headerAside || dismissible ? (
            <div className="flex shrink-0 items-center gap-2">
              {headerAside}
              {dismissible ? (
                <button
                  type="button"
                  aria-label="Close dialog"
                  disabled={busy}
                  onClick={onClose}
                  className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={cn("mt-5 space-y-4", contentClassName)}>{children}</div>
        <div className={cn("mt-6 flex justify-end gap-2", footerClassName)}>
          {dismissible ? (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-9 rounded-lg border-[0.6px] border-[#bfbfbf] px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={onSubmit}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequiredDetailsFields({
  value,
  dispositions,
  optionsLoading,
  suggestionLoading = false,
  resolutionLocked = false,
  summaryRows = 3,
  onChange,
}: {
  value: WorkspaceDisposition;
  dispositions: WorkspaceDispositionOption[];
  optionsLoading: boolean;
  suggestionLoading?: boolean;
  resolutionLocked?: boolean;
  summaryRows?: number;
  onChange: (value: WorkspaceDisposition) => void;
}) {
  if (suggestionLoading) {
    return <WrapUpFieldsSkeleton />;
  }

  return (
    <>
      <label className="block text-xs font-medium text-neutral-700">
        Resolution status <span className="text-red-500">*</span>
        <DialogSelect
          value={value.resolution}
          disabled={resolutionLocked}
          placeholder="Select a resolution"
          options={[
            { value: "resolved", label: "Resolved" },
            { value: "unresolved", label: "Unresolved" },
            { value: "transferred", label: "Transferred" },
          ]}
          onChange={(resolution) => onChange({ ...value, resolution })}
        />
      </label>
      <label className="block text-xs font-medium text-neutral-700">
        Disposition <span className="text-red-500">*</span>
        <DialogSelect
          value={value.disposition}
          disabled={optionsLoading}
          placeholder={optionsLoading ? "Loading dispositions…" : "Select a disposition"}
          options={dispositions.map((disposition) => ({
            value: disposition.code,
            label: disposition.label,
          }))}
          onChange={(disposition) => onChange({ ...value, disposition })}
        />
        {!optionsLoading && dispositions.length === 0 ? (
          <span className="mt-1 block text-xs text-amber-700">
            No active dispositions are configured for this organization.
          </span>
        ) : null}
      </label>
      <label className="block text-xs font-medium text-neutral-700">
        Conversation Summary <span className="text-red-500">*</span>
        <textarea
          value={value.summary}
          onChange={(event) => onChange({ ...value, summary: event.target.value })}
          rows={summaryRows}
          required
          className="mt-1.5 min-h-[7.5rem] w-full resize-y rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
        />
      </label>
    </>
  );
}

function detailsComplete(details: WorkspaceDisposition) {
  return (
    details.resolution.trim().length > 0 &&
    details.disposition.trim().length > 0 &&
    details.summary.trim().length > 0
  );
}

const DISPOSITION_AUTOSAVE_MS = 60_000;

function useDispositionAutosave(
  enabled: boolean,
  details: WorkspaceDisposition,
  onSubmit: (details: WorkspaceDisposition) => void,
  resetKey: string,
) {
  const editedRef = useRef(false);
  const [edited, setEdited] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const detailsRef = useRef(details);
  onSubmitRef.current = onSubmit;
  detailsRef.current = details;

  useEffect(() => {
    editedRef.current = false;
    setEdited(false);
    setSecondsLeft(null);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || edited || !detailsComplete(details)) {
      setSecondsLeft(null);
      return;
    }
    let remaining = DISPOSITION_AUTOSAVE_MS / 1000;
    setSecondsLeft(remaining);
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        setSecondsLeft(null);
        if (editedRef.current) return;
        const next = detailsRef.current;
        if (!detailsComplete(next)) return;
        editedRef.current = true;
        setEdited(true);
        onSubmitRef.current(next);
        return;
      }
      setSecondsLeft(remaining);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, edited, details.resolution, details.disposition, details.summary, resetKey]);

  return {
    secondsLeft,
    markEdited: () => {
      if (editedRef.current) return;
      editedRef.current = true;
      setEdited(true);
      setSecondsLeft(null);
    },
  };
}

export function WorkspaceDispositionDialog({
  conversationId,
  dispositions,
  optionsLoading,
  busy,
  dismissible = true,
  resolutionLocked = false,
  nonFinal = false,
  defaultResolution,
  onClose,
  onSubmit,
}: {
  conversationId: string;
  dispositions: WorkspaceDispositionOption[];
  optionsLoading: boolean;
  busy: boolean;
  dismissible?: boolean;
  resolutionLocked?: boolean;
  nonFinal?: boolean;
  defaultResolution?: WorkspaceDisposition["resolution"];
  onClose: () => void;
  onSubmit: (details: WorkspaceDisposition) => void;
}) {
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const [sessionSentiment, setSessionSentiment] = useState<ConversationSentiment | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setSuggestionLoading(true);
    setDetails(EMPTY_DETAILS);
    setSessionSentiment(null);

    void Promise.all([
      workspaceApi.suggestWrapUp(conversationId),
      workspaceApi.fetchSessionSentiment(conversationId),
    ])
      .then(([suggestion, sentiment]) => {
        if (cancelled) return;
        const next: WorkspaceDisposition = {
          resolution: defaultResolution ?? suggestion.resolution,
          disposition: suggestion.dispositionCode ?? "",
          conclusion: "",
          summary: suggestion.summary,
        };
        setDetails(
          defaultResolution === "transferred" ? withTransferredWrapUp(next, suggestion) : next,
        );
        setSessionSentiment(sentiment);
      })
      .catch(() => {
        if (cancelled) return;
        setDetails(
          defaultResolution === "transferred"
            ? withTransferredWrapUp({ ...EMPTY_DETAILS, resolution: "transferred" })
            : defaultResolution
              ? { ...EMPTY_DETAILS, resolution: defaultResolution }
              : EMPTY_DETAILS,
        );
        setSessionSentiment(null);
      })
      .finally(() => {
        if (!cancelled) setSuggestionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, defaultResolution]);

  useEffect(() => {
    if (defaultResolution !== "transferred" || suggestionLoading || optionsLoading) return;
    if (details.disposition) return;
    const transferredOption =
      dispositions.find((item) => /transfer/i.test(`${item.code} ${item.label}`)) ??
      dispositions[0];
    if (!transferredOption) return;
    setDetails((current) =>
      withTransferredWrapUp({ ...current, disposition: transferredOption.code }),
    );
  }, [defaultResolution, details.disposition, dispositions, optionsLoading, suggestionLoading]);

  const formReady = !optionsLoading && !suggestionLoading && dispositions.length > 0;
  const submitDetails = defaultResolution
    ? withTransferredWrapUp({ ...details, resolution: defaultResolution })
    : details;
  const dispositionAutosave = useDispositionAutosave(
    formReady && !busy,
    submitDetails,
    onSubmit,
    conversationId,
  );

  return (
    <DialogShell
      title={defaultResolution === "transferred" || nonFinal ? "Disposition" : "End conversation"}
      description={
        defaultResolution === "transferred"
          ? "Record your disposition as transferred. The receiving agent owns the final close."
          : nonFinal
            ? "Save your disposition for this conference. The primary agent owns the final close."
          : "Complete the required wrap-up details before closing this conversation."
      }
      busy={busy}
      submitLabel={
        defaultResolution === "transferred" || nonFinal ? "Save disposition" : "End conversation"
      }
      canSubmit={formReady && detailsComplete(submitDetails)}
      dismissible={dismissible}
      headerAside={
        dispositionAutosave.secondsLeft != null ? (
          <span className="text-sm font-semibold tabular-nums text-neutral-900" aria-live="polite">
            {dispositionAutosave.secondsLeft}s
          </span>
        ) : null
      }
      onClose={onClose}
      onSubmit={() => onSubmit(submitDetails)}
      panelClassName="max-w-xl p-6"
      contentClassName="mt-4 space-y-3.5"
      footerClassName="mt-5"
    >
      {sessionSentiment ? (
        <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 p-3">
          <p className="text-xs font-medium text-neutral-700">Session sentiment</p>
          <SessionSentimentPanel sentiment={sessionSentiment} className="mt-2" />
        </div>
      ) : null}
      <RequiredDetailsFields
        value={details}
        dispositions={dispositions}
        optionsLoading={optionsLoading}
        suggestionLoading={suggestionLoading}
        resolutionLocked={resolutionLocked}
        summaryRows={5}
        onChange={(next) => {
          dispositionAutosave.markEdited();
          setDetails(defaultResolution ? { ...next, resolution: defaultResolution } : next);
        }}
      />
    </DialogShell>
  );
}

export function NoAvailableAgentsDialog({
  isOpen,
  queueName,
  onClose,
  onProceed,
}: {
  isOpen: boolean;
  queueName?: string;
  onClose: () => void;
  onProceed?: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-2xs"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-agents-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <UserX className="size-5" />
          </div>
          <div className="flex-1">
            <h3 id="no-agents-title" className="text-base font-semibold text-neutral-900">
              No available agents in queue
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              {queueName
                ? `There are currently no available agents in "${queueName}". All assigned agents are offline or busy based on presence status.`
                : "There are currently no available agents in queue. All agents are offline or busy based on presence status."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          {onProceed ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onProceed();
                  onClose();
                }}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 active:bg-neutral-950"
              >
                Proceed
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 active:bg-neutral-950"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceTransferDialog({
  queues,
  agents,
  optionsLoading,
  targetsLoading,
  targetError,
  nextCursor,
  busy,
  mode = "transfer",
  onClose,
  onSubmit,
  onLoadTargets,
}: {
  queues: Queue[];
  agents: WorkspaceTransferAgent[];
  optionsLoading: boolean;
  targetsLoading: boolean;
  targetError?: string | null;
  nextCursor?: string;
  busy: boolean;
  mode?: "transfer" | "voice-invite";
  onClose: () => void;
  onSubmit: (input: WorkspaceTransferInput) => void;
  onLoadTargets: (queueId: string, search: string, cursor?: string) => void;
}) {
  const [queueId, setQueueId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  /** Only show the empty-agents banner after a load finishes for this queue+search. */
  const [loadedTargetsKey, setLoadedTargetsKey] = useState<string | null>(null);
  const [awaitingTargets, setAwaitingTargets] = useState(false);
  const onLoadTargetsRef = useRef(onLoadTargets);
  const sawTargetsLoadingRef = useRef(false);
  onLoadTargetsRef.current = onLoadTargets;
  const targetsRequestKey = queueId ? `${queueId}\0${search}` : null;

  useEffect(() => {
    if (targetsLoading) sawTargetsLoadingRef.current = true;
  }, [targetsLoading]);

  useEffect(() => {
    if (!queueId) {
      setAwaitingTargets(false);
      setLoadedTargetsKey(null);
      sawTargetsLoadingRef.current = false;
      return;
    }
    // Show loading immediately so "No eligible agents" cannot flash during debounce.
    setAwaitingTargets(true);
    sawTargetsLoadingRef.current = false;
    // Keep the loader callback out of deps so parent re-renders cannot
    // restart the request loop while targetsLoading flips true/false.
    const delayMs = search.trim() ? 300 : 0;
    const timer = window.setTimeout(
      () => onLoadTargetsRef.current(queueId, search),
      delayMs,
    );
    return () => window.clearTimeout(timer);
  }, [queueId, search]);

  useEffect(() => {
    if (!targetsRequestKey || !awaitingTargets) return;
    // Wait until the parent request actually started and finished — otherwise
    // the pre-request awaiting window marks the query "loaded" and flashes empty.
    if (targetsLoading || !sawTargetsLoadingRef.current) return;
    setAwaitingTargets(false);
    setLoadedTargetsKey(targetsRequestKey);
  }, [targetsLoading, targetsRequestKey, awaitingTargets, agents, targetError]);

  useEffect(() => {
    if (agentId && !agents.some((agent) => agent.agentId === agentId)) {
      setAgentId("");
    }
  }, [agentId, agents]);

  const selectedQueue = useMemo(() => {
    return queues.find((q) => q.id === queueId);
  }, [queues, queueId]);
  const targetsPending = targetsLoading || awaitingTargets;
  const showEmptyTargets =
    Boolean(queueId) &&
    !targetsPending &&
    !targetError &&
    agents.length === 0 &&
    loadedTargetsKey === targetsRequestKey;

  return (
    <DialogShell
      title={mode === "voice-invite" ? "Invite agent" : "Transfer conversation"}
      description={
        mode === "voice-invite"
          ? "The customer stays on hold. Choose a Ready agent and click Invite."
          : "Choose a destination. You’ll complete wrap-up after the receiving agent accepts."
      }
      busy={busy}
      submitLabel={mode === "voice-invite" ? "Invite" : "Transfer"}
      canSubmit={Boolean(queueId && agentId) && !targetsPending}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          queueId,
          agentId,
          notes: notes.trim() || undefined,
        })
      }
    >
      <label className="block text-xs font-medium text-neutral-700">
        Queue <span className="text-red-500">*</span>
        <DialogSelect
          value={queueId}
          disabled={optionsLoading}
          placeholder={optionsLoading ? "Loading queues…" : "Select a queue"}
          options={queues
            .filter((queue) => queue.status === "active")
            .map((queue) => ({ value: queue.id, label: queue.name }))}
          onChange={(nextQueueId) => {
            setQueueId(nextQueueId);
            setAgentId("");
            setSearch("");
            setLoadedTargetsKey(null);
            setAwaitingTargets(Boolean(nextQueueId));
          }}
        />
      </label>

      {queueId ? (
        <label className="block text-xs font-medium text-neutral-700">
          Search agents
          <span className="relative mt-1.5 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setAgentId("");
                setLoadedTargetsKey(null);
                setAwaitingTargets(true);
              }}
              placeholder="Name, email, or employee ID"
              className="h-10 w-full rounded-lg border-[0.6px] border-[#bfbfbf] pl-9 pr-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            />
          </span>
        </label>
      ) : null}

      {showEmptyTargets ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          <UserX className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">No eligible agents</p>
            <p className="mt-0.5 text-amber-700">
              {mode === "voice-invite"
                ? `Nobody in ${selectedQueue ? `"${selectedQueue.name}"` : "this queue"} is Ready with a SIP extension right now. Ask another agent to go Ready, then refresh.`
                : `Nobody in ${selectedQueue ? `"${selectedQueue.name}"` : "this queue"} is Ready/Available with free capacity for this channel right now. Ask another agent to go Ready, then refresh.`}
            </p>
          </div>
        </div>
      ) : null}

      {targetsPending ? (
        <div className="flex items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] px-3.5 py-4 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading eligible agents…
        </div>
      ) : null}

      {targetError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
          <span>{targetError}</span>
          <button
            type="button"
            onClick={() => {
              setAwaitingTargets(true);
              setLoadedTargetsKey(null);
              onLoadTargets(queueId, search);
            }}
            className="inline-flex shrink-0 items-center gap-1 font-semibold"
          >
            <RefreshIcon className="size-3.5" /> Refresh
          </button>
        </div>
      ) : null}

      {!targetsPending && agents.length > 0 ? (
        <fieldset>
          <legend className="text-xs font-medium text-neutral-700">
            Agent <span className="text-red-500">*</span>
          </legend>
          <div className="mt-1.5 max-h-56 space-y-2 overflow-y-auto rounded-xl border-[0.6px] border-[#bfbfbf] p-2">
            {agents.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                role="radio"
                aria-checked={agentId === agent.agentId}
                onClick={() => setAgentId(agent.agentId)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left",
                  agentId === agent.agentId
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-transparent hover:bg-neutral-50",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-900">
                    {agent.name}
                  </span>
                  <span className="block truncate text-xs text-neutral-600">
                    {[agent.ext ? `Ext ${agent.ext}` : null, agent.employeeId, agent.email]
                      .filter(Boolean)
                      .join(" · ") || agent.presence}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-neutral-600">
                  <span className="block font-semibold text-neutral-800">
                    {agent.availableCapacity} available
                  </span>
                  <span>
                    {agent.activeCount}+{agent.reservedCount}/{agent.maxConcurrency}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {nextCursor ? (
            <button
              type="button"
              disabled={targetsLoading}
              onClick={() => onLoadTargets(queueId, search, nextCursor)}
              className="mt-2 text-xs font-semibold text-neutral-700 hover:text-neutral-950"
            >
              Load more agents
            </button>
          ) : null}
        </fieldset>
      ) : null}
      {mode === "voice-invite" ? null : (
      <label className="block text-xs font-medium text-neutral-700">
        Transfer notes <span className="font-normal text-neutral-400">(optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="mt-1.5 w-full resize-y rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
      </label>
      )}
    </DialogShell>
  );
}

export function WorkspaceTransferDispositionDialog({
  conversationId,
  transfer,
  dispositions,
  optionsLoading,
  busy,
  onClose,
  onSubmit,
}: {
  conversationId: string;
  transfer?: WorkspaceTransferMetadata | null;
  dispositions: WorkspaceDispositionOption[];
  optionsLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (details: WorkspaceDisposition) => void;
}) {
  const [details, setDetails] = useState<WorkspaceDisposition>({
    ...EMPTY_DETAILS,
    resolution: "transferred",
  });
  const [suggestionLoading, setSuggestionLoading] = useState(true);

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setSuggestionLoading(true);
    setDetails({ ...EMPTY_DETAILS, resolution: "transferred" });

    void workspaceApi
      .suggestWrapUp(conversationId)
      .then((suggestion) => {
        if (cancelled) return;
        setDetails({
          resolution: "transferred",
          disposition: suggestion.dispositionCode ?? "",
          conclusion: "",
          summary: suggestion.summary || TRANSFERRED_WRAP_UP_SUMMARY,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDetails({
          ...EMPTY_DETAILS,
          resolution: "transferred",
          summary: TRANSFERRED_WRAP_UP_SUMMARY,
        });
      })
      .finally(() => {
        if (!cancelled) setSuggestionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (suggestionLoading || optionsLoading || details.disposition) return;
    const transferredOption =
      dispositions.find((item) => /transfer/i.test(`${item.code} ${item.label}`)) ??
      dispositions[0];
    if (!transferredOption) return;
    setDetails((current) =>
      current.disposition
        ? current
        : { ...current, disposition: transferredOption.code, resolution: "transferred" },
    );
  }, [details.disposition, dispositions, optionsLoading, suggestionLoading]);

  const formReady = !optionsLoading && !suggestionLoading && dispositions.length > 0;
  const acceptedAfterSeconds =
    transfer?.requestedAt && transfer.acceptedAt
      ? Math.max(
          0,
          Math.round(
            (Date.parse(transfer.acceptedAt) - Date.parse(transfer.requestedAt)) / 1000,
          ),
        )
      : null;
  const targetName =
    transfer?.acceptedAgentName ??
    transfer?.offeredAgentName ??
    transfer?.requestedAgentName ??
    transfer?.targetAgentName ??
    (transfer?.acceptedAgentId || transfer?.offeredAgentId
      ? `Agent ${transfer.acceptedAgentId ?? transfer.offeredAgentId}`
      : "receiving agent");
  const queueName =
    transfer?.targetQueueName ??
    transfer?.toQueueName ??
    (transfer?.toQueueId ? `Queue ${transfer.toQueueId}` : null);

  return (
    <DialogShell
      title="Complete transfer"
      description="The receiving agent accepted. Complete the required sender wrap-up."
      busy={busy}
      submitLabel="Complete transfer"
      canSubmit={formReady && detailsComplete({ ...details, resolution: "transferred" })}
      onClose={onClose}
      onSubmit={() => onSubmit({ ...details, resolution: "transferred" })}
      dismissible={false}
    >
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-950">
        <p className="font-semibold">Accepted by {targetName}</p>
        <p className="mt-1 text-xs text-emerald-800">
          {[queueName, acceptedAfterSeconds !== null ? `Answered in ${acceptedAfterSeconds}s` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {transfer?.notes ? (
          <p className="mt-2 border-t border-emerald-200 pt-2 text-xs">{transfer.notes}</p>
        ) : null}
      </div>
      <div className="border-t-[0.6px] border-[#bfbfbf] pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Handoff outcome
        </p>
        <div className="space-y-4">
          <RequiredDetailsFields
            value={details}
            dispositions={dispositions}
            optionsLoading={optionsLoading}
            suggestionLoading={suggestionLoading}
            resolutionLocked
            onChange={(next) => setDetails({ ...next, resolution: "transferred" })}
          />
        </div>
      </div>
    </DialogShell>
  );
}
