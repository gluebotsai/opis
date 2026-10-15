import { useCallback, useEffect, useState } from "react";

import { workspaceNotesApi } from "./notes-api";
import type { WorkspaceNote, WorkspaceNoteScope } from "./notes-types";

export function useWorkspaceNotes({
  conversationId,
  visitorId,
  contactId = null,
  includeCommon = true,
}: {
  conversationId: string;
  visitorId: string;
  contactId?: string | null;
  includeCommon?: boolean;
}) {
  const [titleDraft, setTitleDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [saveScope, setSaveScope] = useState<WorkspaceNoteScope>("customer");
  const [customerNotes, setCustomerNotes] = useState<WorkspaceNote[]>([]);
  const [commonNotes, setCommonNotes] = useState<WorkspaceNote[]>([]);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [loadingCommon, setLoadingCommon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCustomerNotes = useCallback(async () => {
    if (!visitorId) return;
    setLoadingCustomer(true);
    try {
      const notes = await workspaceNotesApi.listVisitorNotes(visitorId, contactId);
      setCustomerNotes(notes);
      setLoadError(null);
    } catch {
      setLoadError("Could not load customer notes.");
    } finally {
      setLoadingCustomer(false);
    }
  }, [contactId, visitorId]);

  const loadCommonNotes = useCallback(async () => {
    setLoadingCommon(true);
    try {
      const notes = await workspaceNotesApi.listCommonNotes();
      setCommonNotes(notes);
      setLoadError((current) => (current === "Could not load customer notes." ? current : null));
    } catch {
      setLoadError((current) => current ?? "Could not load my notes.");
    } finally {
      setLoadingCommon(false);
    }
  }, []);

  useEffect(() => {
    setLoadError(null);
    void loadCustomerNotes();
    if (includeCommon) void loadCommonNotes();
  }, [includeCommon, loadCustomerNotes, loadCommonNotes, conversationId]);

  useEffect(() => {
    setTitleDraft("");
    setDraft("");
    setSuccess(null);
    setSaveError(null);
    setSaveScope("customer");
  }, [conversationId]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 2500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const saveNote = useCallback(async () => {
    const title = titleDraft.trim();
    const body = draft.trim();
    if (!title || !body) return;

    setSaving(true);
    setSaveError(null);
    setSuccess(null);
    try {
      if (saveScope === "team") {
        const note = await workspaceNotesApi.saveCommonNote({ title, body });
        setCommonNotes((prev) => [note, ...prev]);
        setSuccess("Added to my notes.");
      } else {
        const note = await workspaceNotesApi.saveConversationNote(conversationId, {
          title,
          body,
        });
        setCustomerNotes((prev) => [note, ...prev]);
        setSuccess("Added to this customer.");
      }
      setTitleDraft("");
      setDraft("");
    } catch {
      setSaveError("Could not save note. Try again.");
    } finally {
      setSaving(false);
    }
  }, [conversationId, draft, saveScope, titleDraft]);

  return {
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
  };
}
