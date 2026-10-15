import { RefreshCw, Search, Users } from "lucide-react";
import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { Button } from "@/components/ui/Button";
import { ContactsPageSkeleton } from "@/pages/ContactsPageSkeleton";
import { PanelScrollArea } from "@/components/ui/PanelScrollArea";
import {
  contactDisplayName,
  formatContactRelativeTime,
  type ContactItem,
} from "@/services/contacts.service";
import { cn } from "@/utils/cn";

export function contactListInitials(name: string): string {
  const parts = name.replace(/—/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function contactListAvatarClass(seed: string): string {
  const palette = [
    "bg-sky-100 text-sky-800",
    "bg-amber-100 text-amber-900",
    "bg-emerald-100 text-emerald-800",
    "bg-rose-100 text-rose-800",
    "bg-violet-100 text-violet-800",
    "bg-neutral-200 text-neutral-800",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % palette.length;
  }
  return palette[hash] ?? palette[0];
}

function secondaryLine(row: ContactItem): string {
  const company = (row.company_name || "").trim();
  const email = (row.email || "").trim();
  const phone = (row.phone || "").trim();
  const city = (row.city || "").trim();
  const parts = [company, email || phone, city].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export type ContactsSummaryStats = {
  total: number;
  withChannel: number;
};

type ContactsSummaryPanelProps = {
  title: string;
  contacts: ContactItem[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  error: string | null;
  stats: ContactsSummaryStats;
  unitOne: string;
  unitMany: string;
  page: number;
  totalPages: number;
  onSearchChange: (value: string) => void;
  onSelectContact: (contactId: string) => void;
  onPageChange: (page: number) => void;
  onExport?: () => void;
  onImport?: () => void;
  onRefresh?: () => void;
};

export function ContactsSummaryPanel({
  title,
  contacts,
  selectedId,
  search,
  loading,
  error,
  stats,
  unitOne,
  unitMany,
  page,
  totalPages,
  onSearchChange,
  onSelectContact,
  onPageChange,
  onExport,
  onImport,
  onRefresh,
}: ContactsSummaryPanelProps) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const countLabel = loading
    ? "Loading…"
    : `${stats.total} ${stats.total === 1 ? unitOne : unitMany}${
        totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""
      }`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf]/80 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
            <p className="mt-1 text-xs text-neutral-400">{countLabel}</p>
          </div>
          <div className="flex h-[38px] shrink-0 items-center gap-0.5">
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                aria-label="Refresh list"
              >
                <RefreshCw className="size-[18px]" strokeWidth={2.25} />
              </button>
            ) : null}
            {onExport ? (
              <Button
                type="button"
                variant="secondary"
                className="h-[38px] px-3 text-sm"
                disabled={loading || contacts.length === 0}
                onClick={onExport}
              >
                Export
              </Button>
            ) : null}
            {onImport ? (
              <Button
                type="button"
                className="h-[38px] bg-[#111111] px-3 text-sm text-white hover:bg-neutral-800"
                disabled={loading}
                onClick={onImport}
              >
                Import
              </Button>
            ) : null}
            <PanelExpandButton side="right" />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-neutral-500"
            strokeWidth={2.25}
          />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search name, email, company, phone…"
            className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white pr-3 pl-10 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/80"
          />
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-2 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="px-4 py-3">
            <ContactsPageSkeleton />
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
              <Users className="size-[18px] text-neutral-600" strokeWidth={2.25} />
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-800">
              No contacts found
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Try another search, or create via chat.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {contacts.map((contact) => {
              const isSelected = contact.id === selectedId;
              const displayName = contactDisplayName(contact);
              return (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => onSelectContact(contact.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                      isSelected ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div
                      className={cn(
                        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        contactListAvatarClass(contact.id),
                      )}
                    >
                      {contactListInitials(displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {displayName}
                        </p>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {formatContactRelativeTime(contact.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate pr-2 text-sm text-neutral-500">
                        {secondaryLine(contact)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelScrollArea>

      {totalPages > 1 ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t-[0.6px] border-[#bfbfbf]/80 px-4 py-2.5">
          <Button
            type="button"
            variant="secondary"
            className="h-[38px] px-3 text-sm"
            disabled={loading || !canPrev}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs tabular-nums text-neutral-500">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="h-[38px] px-3 text-sm"
            disabled={loading || !canNext}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
