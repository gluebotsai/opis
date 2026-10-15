import { EmbedBlankScreen } from "@/components/embed/EmbedBlankScreen";
import { isEmbedMode } from "@/lib/embed-auth";

/**
 * Auth bootstrap placeholder — AppShell chrome only.
 * Embed mode: blank CRM-matched background (no skeleton — CRM overlay hides iframe).
 */
export function AuthBootstrapSkeleton() {
  if (isEmbedMode()) return <EmbedBlankScreen />;

  return (
    <div
      className="flex min-h-screen bg-subtle"
      aria-busy="true"
      aria-label="Loading"
    >
      <aside className="hidden w-56 shrink-0 border-r border-border-default bg-surface lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border-default px-4">
          <div className="h-7 w-7 animate-pulse rounded-md bg-neutral-200" />
          <div className="h-3.5 w-22 animate-pulse rounded bg-neutral-200" />
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-full animate-pulse rounded-lg bg-neutral-200"
            />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-default bg-surface px-4">
          <div className="h-7 w-7 animate-pulse rounded-md bg-neutral-200 lg:hidden" />
          <div className="h-3.5 w-35 animate-pulse rounded bg-neutral-200" />
          <div className="ml-auto flex gap-2">
            <div className="size-8 animate-pulse rounded-full bg-neutral-200" />
            <div className="size-8 animate-pulse rounded-full bg-neutral-200" />
          </div>
        </header>
        <main className="min-h-0 flex-1 bg-[#f3f4f6]" />
      </div>
    </div>
  );
}
