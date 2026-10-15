import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import {
  formatContactType,
  formatStatus,
} from "@/components/contacts/contact-labels";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import type { CompanyContactRow, LocationDetail } from "@/services/companies";
import {
  CHIP_BASE,
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  TONE_INFO,
  TONE_MUTED,
} from "@/lib/ui-tones";

const LOCATION_TYPE_LABELS: Record<"hq" | "branch", string> = {
  hq: "HQ",
  branch: "Branch",
};

/**
 * The location page while it loads. Keeps BranchDetail's frame — the back link
 * works, the heading holds its place — so arriving does not blank the page and
 * then replace it.
 */
export function BranchDetailSkeleton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName?: string;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to={`/company/${companyId}`}>
        {companyName ? `${companyName} locations` : "Company locations"}
      </BackLink>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <SkeletonText width={260} height={30} />
          <Skeleton height={22} width={48} borderRadius={6} />
        </div>
        <div className="flex gap-2">
          <Skeleton height={36} width={124} borderRadius={8} />
          <Skeleton height={36} width={124} borderRadius={8} />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonCard key={index} className="px-5 py-4">
            <SkeletonText width="40%" height={12} />
            <div className="mt-2">
              <SkeletonText width="70%" height={14} />
            </div>
          </SkeletonCard>
        ))}
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={SECTION_H2_CLASS}>Contacts</h2>
            <div className="mt-1">
              <SkeletonText width={200} height={14} />
            </div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border-default bg-surface">
          <ul className="divide-y divide-border-default">
            {Array.from({ length: 3 }).map((_, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <SkeletonText width="38%" height={14} />
                  <div className="mt-1.5">
                    <SkeletonText width="56%" height={12} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Skeleton height={24} width={72} borderRadius={6} />
                  <Skeleton height={24} width={72} borderRadius={6} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export function BranchDetail({
  companyId,
  companyName,
  location,
  contacts,
}: {
  companyId: string;
  companyName: string;
  location: LocationDetail;
  contacts: CompanyContactRow[];
}) {
  const industry = location.industry || location.companyIndustry || "—";
  const size = location.employeeCount ?? location.companyEmployeeCount ?? null;
  // Real street address, else city. Never the location name — "Headquarters"
  // is a label, not an address.
  const address = location.address?.trim() || location.city?.trim() || "—";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to={`/company/${companyId}`}>
        {companyName} locations
      </BackLink>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className={PAGE_H1_CLASS}>
            {companyName} {location.name}
          </h1>
          <span
            className={`${CHIP_BASE} ${
              location.type === "hq" ? TONE_INFO : TONE_MUTED
            }`}
          >
            {LOCATION_TYPE_LABELS[location.type]}
          </span>
        </div>
        <div className="flex gap-2">
          <Link to={`/company/${companyId}/locations/${location.id}/edit`}>
            <Button type="button" variant="secondary">
              Edit location
            </Button>
          </Link>
          <Link
            to={`/contact/new?companyId=${companyId}&locationId=${location.id}`}
          >
            <Button type="button" variant="primary">
              <Plus className="size-4" />
              Add contact
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Industry" value={industry} />
        <SummaryCard
          label="Size"
          value={size != null ? `${size.toLocaleString()} employees` : "—"}
        />
        <SummaryCard label="Address" value={address} />
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={SECTION_H2_CLASS}>
              Contacts
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              {contacts.length === 0
                ? "No contacts for this company location yet"
                : contacts.length === 1
                  ? "1 contact at this location"
                  : `${contacts.length} contacts at this location`}
            </p>
          </div>
          <Link
            to={`/contact/new?companyId=${companyId}&locationId=${location.id}`}
            className="text-sm font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
          >
            + Add contact
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border-default bg-surface">
          {contacts.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-text-caption">
              No contacts yet. Add a contact for this company location.
            </p>
          ) : (
            <ul className="divide-y divide-border-default">
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <Link
                    to={`/contact/${contact.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-subtle"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {contact.displayName}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-text-caption">
                        {[contact.title, contact.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-text-caption">
                      <span className="rounded-md bg-neutral-100 px-2.5 py-1 font-medium text-text-secondary">
                        {formatContactType(contact.contactType)}
                      </span>
                      <span className="rounded-md bg-neutral-100 px-2.5 py-1 font-medium text-text-secondary">
                        {formatStatus(contact.status)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-caption">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}
