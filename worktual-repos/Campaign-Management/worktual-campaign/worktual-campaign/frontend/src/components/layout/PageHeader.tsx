import type { ReactNode } from "react";

type PageHeaderProps = {
  /** Omit when AppShell breadcrumb already names the page. */
  title?: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Standard list/workspace page header — description + meta + actions only.
 * Wayfinding lives in AppShell (breadcrumb); avoid duplicate back links / H1s.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className = "",
}: PageHeaderProps) {
  const hasLead = Boolean(title || description || meta);

  if (!hasLead && !actions) return null;

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-border-default bg-surface px-4 py-3 sm:px-6 ${className}`.trim()}
    >
      {hasLead ? (
        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">
              {title}
            </h1>
          ) : null}
          {description ? (
            <p
              className={`max-w-2xl text-sm text-text-secondary ${title ? "mt-1" : ""}`}
            >
              {description}
            </p>
          ) : null}
          {meta ? (
            <div
              className={`text-xs text-text-caption ${title || description ? "mt-2" : ""}`}
            >
              {meta}
            </div>
          ) : null}
        </div>
      ) : null}
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
