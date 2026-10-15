import type { ReactNode } from "react";
import {
  COWORKER_AVATAR_CLASS,
  COWORKER_PANEL_HEADER_CLASS,
} from "@/components/coworker/coworker-layout";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  WORKTUAL_MOBILE_TAB_PILL,
  WORKTUAL_MOBILE_TAB_SHELL,
  WORKTUAL_WORKSPACE_PANEL,
} from "@/lib/worktual-control-tokens";

export function GenericWorkspaceSkeleton() {
  return (
    <div className="h-full w-full px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <SkeletonText width="46%" />
        <Skeleton height={320} borderRadius={12} />
      </div>
    </div>
  );
}

/**
 * Static, side-effect-free copy of AgentModuleShell's default 35/65 frame.
 * Keep the outer layout tokens shared with the real shell.
 */
export function ModuleShellSkeleton({
  title,
  subtitle,
  workspace = <GenericWorkspaceSkeleton />,
}: {
  title: string;
  subtitle?: string;
  workspace?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f3f4f6]">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
        <div className={WORKTUAL_MOBILE_TAB_SHELL}>
          <span className={`${WORKTUAL_MOBILE_TAB_PILL} bg-black text-center text-white`}>
            Chat
          </span>
          <span className={`${WORKTUAL_MOBILE_TAB_PILL} text-center text-neutral-500`}>
            Workspace
          </span>
        </div>

        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-row gap-2 overflow-hidden p-2 max-lg:flex-col sm:gap-3">
          <div className="flex min-h-0 min-w-0 flex-[35] basis-0 flex-col overflow-hidden max-lg:w-full max-lg:max-w-none">
            <div className={WORKTUAL_WORKSPACE_PANEL}>
              <header className={`${COWORKER_PANEL_HEADER_CLASS} justify-between`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={COWORKER_AVATAR_CLASS} aria-hidden>
                    AI
                  </span>
                  <p className="truncate text-[18px] font-semibold text-neutral-900">
                    co-worker
                  </p>
                </div>
                <div className="flex gap-2">
                  <Skeleton height={38} width={38} borderRadius={8} />
                  <Skeleton height={38} width={38} borderRadius={8} />
                </div>
              </header>
              <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-4 py-5">
                <div className="space-y-2">
                  <SkeletonText width="86%" />
                  <SkeletonText width="68%" />
                </div>
                <div className="ml-auto w-2/3">
                  <Skeleton height={42} borderRadius={16} />
                </div>
                <div className="space-y-2">
                  <SkeletonText width="78%" />
                  <SkeletonText width="55%" />
                </div>
              </div>
              <div className="shrink-0 border-t border-[#bfbfbf]/80 p-3">
                <Skeleton height={44} borderRadius={12} />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-[65] basis-0 flex-col overflow-hidden max-lg:hidden">
            <div className={WORKTUAL_WORKSPACE_PANEL}>
              <div
                className={`${COWORKER_PANEL_HEADER_CLASS} ${
                  subtitle
                    ? "h-auto min-h-16 flex-wrap items-center gap-x-2 gap-y-2 py-2.5"
                    : ""
                }`}
              >
                <div className="min-w-0 flex-1 basis-[12rem] leading-tight">
                  <p className="truncate text-[18px] font-semibold text-neutral-900">
                    {title}
                  </p>
                  {subtitle ? (
                    <p className="mt-0.5 truncate text-sm text-neutral-500">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="@container scrollbar-hover flex min-h-0 flex-1 flex-col overflow-auto">
                {workspace}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
