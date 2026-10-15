import { Link } from "react-router-dom";
import {
  formatContactType,
  formatStatus,
} from "@/components/contacts/contact-labels";
import { avatarColorFromName, initialsFromName } from "@/lib/avatar";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { TONE_MUTED, TONE_SUCCESS } from "@/lib/ui-tones";
import type { CompanyContactRow } from "@/services/companies";

/** Like CHIP_BASE, one step up in size for these row chips. */
const ROW_CHIP =
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-sm font-medium";

function ContactRowSkeleton() {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonText width="42%" height={14} />
        <SkeletonText width="58%" height={12} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SkeletonText width={64} height={22} />
        <SkeletonText width={56} height={22} />
      </div>
    </li>
  );
}

export function CompanyContactsSection({
  companyId,
  contacts,
  total,
  ready = true,
}: {
  companyId: string;
  contacts: CompanyContactRow[];
  total: number;
  ready?: boolean;
}) {
  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Contacts</h2>
          <p className="mt-1 text-sm text-text-caption">
            {!ready
              ? "People linked to this company"
              : total === 0
                ? "No contacts linked to this company yet"
                : total === 1
                  ? "1 contact linked to this company"
                  : `${total} contacts linked to this company`}
          </p>
        </div>
        <Link
          to={`/contact/new?companyId=${companyId}`}
          className="text-sm font-medium text-text-link hover:underline"
        >
          + Add contact
        </Link>
      </div>

      {!ready ? (
        <ul
          className="mt-4 divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface"
          aria-busy="true"
          aria-label="Loading contacts"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <ContactRowSkeleton key={index} />
          ))}
        </ul>
      ) : contacts.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border-default bg-surface px-6 py-10 text-center">
          <p className="text-sm text-text-caption">
            Link people to this account from Contacts, or add one here.
          </p>
          <Link
            to={`/contact/new?companyId=${companyId}`}
            className="mt-3 inline-block text-sm font-medium text-text-link hover:underline"
          >
            Create contact
          </Link>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Link
                to={`/contact/${contact.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-subtle/70"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColorFromName(contact.displayName)}`}
                    aria-hidden
                  >
                    {initialsFromName(contact.displayName)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {contact.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-text-caption">
                      {[contact.title, contact.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`${ROW_CHIP} ${TONE_MUTED}`}>
                    {formatContactType(contact.contactType)}
                  </span>
                  <span
                    className={`${ROW_CHIP} ${
                      contact.status === "active" ? TONE_SUCCESS : TONE_MUTED
                    }`}
                  >
                    {formatStatus(contact.status)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
