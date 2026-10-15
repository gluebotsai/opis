import { type UIEvent } from "react";
import { Search, Users, LoaderCircle, X } from "lucide-react";

import {
  PanelExpandButton,
  PanelRefreshButton,
} from "@/components/assistant/copilot-workspace";
import { ContactsListSkeleton } from "@/components/contacts/contacts-summary-skeleton";
import { Button } from "@/components/ui/button";
import { NativeSelectSm } from "@/components/ui/native-select";
import { listRowButtonClassName, listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { useMainFlush } from "@/contexts/main-flush";
import {
  contactAvatarClassName,
  contactInitials,
  contactLocation,
  contactPreviewDisplayName,
  formatUpdatedAt,
} from "@/features/contacts/contacts-utils";
import type { CdpContact, ContactListFilter } from "@/features/contacts/types";
import { cn } from "@/lib/utils";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

const CONTACT_LIST_FILTERS: Array<{ value: ContactListFilter; label: string }> = [
  { value: "all", label: "All contacts" },
  { value: "unknown", label: "Unknown contacts" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

type ContactsSummaryPanelProps = {
  contacts: CdpContact[];
  selectedId: string | null;
  search: string;
  searching?: boolean;
  contactFilter: ContactListFilter;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onContactFilterChange: (value: ContactListFilter) => void;
  onSelectContact: (contactId: string) => void;
  onCreateContact: () => void;
  onRefresh: () => void;
  onLoadMore?: () => void;
};

export function ContactsSummaryPanel({
  contacts,
  selectedId,
  search,
  searching = false,
  contactFilter,
  loading,
  loadingMore = false,
  hasMore = false,
  error,
  onSearchChange,
  onContactFilterChange,
  onSelectContact,
  onCreateContact,
  onRefresh,
  onLoadMore,
}: ContactsSummaryPanelProps) {
  const { copilotMinimized } = useMainFlush();

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (!onLoadMore || !hasMore || loading || loadingMore) return;
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 120) {
      onLoadMore();
    }
  }

  const toolbar = (
    <>
      <PanelRefreshButton onClick={onRefresh} refreshing={loading} />
      <Button onClick={onCreateContact}>Create</Button>
      <PanelExpandButton side="right" />
    </>
  );

  return (
    <div className={contentPanelClassName}>
      {copilotMinimized ? null : (
        <div className={`shrink-0 px-4 py-3.5 ${contentPanelHeaderBorderClassName}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-neutral-900">Contacts</h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Search customers, view profiles, and conversation history
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-neutral-900" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  onSearchChange("");
                }
              }}
              placeholder="Search name, email, company, phone…"
              aria-label="Search contacts by name, email, company, or phone"
              autoComplete="off"
              spellCheck={false}
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-9 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {searching ? (
              <LoaderCircle className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 animate-spin text-neutral-500" />
            ) : search ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange("")}
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
              >
                <X className="size-3.5" strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
          <NativeSelectSm
            value={contactFilter}
            onChange={(event) => onContactFilterChange(event.target.value as ContactListFilter)}
            aria-label="Filter contacts"
            wrapperClassName="w-36 shrink-0 sm:w-40"
            className="h-[38px] w-36 bg-neutral-50 text-sm text-neutral-700 focus:bg-white sm:w-40"
          >
            {CONTACT_LIST_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelectSm>
          {copilotMinimized ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 shrink-0">
          <StatusBanner tone="error">{error}</StatusBanner>
        </div>
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1 px-3 pb-3" onScroll={handleScroll}>
        {loading ? (
          <ContactsListSkeleton />
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
              {searching ? (
                <LoaderCircle className="size-4 animate-spin text-neutral-600" />
              ) : (
                <Users className="size-4 text-neutral-600" />
              )}
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-800">
              {searching ? "Searching contacts…" : "No contacts found"}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {searching ? "Matching name, email, company, and phone." : "Try another search or filter."}
            </p>
          </div>
        ) : (
          <ul>
            {contacts.map((contact) => {
              const isSelected = contact.id === selectedId;
              const location = contactLocation(contact);
              const displayName = contactPreviewDisplayName(contact);
              const metaLine = [contact.company, contact.industry, location].filter(Boolean).join(" · ");

              return (
                <li
                  key={contact.id}
                  className={listRowDividerClassName()}
                >
                  <button
                    type="button"
                    onClick={() => onSelectContact(contact.id)}
                    className={cn(
                      listRowButtonClassName,
                      "group flex items-start gap-3",
                      isSelected ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div className={contactAvatarClassName(contact.id, "size-10 text-xs")}>
                      {contactInitials(displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900">{displayName}</p>
                      <p className="mt-1 truncate text-sm text-neutral-600">
                        {contact.primaryEmail ?? contact.primaryPhone ?? "—"}
                      </p>
                      <p className="mt-1 truncate text-sm text-neutral-600">
                        {metaLine || "\u00A0"}
                      </p>
                    </div>
                    <span className={cn(listRowTimestampClassName, "pt-0.5")}>
                      {formatUpdatedAt(contact.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {loadingMore ? (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-neutral-600">
            <LoaderCircle className="size-3.5 animate-spin" />
            Loading more contacts…
          </div>
        ) : null}
      </PanelScrollArea>
    </div>
  );
}
