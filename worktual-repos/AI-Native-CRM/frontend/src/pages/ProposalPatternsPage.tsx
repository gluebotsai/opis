import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, X } from "lucide-react";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  createProposalCorpusBatch,
  deleteProposalCorpusBatch,
  fetchProposalCorpusBatches,
  fetchProposalPlaybooks,
  processProposalCorpusBatch,
  resetProposalPatterns,
  scoreProposalCorpusPair,
  type ProposalContentPlaybookSummary,
  type ProposalCorpusBatchSummary,
  type ProposalPlaybookView,
} from "@/services/configuration";
import {
  CHIP_BASE,
  PAGE_H1_CLASS,
  TONE_DANGER,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";
import { WORKTUAL_HAIRLINE } from "@/lib/worktual-control-tokens";
import { batchFileLine, batchTitle } from "@/lib/proposal-pattern-batch";

const PROCESSING_BATCH_STATUSES = new Set(["uploading", "processing"]);
const PROCESSING_JOB_STATUSES = new Set([
  "pending",
  "ingesting",
  "structuring",
  "pairing",
  "synthesizing",
]);

const REQ_ACCEPT = ".pdf,.docx,.txt,.md";
const PROP_ACCEPT = ".pdf,.docx";
const CARD =
  `rounded-2xl bg-white p-5 shadow-none ${WORKTUAL_HAIRLINE}`;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fileMatchesAccept(file: File, accept: string) {
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((ext) => name.endsWith(ext.startsWith(".") ? ext : `.${ext}`));
}

function isBatchFailed(batch: ProposalCorpusBatchSummary) {
  return batch.status === "failed" || batch.jobStatus === "failed";
}

function isBatchPending(batch: ProposalCorpusBatchSummary) {
  if (isBatchFailed(batch)) return false;
  if (batch.status === "completed" || batch.status === "pending_review") {
    return false;
  }
  if (PROCESSING_BATCH_STATUSES.has(batch.status)) return true;
  if (batch.jobStatus && PROCESSING_JOB_STATUSES.has(batch.jobStatus)) {
    return true;
  }
  return false;
}

type QueueBadge = "pending" | "completed" | "failed";

function batchQueueBadge(batch: ProposalCorpusBatchSummary): QueueBadge {
  if (isBatchFailed(batch)) return "failed";
  if (isBatchPending(batch)) return "pending";
  return "completed";
}

function batchStageHint(batch: ProposalCorpusBatchSummary) {
  if (!isBatchPending(batch)) return null;
  const stage = batch.jobStatus?.replace(/_/g, " ");
  if (stage && stage !== "pending") return stage;
  return "learning";
}

function batchGuidance(batch: ProposalCorpusBatchSummary) {
  if (!isBatchFailed(batch)) return null;
  if (batch.lastError?.includes("byte-identical")) {
    return "The requirement and proposal are the same file. Delete this upload, then choose the actual requirement and its matching proposal.";
  }
  if (batch.lastError?.includes("content patterns")) {
    return "The files were read and paired, but the agent could not extract enough reusable section writing patterns from them. Try PDFs with clearer section headings and more body text, or use a winning proposal with richer narrative sections.";
  }
  if (batch.lastError?.includes("pairing was not produced")) {
    return "Could not confidently match the requirement to the proposal. Upload the BRD/RFP beside its corresponding winning proposal from the same deal.";
  }
  if (batch.lastError?.includes("minimum confidence")) {
    return "No requirement/proposal pair reached the confidence threshold. Check that each requirement file matches its winning proposal.";
  }
  if (
    /timed out|timeout|handshake|_ssl\.c|ConnectTimeout|ETIMEDOUT|DEADLINE_EXCEEDED|\b504\b/i.test(
      batch.lastError || "",
    )
  ) {
    return "Gemini ran out of time extracting this pair. Retry — ingested text is reused, and extract retries with lighter model thinking.";
  }
  if (batch.lastError?.includes("INVALID_ARGUMENT")) {
    return "Gemini could not read this upload as a PDF. Retry now — Word/text files are extracted as text. Use a PDF for the winning proposal if you need fonts and layout.";
  }
  if (batch.lastError?.includes("llm_error")) {
    return "Gemini failed while extracting this pair. Retry — files already structured are skipped, and remaining documents use ingested text if the PDF path fails.";
  }
  if (batch.lastError?.includes("Design geometry") || batch.lastError?.includes("visual template")) {
    return "This upload failed on the old visual-template step. Retry — learning now extracts the PDFs and freezes the gold theme (no CSS reconstruction).";
  }
  if (batch.lastError?.trim()) {
    return batch.lastError;
  }
  return "Learning could not complete. Delete this upload and try again.";
}

function sectionCount(playbook: ProposalPlaybookView) {
  if (playbook.content?.sectionOrder?.length) {
    return playbook.content.sectionOrder.length;
  }
  if (typeof playbook.content?.slotCount === "number") {
    return playbook.content.slotCount;
  }
  return 0;
}

function isPlaybookActive(playbook: ProposalPlaybookView) {
  return playbook.status === "approved";
}

function formatClock(iso: string | null | undefined) {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLastTrained(iso: string | null) {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "—";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startWhen = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const diffDays = Math.round(
    (startToday.getTime() - startWhen.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return when.toLocaleDateString();
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileDropCard({
  title,
  hint,
  accept,
  file,
  disabled,
  onFile,
}: {
  title: string;
  hint: string;
  accept: string;
  file: File | null;
  disabled?: boolean;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejectHint, setRejectHint] = useState<string | null>(null);
  const dragCount = useRef(0);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const takeFile = (next: File | undefined) => {
    if (!next) return;
    if (!fileMatchesAccept(next, accept)) {
      setRejectHint(`Use ${hint}.`);
      return;
    }
    setRejectHint(null);
    onFile(next);
  };

  const shell = dragOver
    ? "border-[#2563eb] bg-[#eef4ff]"
    : "border-[#d4d4d4] bg-[#f7f7f8] hover:border-[#2563eb] hover:bg-[#eef4ff]";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={file ? `${title}: ${file.name}. Click to change.` : `${title}. Click or drop a file.`}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled) return;
        dragCount.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCount.current = 0;
        setDragOver(false);
        if (disabled) return;
        takeFile(event.dataTransfer.files[0]);
      }}
      className={`flex min-h-[8.5rem] w-full cursor-pointer flex-col rounded-xl border border-dashed px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${shell}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {file ? (
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-caption hover:bg-white hover:text-text-danger"
            onClick={(event) => {
              event.stopPropagation();
              setRejectHint(null);
              onFile(null);
            }}
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <span className="mt-3 flex flex-1 flex-col items-center justify-center text-center">
        <FileText className="size-4 text-neutral-400" strokeWidth={1.75} />
        {file ? (
          <>
            <span className="mt-1.5 max-w-full truncate text-sm font-medium text-text-primary">
              {file.name}
            </span>
            <span className="text-[11px] text-text-caption">
              {formatBytes(file.size)} · Click to change or drop a new file
            </span>
          </>
        ) : dragOver ? (
          <>
            <span className="mt-1.5 text-sm font-medium text-text-primary">
              Drop to add
            </span>
            <span className="text-[11px] text-text-caption">{hint}</span>
          </>
        ) : (
          <>
            <span className="mt-1.5 text-sm font-medium text-text-primary">
              Add file
            </span>
            <span className="text-[11px] text-text-caption">
              Click or drag and drop · {hint}
            </span>
          </>
        )}
        {rejectHint ? (
          <span className="mt-1 text-[11px] text-text-danger">{rejectHint}</span>
        ) : null}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          takeFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function TrainStep({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "done" | "current" | "todo";
}) {
  const disc =
    state === "todo"
      ? "border border-[#d4d4d4] bg-white text-neutral-400"
      : "bg-[#0e8f50] text-white";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${disc}`}
      >
        {n}
      </span>
      <span
        className={`text-sm ${
          state === "todo" ? "text-text-caption" : "font-medium text-text-primary"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function rowStatusChip(badge: QueueBadge, linked: boolean) {
  if (badge === "failed") return `${CHIP_BASE} ${TONE_DANGER}`;
  if (badge === "pending") return `${CHIP_BASE} ${TONE_WARNING}`;
  if (linked) return `${CHIP_BASE} ${TONE_SUCCESS}`;
  return `${CHIP_BASE} ${TONE_WARNING}`;
}

function rowStatusLabel(badge: QueueBadge, linked: boolean) {
  if (badge === "failed") return "Failed";
  if (badge === "pending") return "Learning";
  if (linked) return "Active";
  return "Ready";
}

type PairSlotState = {
  key: string;
  reqFile: File | null;
  propFile: File | null;
  confidence: number | null;
  scoring: boolean;
  useAnyway: boolean;
  needsUseAnyway: boolean;
  scoreError: string | null;
};

function emptySlot(): PairSlotState {
  return {
    key: `slot-${Math.random().toString(36).slice(2, 9)}`,
    reqFile: null,
    propFile: null,
    confidence: null,
    scoring: false,
    useAnyway: false,
    needsUseAnyway: false,
    scoreError: null,
  };
}

export function ProposalPatternsPage() {
  const [batches, setBatches] = useState<ProposalCorpusBatchSummary[]>([]);
  const [playbooks, setPlaybooks] = useState<ProposalPlaybookView[]>([]);
  const [contentPlaybook, setContentPlaybook] =
    useState<ProposalContentPlaybookSummary | null>(null);
  const [slots, setSlots] = useState<PairSlotState[]>(() => [emptySlot()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const prevPendingCountRef = useRef<number | null>(null);
  const trainRef = useRef<HTMLElement>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setError(null);
    try {
      const [batchResult, playbookRows] = await Promise.all([
        fetchProposalCorpusBatches(),
        fetchProposalPlaybooks().catch(() => [] as ProposalPlaybookView[]),
      ]);
      setBatches(batchResult.items);
      setContentPlaybook(batchResult.contentPlaybook);
      setPlaybooks(playbookRows.filter((row) => row.status !== "rejected"));
    } catch (err) {
      if (!opts?.silent) {
        setError(
          err instanceof Error ? err.message : "Failed to load proposal patterns.",
        );
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = batches.filter(isBatchPending).length;
  const completedCount = batches.filter(
    (b) => batchQueueBadge(b) === "completed",
  ).length;
  const failedCount = batches.filter(isBatchFailed).length;

  useEffect(() => {
    if (pendingCount === 0) return undefined;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [pendingCount, load]);

  useEffect(() => {
    if (prevPendingCountRef.current === null) {
      prevPendingCountRef.current = pendingCount;
      return;
    }
    const wasPending = prevPendingCountRef.current;
    prevPendingCountRef.current = pendingCount;
    if (wasPending <= 0 || pendingCount > 0) return;
    if (failedCount > 0) {
      setMessage(
        "Queue finished. Some uploads need attention — review failed items below.",
      );
      return;
    }
    if (completedCount > 0) {
      setMessage(
        "All uploads finished learning. Patterns are ready to use when generating proposals.",
      );
    }
  }, [pendingCount, completedCount, failedCount]);

  const stats = useMemo(() => {
    const learned = playbooks.filter(isPlaybookActive).length || playbooks.length;
    const sectionCounts = playbooks.map(sectionCount).filter((n) => n > 0);
    const avgSections = sectionCounts.length
      ? Math.round(
          sectionCounts.reduce((sum, n) => sum + n, 0) / sectionCounts.length,
        )
      : 0;
    const latest = batches
      .map((b) => b.completedAt || b.updatedAt || b.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    return {
      learned,
      avgSections,
      lastTrained: formatLastTrained(latest),
    };
  }, [batches, playbooks]);

  const recentBatches = showAllRecent ? batches : batches.slice(0, 5);

  const readySlots = slots.filter((slot) => slot.reqFile && slot.propFile);
  const blockedByUseAnyway = readySlots.some(
    (slot) => slot.needsUseAnyway && !slot.useAnyway,
  );
  const scoringAny = slots.some((slot) => slot.scoring);
  const learnReady =
    readySlots.length > 0 &&
    !blockedByUseAnyway &&
    !scoringAny &&
    readySlots.every((slot) => slot.confidence != null || slot.scoreError);
  const reqState = slots.some((slot) => slot.reqFile) ? "done" : "todo";
  const propState = readySlots.length
    ? "done"
    : slots[0]?.propFile
      ? "done"
      : slots[0]?.reqFile
        ? "current"
        : "todo";
  const learnState =
    pendingCount > 0 ? "current" : learnReady ? "current" : "todo";
  const waitingHint = busy
    ? "Uploading…"
    : scoringAny
      ? "Scoring attached pairs…"
      : pendingCount > 0
        ? "Learning runs in the background."
        : blockedByUseAnyway
          ? "A pair scored very low. Confirm “use anyway” to include it."
          : learnReady
            ? readySlots.length === 1
              ? "Ready to learn this pair."
              : `Ready to learn ${readySlots.length} pairs.`
            : "Add a requirement and winning proposal in each slot.";

  const patchSlot = (key: string, patch: Partial<PairSlotState>) => {
    setSlots((prev) =>
      prev.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    );
  };

  const scoreSlot = async (slot: PairSlotState, req: File, prop: File) => {
    patchSlot(slot.key, {
      scoring: true,
      scoreError: null,
      confidence: null,
      needsUseAnyway: false,
      useAnyway: false,
    });
    try {
      const result = await scoreProposalCorpusPair({
        requirement: {
          filename: req.name,
          contentBase64: await fileToBase64(req),
          mime: req.type || null,
        },
        proposal: {
          filename: prop.name,
          contentBase64: await fileToBase64(prop),
          mime: prop.type || null,
        },
      });
      if (!result || result.ok === false) {
        patchSlot(slot.key, {
          scoring: false,
          scoreError: result?.error || "Could not score this pair.",
        });
        return;
      }
      patchSlot(slot.key, {
        scoring: false,
        confidence: result.confidence,
        needsUseAnyway: result.needsUseAnyway,
        useAnyway: false,
      });
    } catch (err) {
      patchSlot(slot.key, {
        scoring: false,
        scoreError: err instanceof Error ? err.message : "Could not score this pair.",
      });
    }
  };

  const setSlotFile = (
    slot: PairSlotState,
    side: "reqFile" | "propFile",
    file: File | null,
  ) => {
    const next = { ...slot, [side]: file, confidence: null, useAnyway: false, needsUseAnyway: false, scoreError: null };
    patchSlot(slot.key, {
      [side]: file,
      confidence: null,
      useAnyway: false,
      needsUseAnyway: false,
      scoreError: null,
    });
    const req = side === "reqFile" ? file : slot.reqFile;
    const prop = side === "propFile" ? file : slot.propFile;
    if (req && prop) void scoreSlot(next, req, prop);
  };

  const upload = async () => {
    if (!learnReady) {
      setError("Add at least one complete pair before learning.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const pairs = await Promise.all(
        readySlots.map(async (slot, index) => ({
          pairSlot: index,
          confidence: slot.confidence,
          useAnyway: slot.useAnyway,
          requirement: {
            filename: slot.reqFile!.name,
            contentBase64: await fileToBase64(slot.reqFile!),
            mime: slot.reqFile!.type || null,
          },
          proposal: {
            filename: slot.propFile!.name,
            contentBase64: await fileToBase64(slot.propFile!),
            mime: slot.propFile!.type || null,
          },
        })),
      );
      const result = await createProposalCorpusBatch({
        name: null,
        pairs,
        startProcessing: true,
      });
      if (!result || result.ok === false) {
        setError(result?.error || "Upload failed.");
        return;
      }
      setMessage(
        "Added to queue. Learning runs in the background — status updates below.",
      );
      setSlots([emptySlot()]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const workspace = (
    <ConfigurationShell>
      <div className="min-h-full bg-[#f3f4f6] px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="min-w-0">
            <h1 className={PAGE_H1_CLASS}>Proposal patterns</h1>
            <p className="mt-1 text-sm text-text-caption">
              Build reusable proposal intelligence from your best work.
            </p>
          </div>

          <div
            className={`grid grid-cols-3 overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}
          >
            {(
              [
                {
                  value: String(stats.learned),
                  label: "Patterns learned",
                  accent: false,
                },
                {
                  value: stats.avgSections ? String(stats.avgSections) : "—",
                  label: "Avg. sections",
                  accent: false,
                },
                {
                  value: stats.lastTrained,
                  label: "Last trained",
                  accent: stats.lastTrained === "Today",
                },
              ] as const
            ).map((item, index) => (
              <div
                key={item.label}
                className={`px-5 py-4 sm:px-6 ${
                  index > 0 ? "border-l border-[#ececec]" : ""
                }`}
              >
                <p
                  className={`text-2xl font-semibold tracking-tight ${
                    item.accent ? "text-[#c47a12]" : "text-text-primary"
                  }`}
                >
                  {item.value}
                </p>
                <p className="mt-0.5 text-xs text-text-caption">{item.label}</p>
              </div>
            ))}
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}

          {playbooks.some((p) => p.sectionLibrary) ? (
            <section className={CARD}>
              <h2 className="text-base font-semibold text-text-primary">
                Section library
              </h2>
              <p className="mt-0.5 text-sm text-text-caption">
                Read-only one-variant library derived from learning. Frozen
                layout is unchanged.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-text-secondary">
                {playbooks.flatMap((p) => {
                  const lib = p.sectionLibrary as {
                    sections?: Array<{ key?: string; title?: string }>;
                  } | null;
                  return (lib?.sections || []).map((s) => (
                    <li key={`${p.id}-${s.key}`}>{s.title || s.key}</li>
                  ));
                })}
              </ul>
            </section>
          ) : null}

          <section ref={trainRef} className={`${CARD} scroll-mt-4`}>
            <h2 className="text-base font-semibold text-text-primary">
              Train a new pattern
            </h2>
            <p className="mt-0.5 text-sm text-text-caption">
              Attach each BRD with its winning proposal in the same slot.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
              <TrainStep n={1} label="Requirement" state={reqState} />
              <span className="hidden h-px w-8 bg-neutral-200 sm:block" />
              <TrainStep n={2} label="Winning proposal" state={propState} />
              <span className="hidden h-px w-8 bg-neutral-200 sm:block" />
              <TrainStep n={3} label="Learn" state={learnState} />
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {slots.map((slot, index) => (
                <div
                  key={slot.key}
                  className="rounded-xl border border-[#ececec] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-primary">
                      Pair {index + 1}
                    </p>
                    {slots.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-text-caption hover:text-text-danger"
                        disabled={busy}
                        onClick={() =>
                          setSlots((prev) =>
                            prev.filter((row) => row.key !== slot.key),
                          )
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <FileDropCard
                      title="Requirement document"
                      hint="PDF, DOCX or TXT"
                      accept={REQ_ACCEPT}
                      file={slot.reqFile}
                      disabled={busy}
                      onFile={(file) => setSlotFile(slot, "reqFile", file)}
                    />
                    <FileDropCard
                      title="Winning proposal"
                      hint="PDF or DOCX"
                      accept={PROP_ACCEPT}
                      file={slot.propFile}
                      disabled={busy}
                      onFile={(file) => setSlotFile(slot, "propFile", file)}
                    />
                  </div>
                  {slot.scoring ? (
                    <p className="mt-2 text-xs text-text-caption">
                      Scoring this pair…
                    </p>
                  ) : slot.scoreError ? (
                    <p className="mt-2 text-xs text-rose-700">{slot.scoreError}</p>
                  ) : slot.confidence != null ? (
                    <div className="mt-2 space-y-1">
                      <p
                        className={`text-xs ${
                          slot.needsUseAnyway
                            ? "text-amber-800"
                            : "text-text-caption"
                        }`}
                      >
                        Pairing confidence {slot.confidence.toFixed(2)}
                        {slot.needsUseAnyway
                          ? " — score is below 0.30, so confirm these are the right documents (or check Use anyway)."
                          : ""}
                      </p>
                      {slot.needsUseAnyway ? (
                        <label className="flex items-center gap-2 text-xs text-text-primary">
                          <input
                            type="checkbox"
                            checked={slot.useAnyway}
                            onChange={(event) =>
                              patchSlot(slot.key, {
                                useAnyway: event.target.checked,
                              })
                            }
                          />
                          Use anyway
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-sm font-medium text-text-primary hover:text-neutral-600"
                  disabled={busy || slots.length >= 10}
                  onClick={() => setSlots((prev) => [...prev, emptySlot()])}
                >
                  Add another pair
                </button>
                <Button
                  type="button"
                  className="shrink-0"
                  disabled={busy || !learnReady}
                  onClick={() => void upload()}
                >
                  {busy ? "Working…" : "Learn pattern"}
                  {busy ? null : <ArrowRight className="size-4" strokeWidth={2} />}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs text-text-caption">{waitingHint}</p>
          </section>

          <section className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary">
                  Recently learned
                </h2>
                <p className="mt-0.5 text-sm text-text-caption">
                  Patterns are applied automatically when generating new
                  proposals.
                  {contentPlaybook
                    ? ` Content pattern: ${contentPlaybook.caseStudyCount} case stud${
                        contentPlaybook.caseStudyCount === 1 ? "y" : "ies"
                      }${
                        contentPlaybook.id
                          ? ` · ${contentPlaybook.confidenceLevel} confidence · v${contentPlaybook.version}`
                          : contentPlaybook.caseStudyCount < 3
                            ? " · need 3 to synthesize writing style"
                            : ""
                      }.`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {batches.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllRecent((v) => !v)}
                    className="text-sm font-medium text-text-primary hover:text-neutral-600"
                  >
                    {showAllRecent ? "Show less" : "View all →"}
                  </button>
                ) : null}
                <ConfirmDeleteButton
                  name="all learned extracts and patterns"
                  entityLabel="learned extracts"
                  buttonLabel="Clear extracts"
                  confirmLabel="Clear extracts"
                  disabled={
                    busy || (batches.length === 0 && playbooks.length === 0)
                  }
                  consequence="This removes every uploaded requirement/proposal pair and the frozen playbook for this organization. Existing generated proposals stay until you regenerate them."
                  onConfirm={async () => {
                    const result = await resetProposalPatterns();
                    if (!result || result.ok === false) {
                      return {
                        ok: false as const,
                        error: result?.error || "Failed to clear extracts.",
                      };
                    }
                    setMessage(
                      `Cleared ${result.deletedBatches} upload${result.deletedBatches === 1 ? "" : "s"} and ${result.deletedPlaybooks} pattern${result.deletedPlaybooks === 1 ? "" : "s"}. Upload a new requirement and winning proposal.`,
                    );
                    return { ok: true as const };
                  }}
                  onSuccess={() => void load()}
                />
              </div>
            </div>
            {batches.length === 0 ? (
              <p className="mt-6 text-sm text-text-caption">
                No uploads yet. Trained pairs appear here after learning
                finishes.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-t border-[#ececec] text-[11px] font-medium uppercase tracking-wide text-text-caption">
                      <th className="py-2.5 pr-3 text-left">Pattern</th>
                      <th className="w-24 py-2.5 px-3 text-right">Sections</th>
                      <th className="w-24 py-2.5 pl-3 text-right">Trained</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBatches.map((b) => {
                      const badge = batchQueueBadge(b);
                      const linked = playbooks.find(
                        (pb) => pb.sourceBatchId === b.id,
                      );
                      const title = linked?.name || batchTitle(b);
                      const sections = linked ? sectionCount(linked) : 0;
                      const filesLine = batchFileLine(b);
                      return (
                        <tr key={b.id} className="border-t border-[#ececec]">
                          <td className="py-3 pr-3 align-top">
                            <p className="font-semibold text-text-primary">
                              {title}
                            </p>
                            {filesLine ? (
                              <p className="mt-0.5 truncate text-xs text-text-caption">
                                {filesLine}
                              </p>
                            ) : null}
                            {badge === "pending" && batchStageHint(b) ? (
                              <p className="mt-0.5 text-xs text-text-caption">
                                {batchStageHint(b)}
                              </p>
                            ) : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span className={rowStatusChip(badge, Boolean(linked))}>
                                {rowStatusLabel(badge, Boolean(linked))}
                              </span>
                              {badge === "failed" ? (
                                <p className="text-xs text-text-caption">
                                  {batchGuidance(b)}
                                </p>
                              ) : null}
                              {badge !== "completed" ? (
                                <span className="flex items-center gap-1">
                                  {badge === "failed" ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      disabled={busy}
                                      onClick={async () => {
                                        setBusy(true);
                                        setError(null);
                                        const result =
                                          await processProposalCorpusBatch(b.id);
                                        setBusy(false);
                                        if (!result || result.ok === false) {
                                          setError(
                                            result?.error || "Retry failed.",
                                          );
                                          return;
                                        }
                                        setMessage("Re-queued for learning.");
                                        await load();
                                      }}
                                    >
                                      Retry
                                    </Button>
                                  ) : null}
                                  <ConfirmDeleteButton
                                    name={batchTitle(b)}
                                    entityLabel="upload"
                                    compact
                                    disabled={busy}
                                    consequence={
                                      isBatchPending(b)
                                        ? "This cancels in-progress learning and permanently removes the uploaded files for this batch."
                                        : "This permanently removes the uploaded files and processing records for this batch. Learned playbooks stay unless you remove them separately."
                                    }
                                    onConfirm={async () => {
                                      const result =
                                        await deleteProposalCorpusBatch(b.id);
                                      if (!result || result.ok === false) {
                                        return {
                                          ok: false,
                                          error:
                                            (result &&
                                              "error" in result &&
                                              result.error) ||
                                            "Failed to delete upload.",
                                        };
                                      }
                                      return { ok: true };
                                    }}
                                    onSuccess={() => void load()}
                                  />
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="w-24 py-3 px-3 align-top text-right tabular-nums text-text-primary">
                            {sections || "—"}
                          </td>
                          <td className="w-24 py-3 pl-3 align-top text-right tabular-nums text-text-caption">
                            {formatClock(
                              b.completedAt || b.updatedAt || b.createdAt,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </ConfigurationShell>
  );

  return (
    <AgentModuleShell
      moduleId="configuration"
      title="Proposal patterns"
      welcome="I'm your **configuration agent**. Upload historical winning proposal PDFs here. I'll learn that document as the template (look, fonts, tables) and use it when you generate a new proposal for a deal — same theme, this customer's data — not by copying the old PDF."
      workspace={workspace}
    />
  );
}
