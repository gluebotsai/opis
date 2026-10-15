import type { LucideIcon } from "lucide-react";

/**
 * Module page body. Page title lives in the global header (CCaaS LAYOUTS §1);
 * optional description only — avoid duplicating a large in-content h1.
 */
export function ModulePage({
  title: _title,
  description,
  icon: Icon,
  children,
  showDescription = true,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children?: React.ReactNode;
  showDescription?: boolean;
}) {
  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      {showDescription && description ? (
        <p className="mb-5 text-sm text-neutral-500">{description}</p>
      ) : null}
      {children ?? (
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-16 text-center shadow-sm">
          <span className="mx-auto inline-flex size-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
            <Icon className="size-6" strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-sm font-medium text-neutral-900">
            No items yet
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            This module is ready — content will appear here as you use Campaign.
          </p>
        </div>
      )}
    </div>
  );
}
