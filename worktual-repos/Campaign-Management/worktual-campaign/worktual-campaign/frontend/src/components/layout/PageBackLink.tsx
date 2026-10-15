import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  getNavCrumbs,
  getParentHref,
  type NavLabels,
} from "@/lib/nav-hierarchy";
import { withEmbedQuery } from "@/lib/embed-auth";

type Props = {
  /** Override parent href (in-pane Back that still changes URL). */
  href?: string | null;
  label?: string;
  onClick?: () => void;
  className?: string;
  labels?: NavLabels;
};

function useTreeParent(labels?: NavLabels) {
  const location = useLocation();
  const from = new URLSearchParams(location.search).get("from");
  const entryHref = (
    location.state as { listHref?: string } | null
  )?.listHref;
  const input = {
    pathname: location.pathname,
    search: location.search,
    from,
    entryHref,
    labels,
  };
  return {
    href: getParentHref(input),
    crumbs: getNavCrumbs(input),
  };
}

const defaultClass =
  "inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary";

/**
 * One-level Up control. Uses IA parent, not history.back().
 */
export function PageBackLink({
  href,
  label,
  onClick,
  className = defaultClass,
  labels,
}: Props) {
  const tree = useTreeParent(labels);
  const target = href ?? tree.href;
  const text =
    label ||
    (tree.crumbs.length >= 2
      ? tree.crumbs[tree.crumbs.length - 2].label
      : "Back");

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {text}
      </button>
    );
  }

  if (!target) return null;

  return (
    <Link to={withEmbedQuery(target)} className={className}>
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      {text}
    </Link>
  );
}
