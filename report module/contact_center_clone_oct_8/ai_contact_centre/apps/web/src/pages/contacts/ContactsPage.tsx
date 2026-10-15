import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { CopilotWorkspace } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { ContactCreatePanel } from "@/components/contacts/contact-create-panel";
import { ContactDetailPanel } from "@/components/contacts/contact-detail-panel";
import { ContactGuidedPreview } from "@/components/contacts/contact-guided-preview";
import { ContactOperationPreview } from "@/components/contacts/contact-operation-preview";
import { ContactsSummaryPanel } from "@/components/contacts/contacts-summary-panel";
import {
  ASSISTANT_CANCEL_CONTACT_PREVIEW,
  ASSISTANT_CONTACT_DRAFT,
  ASSISTANT_CONTACT_PREVIEW,
  ASSISTANT_REFRESH_CONTACTS,
  type ContactConfirmation,
  type ContactGuidedDraft,
} from "@/features/assistant/assistant-api";
import {
  contactToDraftSnapshot,
  mergeContactGuidedDraft,
} from "@/features/assistant/contact-guided-draft";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { contactsApi } from "@/features/contacts/api";
import type { CdpContact, ContactListFilter } from "@/features/contacts/types";
import { isSessionError } from "@/store/slices/auth-slice";

const CONTACT_PAGE_SIZE = 20;

function contactMatchesSearch(contact: CdpContact, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const custom = contact.customFields ?? {};
  const customName =
    typeof custom.customerName === "string"
      ? custom.customerName
      : typeof custom.displayName === "string"
        ? custom.displayName
        : "";
  const haystack = [
    contact.fullName,
    contact.firstName,
    contact.lastName,
    customName,
    contact.primaryEmail,
    contact.secondaryEmail,
    contact.primaryPhone,
    contact.secondaryPhone,
    contact.company,
    contact.industry,
    contact.city,
    contact.country,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n")
    .toLowerCase();
  if (tokens.every((token) => haystack.includes(token))) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const phones = `${contact.primaryPhone ?? ""}${contact.secondaryPhone ?? ""}`.replace(/\D/g, "");
  return phones.includes(digits);
}

export default function ContactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { setContactDraft: setPageContactDraft } = useCopilotPage();
  const selectedContactId = searchParams.get("contact");
  const editMode = searchParams.get("edit") === "1";
  const createMode = searchParams.get("create") === "1" && !selectedContactId;
  const [expandedSide, setExpandedSide] = useState<"left" | "right">(
    selectedContactId || createMode ? "right" : "left",
  );
  const [contacts, setContacts] = useState<CdpContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<CdpContact | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [contactFilter, setContactFilter] = useState<ContactListFilter>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [contactPreview, setContactPreview] = useState<ContactConfirmation | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactGuidedDraft | null>(null);
  const requestSeqRef = useRef(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (selectedContactId || createMode) {
      setExpandedSide("right");
      return;
    }
    if (!contactPreview && !contactDraft) {
      setExpandedSide("left");
    }
  }, [selectedContactId, createMode, contactPreview, contactDraft]);

  useEffect(() => {
    if (selectedContactId && contactDraft?.mode === "create") {
      setContactDraft(null);
    }
  }, [contactDraft?.mode, selectedContactId]);

  useEffect(() => {
    setPageContactDraft(contactDraft);
    return () => setPageContactDraft(null);
  }, [contactDraft, setPageContactDraft]);

  const loadContactsPage = useCallback(
    async (pageNum: number, mode: "reset" | "append") => {
      const requestId = ++requestSeqRef.current;
      if (mode === "reset") {
        setError(null);
        if (hasLoadedRef.current) setSearching(true);
        else setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const result = await contactsApi.listContacts({
          search: debouncedSearch,
          filter: contactFilter,
          sort: "updatedAt",
          order: "desc",
          page: pageNum,
          pageSize: CONTACT_PAGE_SIZE,
        });
        if (requestId !== requestSeqRef.current) return;
        hasLoadedRef.current = true;
        setContacts((current) =>
          mode === "reset" ? result.contacts : [...current, ...result.contacts],
        );
        setHasMore(result.hasMore);
        setPage(pageNum);
      } catch (err) {
        if (requestId !== requestSeqRef.current) return;
        const message = err instanceof Error ? err.message : "Failed to load contacts";
        if (!isSessionError(message)) {
          setError(message);
        }
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setSearching(false);
        }
      }
    },
    [debouncedSearch, contactFilter],
  );

  const refreshContacts = useCallback(() => {
    void loadContactsPage(1, "reset");
  }, [loadContactsPage]);

  useEffect(() => {
    void loadContactsPage(1, "reset");
  }, [loadContactsPage]);

  const loadMoreContacts = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void loadContactsPage(page + 1, "append");
  }, [hasMore, loadContactsPage, loading, loadingMore, page]);

  useEffect(() => {
    function handleRefresh() {
      refreshContacts();
      if (selectedContactId) {
        void contactsApi.getContact(selectedContactId).then(({ contact }) => {
          setSelectedContact(contact);
          setDetailError(null);
        });
      }
    }
    function showPreview(event: Event) {
      const detail = (event as CustomEvent<ContactConfirmation>).detail;
      if (!detail) return;
      setContactPreview(detail);
    }
    function clearPreview() {
      setContactPreview(null);
      setContactDraft(null);
    }
    function showDraft(event: Event) {
      const detail = (event as CustomEvent<ContactGuidedDraft | null>).detail;
      if (detail?.mode === "create" && selectedContactId) {
        setContactDraft(null);
        return;
      }
      setContactDraft((current) => {
        if (!detail) return null;
        const incoming = {
          ...detail,
          contactId: detail.contactId ?? selectedContactId ?? current?.contactId ?? null,
        };
        return mergeContactGuidedDraft(current, incoming);
      });
    }

    window.addEventListener(ASSISTANT_REFRESH_CONTACTS, handleRefresh);
    window.addEventListener(ASSISTANT_CONTACT_PREVIEW, showPreview);
    window.addEventListener(ASSISTANT_CONTACT_DRAFT, showDraft);
    window.addEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearPreview);
    return () => {
      window.removeEventListener(ASSISTANT_REFRESH_CONTACTS, handleRefresh);
      window.removeEventListener(ASSISTANT_CONTACT_PREVIEW, showPreview);
      window.removeEventListener(ASSISTANT_CONTACT_DRAFT, showDraft);
      window.removeEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearPreview);
    };
  }, [refreshContacts, selectedContactId]);

  useEffect(() => {
    if (!selectedContactId) {
      setSelectedContact(null);
      setDetailError(null);
      return;
    }

    async function loadContact(id: string) {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const { contact } = await contactsApi.getContact(id);
        setSelectedContact(contact);
      } catch (err) {
        setSelectedContact(null);
        setDetailError(err instanceof Error ? err.message : "Failed to load contact");
      } finally {
        setDetailLoading(false);
      }
    }

    void loadContact(selectedContactId);
  }, [selectedContactId]);

  const visibleContacts = useMemo(() => {
    const typed = search.trim();
    if (!typed || typed.toLowerCase() === debouncedSearch.toLowerCase()) return contacts;
    return contacts.filter((contact) => contactMatchesSearch(contact, typed));
  }, [contacts, debouncedSearch, search]);

  function openContact(contactId: string) {
    setSearchParams({ contact: contactId });
    setExpandedSide("right");
  }

  function closeContact() {
    setSearchParams({});
    setExpandedSide("left");
  }

  function openCreate() {
    setContactPreview(null);
    setContactDraft(null);
    setSearchParams({ create: "1" });
    setExpandedSide("right");
  }

  function closeCreate() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete("create");
      return next;
    });
    if (!selectedContactId) {
      setExpandedSide("left");
    }
  }

  function handleContactCreated(contact: CdpContact) {
    refreshContacts();
    setSearchParams({ contact: contact.id });
    setExpandedSide("right");
  }

  return (
    <CopilotWorkspace
      title="Contacts"
      subtitle="Search customers, view profiles, and conversation history."
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={<EmbeddedCopilotPanel />}
    >
      {contactPreview ? (
        <ContactOperationPreview
          confirmation={contactPreview}
          onClose={() => setContactPreview(null)}
        />
      ) : contactDraft ? (
        <ContactGuidedPreview
          draft={contactDraft}
          currentContact={contactToDraftSnapshot(
            selectedContact ??
              contacts.find((contact) => contact.id === contactDraft.contactId),
          )}
          onClose={() => setContactDraft(null)}
        />
      ) : createMode ? (
        <ContactCreatePanel onClose={closeCreate} onCreated={handleContactCreated} />
      ) : selectedContactId ? (
        <ContactDetailPanel
          contact={selectedContact}
          loading={detailLoading}
          error={detailError}
          initialEditing={editMode}
          onClose={closeContact}
          onSaved={(contact) => {
            setSelectedContact(contact);
            setSearchParams({ contact: contact.id });
            refreshContacts();
          }}
        />
      ) : (
        <ContactsSummaryPanel
          contacts={visibleContacts}
          selectedId={selectedContactId}
          search={search}
          searching={searching || search.trim() !== debouncedSearch}
          contactFilter={contactFilter}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          error={error}
          onSearchChange={setSearch}
          onContactFilterChange={setContactFilter}
          onSelectContact={openContact}
          onCreateContact={openCreate}
          onRefresh={refreshContacts}
          onLoadMore={loadMoreContacts}
        />
      )}

    </CopilotWorkspace>
  );
}
