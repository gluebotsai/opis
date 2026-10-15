import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { NavCrumb } from "@/lib/nav-hierarchy";
import { withEmbedQuery } from "@/lib/embed-auth";

type Props = {
  crumbs: NavCrumb[];
  parentHref: string | null;
};

/**
 * Shell wayfinding — back + current page title only (no muted ancestor trail).
 * Matches create-draft chat header: ← Title.
 */
export function AppBreadcrumb({ crumbs, parentHref }: Props) {
  if (crumbs.length === 0) return null;

  const current = crumbs[crumbs.length - 1];
  const ancestors = crumbs.slice(0, -1);
  const parentLabel = ancestors[ancestors.length - 1]?.label ?? "Back";
  const backTo = parentHref ? withEmbedQuery(parentHref) : null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2"
    >
      {backTo ? (
        <Link
          to={backTo}
          className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg text-neutral-700 transition hover:bg-neutral-200/60 hover:text-neutral-900"
          aria-label={`Back to ${parentLabel}`}
        >
          <ChevronLeft className="size-[18px]" strokeWidth={2.25} />
        </Link>
      ) : null}

      <h1
        className="min-w-0 truncate text-lg font-semibold tracking-tight text-neutral-900 sm:text-xl"
        aria-current="page"
      >
        {current.label}
      </h1>
    </nav>
  );
}
