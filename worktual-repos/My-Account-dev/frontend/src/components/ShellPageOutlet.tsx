// @ts-nocheck
import { Suspense } from "react";
import { Outlet } from "react-router-dom";

/** Compact fallback inside the shell content area (sidebar stays mounted). */
export function PageChunkFallback() {
  return (
    <div className="route-loading route-loading--page" role="status" aria-live="polite">
      <span className="route-loading__spinner" aria-hidden="true" />
      Loading…
    </div>
  );
}

export function ShellPageOutlet() {
  return (
    <Suspense fallback={<PageChunkFallback />}>
      <Outlet />
    </Suspense>
  );
}

/** Prefer Outlet when used as a layout route; keep children for legacy wrappers. */
export function shellPageContent(children) {
  return children ?? <ShellPageOutlet />;
}
