import { ChevronDown, Clock, LoaderCircle, StickyNote } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { PanelLoader } from "@/components/ui/panel-loader";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import type { WorkspaceConversation } from "@/features/workspace/types";
import type { WorkspaceNote, WorkspaceNoteScope } from "@/features/workspace/notes-types";
import { useWorkspaceNotes } from "@/features/workspace/use-workspace-notes";
import { formatConversationTime } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

const SAVE_SCOPES: { id: WorkspaceNoteScope; label: string }[] = [
  { id: "customer", label: "Customer" },
  { id: "team", label: "My notes" },
];

type NotesSectionId = "common" | "customer";

function NotesCollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  className,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
        aria-expanded={expanded}
      >
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-neutral-400 transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? <div className="px-3 pb-4">{children}</div> : null}
    </div>
  );
}

function NoteItem({ note }: { note: WorkspaceNote }) {
  return (
    <li>
      <article className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="px-3.5 py-3">
          <p className="truncate text-sm font-semibold leading-5 text-neutral-900">
            {note.title?.trim() || "Note"}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-snug text-neutral-600">
            {note.body}
          </p>
          <footer className="mt-3 flex items-center justify-between gap-2 border-t-[0.6px] border-[#bfbfbf] pt-2.5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-neutral-600">
              <Clock className="size-3 shrink-0 text-neutral-600" aria-hidden="true" />
              <span className="truncate">{formatConversationTime(note.createdAt)}</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-neutral-600">
              {note.authorName?.trim() || "You"}
            </span>
          </footer>
        </div>
      </article>
    </li>
  );
}

function NotesList({
  notes,
  loading,
  emptyTitle,
  emptyDescription,
}: {
  notes: WorkspaceNote[];
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (loading && notes.length === 0) {
    return <PanelLoader label="Loading notes…" />;
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50 px-4 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-200/80">
          <StickyNote className="size-4 text-neutral-400" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-medium text-neutral-700">{emptyTitle}</p>
        <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-neutral-600">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
    </ul>
  );
}

export function WorkspaceNotesTab({ conversation }: { conversation: WorkspaceConversation }) {
  const {
    titleDraft,
    setTitleDraft,
    draft,
    setDraft,
    saveScope,
    setSaveScope,
    customerNotes,
    commonNotes,
    loadingCustomer,
    loadingCommon,
    saving,
    saveError,
    loadError,
    success,
    saveNote,
  } = useWorkspaceNotes({
    conversationId: conversation.id,
    visitorId: conversation.customer.id,
    contactId: conversation.customer.contactId,
  });

  const [expandedSection, setExpandedSection] = useState<NotesSectionId | null>("customer");

  useEffect(() => {
    setExpandedSection("customer");
  }, [conversation.id]);

  useEffect(() => {
    if (!success) return;
    setExpandedSection(saveScope === "team" ? "common" : "customer");
  }, [success, saveScope]);

  const toggleSection = useCallback((section: NotesSectionId) => {
    setExpandedSection((current) => (current === section ? null : section));
  }, []);

  const canSave = Boolean(titleDraft.trim() && draft.trim()) && !saving;
  const customerLabel =
    conversation.customer.name?.trim() ||
    conversation.customer.email?.trim() ||
    conversation.customer.phone?.trim() ||
    "this customer";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 bg-white px-4 pt-3 pb-3 xl:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">Add note</p>
            <p className="mt-0.5 text-[12px] leading-4 text-neutral-600">
              {saveScope === "customer"
                ? "Visible to all other agents and Admin"
                : "Private to you and Admin"}
            </p>
          </div>
          <SegmentTabs
            value={saveScope}
            options={SAVE_SCOPES}
            onChange={setSaveScope}
            fitContent
            className="shrink-0"
          />
        </div>

        <input
          type="text"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          placeholder="Title"
          maxLength={120}
          className="mt-3 w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-[13px] font-medium text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
        />
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            saveScope === "customer"
              ? `Note about ${customerLabel}…`
              : "Personal reference note…"
          }
          rows={4}
          className="mt-2 w-full resize-none rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-[13px] leading-5 text-neutral-800 outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
        />

        <div className="mt-2.5 flex items-center justify-end gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {saveError || success ? (
              <p className="min-w-0 truncate text-[11px]">
                {saveError ? (
                  <span className="text-red-600">{saveError}</span>
                ) : (
                  <span className="text-emerald-700">{success}</span>
                )}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void saveNote()}
              className={cn(
                "inline-flex h-[38px] shrink-0 items-center rounded-md px-3 text-[12px] font-semibold transition",
                canSave
                  ? "bg-neutral-900 text-white hover:bg-neutral-800"
                  : "cursor-not-allowed bg-neutral-100 text-neutral-400",
              )}
            >
              {saving ? (
                <>
                  <LoaderCircle className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                  Saving
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </div>

        {loadError ? <p className="mt-2 text-[12px] text-red-600">{loadError}</p> : null}
      </div>

      <PanelScrollArea className="min-h-0 flex-1 border-t-[0.6px] border-[#bfbfbf]">
        <NotesCollapsibleSection
          title="My notes"
          expanded={expandedSection === "common"}
          onToggle={() => toggleSection("common")}
          className="border-b-[0.6px] border-[#bfbfbf]"
        >
          <NotesList
            notes={commonNotes}
            loading={loadingCommon}
            emptyTitle="No notes yet"
            emptyDescription="Save a personal reference note above."
          />
        </NotesCollapsibleSection>

        <NotesCollapsibleSection
          title="Customer notes"
          expanded={expandedSection === "customer"}
          onToggle={() => toggleSection("customer")}
        >
          <NotesList
            notes={customerNotes}
            loading={loadingCustomer}
            emptyTitle="No customer notes"
            emptyDescription={`Nothing saved for ${customerLabel} yet.`}
          />
        </NotesCollapsibleSection>
      </PanelScrollArea>
    </div>
  );
}

export function CustomerNotesBlock({
  notes,
  scroll = "panel",
}: {
  notes: WorkspaceNote[];
  scroll?: "panel" | "preview" | "flow";
}) {
  return (
    <div
      className={cn(
        "px-3 pb-3",
        scroll === "preview" && "max-h-80 overflow-y-auto overscroll-contain",
        scroll === "flow" && "overflow-visible",
        scroll === "panel" && "min-h-0 flex-1 overflow-y-auto overscroll-contain",
      )}
    >
      <ul className="space-y-3">
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} />
        ))}
      </ul>
    </div>
  );
}
