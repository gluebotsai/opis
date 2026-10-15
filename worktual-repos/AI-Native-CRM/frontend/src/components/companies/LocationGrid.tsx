import { Link } from "react-router-dom";
import { MapPin, Plus, UserRound } from "lucide-react";
import { avatarColorFromName, initialsFromName } from "@/lib/avatar";
import { BackLink } from "@/components/ui/BackLink";
import {
  CompanyContactsSection,
} from "@/components/companies/CompanyContactsSection";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import type { CompanyContactRow, LocationCard } from "@/services/companies";
import {
  EXPANSION_SIGNAL_LABELS,
  expansionSignalPillClass,
} from "@/lib/company-labels";
import {
  CHIP_BASE,
  CREATE_HIGHLIGHT_ROW_CLASS,
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  SUCCESS_FLASH_CLASS,
  TONE_INFO,
  TONE_MUTED,
} from "@/lib/ui-tones";

const LOCATION_TYPE_LABELS: Record<"hq" | "branch", string> = {
  hq: "HQ",
  branch: "Branch",
};

function LocationCardSkeleton() {
  return (
    <SkeletonCard className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <SkeletonText width="58%" height={20} />
        <Skeleton height={22} width={48} borderRadius={6} />
      </div>
      <div className="mt-2 space-y-1.5">
        <SkeletonText width="48%" />
        <SkeletonText width="72%" height={12} />
      </div>
      <div className="mt-auto mt-4 grid grid-cols-3 gap-2 border-t border-border-default pt-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-1">
            <SkeletonText width="70%" height={10} />
            <SkeletonText width={28} height={16} />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export function LocationGrid({
  companyId,
  companyName,
  locations,
  contacts,
  contactTotal,
  locationCount,
  ready = true,
  onAddLocation,
  expansionSignal,
  expansionReason,
  expansionDraft,
  expansionLastRunAt,
}: {
  companyId: string;
  companyName: string;
  locations: LocationCard[];
  contacts: CompanyContactRow[];
  contactTotal: number;
  /** Prefer over locations.length while list seed is available. */
  locationCount?: number;
  /** When false, show chrome + skeletons for count / locations / contacts. */
  ready?: boolean;
  /** When set, Add location opens in-shell draft instead of navigating away. */
  onAddLocation?: () => void;
  /** Expansion & Revenue Matcher Agent overlay — informational only. */
  expansionSignal?: string | null;
  expansionReason?: string | null;
  expansionDraft?: string | null;
  expansionLastRunAt?: string | null;
}) {
  const locationsShown = locationCount ?? locations.length;
  const locationSkeletonCount = Math.min(
    Math.max(locationCount ?? 3, 1),
    6,
  );

  const { createdToast, isHighlighted } = useCreateHighlight();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to="/company">All companies</BackLink>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border-default bg-surface p-5">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={`flex size-14 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white ${avatarColorFromName(companyName)}`}
            aria-hidden
          >
            {initialsFromName(companyName)}
          </div>
          <div className="min-w-0">
            <h1 className={PAGE_H1_CLASS}>{companyName}</h1>
            {!ready ? (
              <div className="mt-2">
                <SkeletonText width={180} height={14} />
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`${CHIP_BASE} ${TONE_MUTED}`}>
                  {locationsShown} {locationsShown === 1 ? "location" : "locations"}
                </span>
                <span className={`${CHIP_BASE} ${TONE_MUTED}`}>
                  {contactTotal} {contactTotal === 1 ? "contact" : "contacts"}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/contact/new?companyId=${companyId}`}>
            <Button type="button" variant="secondary">
              Add contact
            </Button>
          </Link>
          <Link to={`/company/${companyId}/edit`}>
            <Button type="button" variant="secondary">
              Edit company
            </Button>
          </Link>
          {onAddLocation ? (
            <Button type="button" variant="primary" onClick={onAddLocation}>
              <Plus className="size-4" />
              Add location
            </Button>
          ) : (
            <Link to={`/company/${companyId}/locations/new`}>
              <Button type="button" variant="primary">
                <Plus className="size-4" />
                Add location
              </Button>
            </Link>
          )}
        </div>
      </div>

      {createdToast ? (
        <p
          className={`mt-4 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Location created — it's highlighted below.
        </p>
      ) : null}

      {ready && expansionSignal && expansionSignal !== "none" ? (
        <section className="mt-4 rounded-xl border border-border-default bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              Expansion opportunity
            </h3>
            <span className={expansionSignalPillClass(expansionSignal)}>
              {EXPANSION_SIGNAL_LABELS[expansionSignal] ?? expansionSignal}
            </span>
          </div>
          {expansionReason ? (
            <p className="mt-2 text-sm text-text-secondary">
              {expansionReason}
            </p>
          ) : null}
          {expansionDraft ? (
            <div className="mt-3 rounded-lg bg-subtle p-3">
              <p className="text-xs font-medium text-text-caption">
                Outreach draft (personalize and send manually, or adapt)
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                {expansionDraft}
              </p>
            </div>
          ) : null}
          {expansionLastRunAt ? (
            <p className="mt-2 text-xs text-text-caption">
              Assessed {new Date(expansionLastRunAt).toLocaleString()}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className={SECTION_H2_CLASS}>Locations</h2>
        <p className="mt-1 text-sm text-text-caption">
          Branches and HQ under this account
        </p>

        {!ready ? (
          <SkeletonGrid columns="sm:grid-cols-2 lg:grid-cols-3" className="mt-4">
            {Array.from({ length: locationSkeletonCount }).map((_, index) => (
              <LocationCardSkeleton key={index} />
            ))}
          </SkeletonGrid>
        ) : locations.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border-default bg-surface px-6 py-16 text-center">
            <p className="text-sm font-medium text-text-primary">
              No locations yet
            </p>
            {onAddLocation ? (
              <Button
                type="button"
                variant="primary"
                className="mt-4"
                onClick={onAddLocation}
              >
                Add location
              </Button>
            ) : (
              <Link
                to={`/company/${companyId}/locations/new`}
                className="mt-4 inline-block"
              >
                <Button type="button" variant="primary">
                  Add location
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                data-highlight-id={loc.id}
                to={`/company/${companyId}/locations/${loc.id}`}
                className={`flex flex-col rounded-xl border border-border-default bg-surface p-5 transition-colors hover:border-brand/40 hover:bg-state-hover ${
                  isHighlighted(loc.id) ? CREATE_HIGHLIGHT_ROW_CLASS : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-text-primary">
                    {loc.name}
                  </h3>
                  <span
                    className={`${CHIP_BASE} shrink-0 ${
                      loc.type === "hq" ? TONE_INFO : TONE_MUTED
                    }`}
                  >
                    {LOCATION_TYPE_LABELS[loc.type]}
                  </span>
                </div>

                <p className="mt-3 flex items-center gap-1.5 text-sm text-text-secondary">
                  <UserRound className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  {loc.ownerName ?? "Unassigned"}
                </p>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-text-caption">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="line-clamp-2">{loc.address || loc.city || "No address"}</span>
                </p>

                <div className="mt-auto mt-4 grid grid-cols-3 gap-2 border-t border-border-default pt-3">
                  <Stat label="Leads" value={loc.leadCount} />
                  <Stat label="Deals" value={loc.dealCount} />
                  <Stat label="Customers" value={loc.customerCount} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CompanyContactsSection
        companyId={companyId}
        contacts={contacts}
        total={contactTotal}
        ready={ready}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-text-primary">
        {value}
      </p>
    </div>
  );
}
