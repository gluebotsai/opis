import type { LucideIcon } from "lucide-react";
import { PAGE_H1_CLASS, TONE_ACCENT } from "@/lib/ui-tones";

export function MarketingModulePage({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className={PAGE_H1_CLASS}>{title}</h1>
        <p className="mt-1 text-sm text-text-caption">{description}</p>
      </div>
      {children ?? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface px-6 py-16 text-center">
          <span className={`mx-auto inline-flex size-12 items-center justify-center rounded-xl ${TONE_ACCENT}`}>
            <Icon className="size-6" strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-sm font-medium text-text-primary">
            No items yet
          </p>
          <p className="mt-1 text-sm text-text-caption">
            Same Campaign module surface — content appears as you use Marketing.
          </p>
        </div>
      )}
    </div>
  );
}
