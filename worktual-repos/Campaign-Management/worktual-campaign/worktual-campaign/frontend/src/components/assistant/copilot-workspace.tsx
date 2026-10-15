import {
  Expand,
  MessageSquarePlus,
  PanelLeftClose,
  RefreshCw,
  Shrink,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CopilotMark } from "@/components/brand/CopilotMark";
import { IconButton } from "@/components/ui/IconButton";
import { PanelScrollArea } from "@/components/ui/PanelScrollArea";
import { useSidebarLayout } from "@/contexts/sidebar-layout";
import { cn } from "@/utils/cn";

type ExpandedSide = "left" | "right";

type CopilotWorkspacePanelContextValue = {
  expandedSide: ExpandedSide;
  requestExpand: (side: ExpandedSide) => void;
  copilotMinimized: boolean;
  setCopilotMinimized: (minimized: boolean) => void;
};

const CopilotWorkspacePanelContext =
  createContext<CopilotWorkspacePanelContextValue | null>(null);

export function useCopilotWorkspacePanels() {
  return useContext(CopilotWorkspacePanelContext);
}

export function PanelMinimizeButton() {
  const ctx = useCopilotWorkspacePanels();
  if (!ctx) return null;

  return (
    <IconButton
      onClick={() => ctx.setCopilotMinimized(true)}
      aria-label="Minimize co-worker"
      title="Minimize co-worker"
      className="size-[38px] [&_svg]:size-[18px]"
    >
      <PanelLeftClose strokeWidth={2.25} />
    </IconButton>
  );
}

const COPILOT_RESTORE_POSITION_KEY = "worktual.campaign.copilotRestorePosition";
const DRAG_THRESHOLD_PX = 4;

type FloatingPosition = { x: number; y: number };

function defaultCopilotRestorePosition(): FloatingPosition {
  if (typeof window === "undefined") return { x: 16, y: 16 };
  return { x: 16, y: Math.max(16, window.innerHeight - 72) };
}

function readCopilotRestorePosition(): FloatingPosition {
  if (typeof window === "undefined") return defaultCopilotRestorePosition();
  try {
    const raw = window.localStorage.getItem(COPILOT_RESTORE_POSITION_KEY);
    if (!raw) return defaultCopilotRestorePosition();
    const parsed = JSON.parse(raw) as Partial<FloatingPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return defaultCopilotRestorePosition();
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return defaultCopilotRestorePosition();
  }
}

function clampCopilotRestorePosition(
  position: FloatingPosition,
  size: { width: number; height: number },
): FloatingPosition {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - size.width - margin);
  const maxY = Math.max(margin, window.innerHeight - size.height - margin);
  return {
    x: Math.min(Math.max(margin, position.x), maxX),
    y: Math.min(Math.max(margin, position.y), maxY),
  };
}

function CopilotRestoreTrigger({ onRestore }: { onRestore: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [position, setPosition] = useState<FloatingPosition>(
    readCopilotRestorePosition,
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const applyPosition = useCallback((next: FloatingPosition) => {
    const size = containerRef.current?.getBoundingClientRect();
    const clamped = clampCopilotRestorePosition(
      next,
      size
        ? { width: size.width, height: size.height }
        : { width: 48, height: 48 },
    );
    setPosition(clamped);
    return clamped;
  }, []);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => {
        const size = containerRef.current?.getBoundingClientRect();
        return clampCopilotRestorePosition(
          current,
          size
            ? { width: size.width, height: size.height }
            : { width: 48, height: 48 },
        );
      });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (
      !drag.moved &&
      (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
    ) {
      drag.moved = true;
      setIsDragging(true);
      containerRef.current?.setPointerCapture(event.pointerId);
    }
    if (!drag.moved) return;

    applyPosition({ x: drag.originX + dx, y: drag.originY + dy });
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    if (drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const clamped = applyPosition({
        x: drag.originX + dx,
        y: drag.originY + dy,
      });
      window.localStorage.setItem(
        COPILOT_RESTORE_POSITION_KEY,
        JSON.stringify(clamped),
      );
    }

    drag.active = false;
    drag.moved = false;
    setIsDragging(false);
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function handleTriggerPointerUp(_event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current.moved && dragRef.current.active) {
      onRestore();
    }
  }

  function dismissPrompt(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPromptDismissed(true);
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-auto fixed z-50 flex touch-none flex-col items-start gap-1 select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{ left: position.x, top: position.y }}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {!promptDismissed ? (
        <div className="relative ml-0.5">
          <button
            type="button"
            onClick={dismissPrompt}
            className="absolute -top-1.5 -left-1.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-neutral-700 text-white shadow-sm transition hover:bg-neutral-800"
            aria-label="Dismiss co-worker prompt"
          >
            <X className="size-2.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => onRestore()}
            className="relative block cursor-pointer rounded-lg bg-white px-2 py-1 text-[11px] font-medium leading-none text-neutral-900 shadow-md transition hover:bg-neutral-50"
          >
            Co-worker
          </button>
          <span
            aria-hidden
            className="absolute -bottom-1 left-3.5 size-1.5 rotate-45 border-r border-b border-neutral-200 bg-white"
          />
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handleTriggerPointerUp}
        className="cursor-pointer rounded-md shadow-md transition hover:scale-105 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
        aria-label="Open co-worker"
        title="Open co-worker"
      >
        <CopilotMark className="pointer-events-none size-10 rounded-md" />
      </button>
    </div>
  );
}

export function PanelExpandButton({ side }: { side: ExpandedSide }) {
  const ctx = useCopilotWorkspacePanels();
  if (!ctx) return null;

  const isExpanded = ctx.expandedSide === side;
  const oppositeSide: ExpandedSide = side === "left" ? "right" : "left";

  return (
    <IconButton
      onClick={() => {
        if (ctx.copilotMinimized) {
          ctx.setCopilotMinimized(false);
          return;
        }
        ctx.requestExpand(isExpanded ? oppositeSide : side);
      }}
      aria-label={
        ctx.copilotMinimized
          ? "Open co-worker"
          : isExpanded
            ? "Shrink panel"
            : "Expand panel"
      }
      title={
        ctx.copilotMinimized
          ? "Open co-worker"
          : isExpanded
            ? "Shrink panel"
            : "Expand panel"
      }
      className="size-[38px] [&_svg]:size-[18px]"
    >
      {isExpanded ? (
        <Shrink strokeWidth={2.25} />
      ) : (
        <Expand strokeWidth={2.25} />
      )}
    </IconButton>
  );
}

type CopilotWorkspaceProps = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  copilot: ReactNode;
  children: ReactNode;
  className?: string;
  /** Put main content in the wide left column; copilot docks right. */
  contentFirst?: boolean;
  fillHeight?: boolean;
  /** When false, skip max-w-7xl centering (module splits). Default true. */
  constrainWidth?: boolean;
  expandedSide?: ExpandedSide;
  onExpandedSideChange?: (side: ExpandedSide) => void;
  copilotMinimized?: boolean;
  onCopilotMinimizedChange?: (minimized: boolean) => void;
};

export function CopilotWorkspace({
  actions,
  copilot,
  children,
  className,
  contentFirst = false,
  fillHeight = true,
  constrainWidth = true,
  expandedSide: expandedSideProp,
  onExpandedSideChange,
  copilotMinimized: copilotMinimizedProp,
  onCopilotMinimizedChange,
}: CopilotWorkspaceProps) {
  const { collapsed: sidebarCollapsed } = useSidebarLayout();
  const [internalExpandedSide, setInternalExpandedSide] =
    useState<ExpandedSide>("left");
  const [internalCopilotMinimized, setInternalCopilotMinimized] =
    useState(false);
  const expandedSide = expandedSideProp ?? internalExpandedSide;
  const copilotMinimized = copilotMinimizedProp ?? internalCopilotMinimized;

  const handleRequestExpand = useCallback(
    (side: ExpandedSide) => {
      if (expandedSideProp === undefined) {
        setInternalExpandedSide(side);
      }
      onExpandedSideChange?.(side);
    },
    [expandedSideProp, onExpandedSideChange],
  );

  const handleSetCopilotMinimized = useCallback(
    (minimized: boolean) => {
      if (copilotMinimizedProp === undefined) {
        setInternalCopilotMinimized(minimized);
      }
      onCopilotMinimizedChange?.(minimized);
    },
    [copilotMinimizedProp, onCopilotMinimizedChange],
  );

  const splitLayout = !contentFirst;
  const gridCols =
    expandedSide === "left"
      ? "lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]"
      : "lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]";

  const panelContext = useMemo<CopilotWorkspacePanelContextValue | null>(
    () =>
      splitLayout
        ? {
            expandedSide,
            requestExpand: handleRequestExpand,
            copilotMinimized,
            setCopilotMinimized: handleSetCopilotMinimized,
          }
        : null,
    [
      splitLayout,
      expandedSide,
      handleRequestExpand,
      copilotMinimized,
      handleSetCopilotMinimized,
    ],
  );

  return (
    <CopilotWorkspacePanelContext.Provider value={panelContext}>
      <div
        className={cn(
          "flex w-full flex-col gap-3",
          fillHeight && "h-full min-h-0 flex-1",
          constrainWidth &&
            (sidebarCollapsed ? "max-w-none" : "mx-auto max-w-7xl"),
          className,
        )}
      >
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}

        <div
          className={cn(
            copilotMinimized
              ? "flex h-full min-h-0 flex-1 flex-col"
              : "grid grid-rows-1 items-stretch gap-3",
            !copilotMinimized && gridCols,
            fillHeight ? "h-full min-h-0 flex-1" : "min-h-[28rem]",
          )}
        >
          {copilotMinimized ? (
            <div
              className={cn(
                "relative min-h-0 min-w-0",
                fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
              )}
            >
              {children}
              <CopilotRestoreTrigger
                onRestore={() => handleSetCopilotMinimized(false)}
              />
            </div>
          ) : contentFirst ? (
            <>
              <div
                className={cn(
                  "min-h-0 min-w-0 w-full",
                  fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
                )}
              >
                {children}
              </div>
              <div
                className={cn(
                  fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
                )}
              >
                {copilot}
              </div>
            </>
          ) : (
            <>
              <div
                className={cn(
                  fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
                )}
              >
                {copilot}
              </div>
              <div
                className={cn(
                  "min-h-0 min-w-0 w-full",
                  fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
                )}
              >
                {children}
              </div>
            </>
          )}
        </div>
      </div>
    </CopilotWorkspacePanelContext.Provider>
  );
}

type CopilotChatShellProps = {
  title?: string;
  onRestart?: () => void;
  /** Icon for onRestart — default new chat; Audience uses refresh look only. */
  onRestartIcon?: "new-chat" | "refresh";
  children: ReactNode;
  /** When set, children scroll and footer stays pinned (composer). */
  footer?: ReactNode;
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  headerActions?: ReactNode;
};

export function CopilotChatShell({
  title = "Your Worktual co-worker",
  onRestart,
  onRestartIcon = "new-chat",
  children,
  footer,
  className,
  scrollRef,
  headerActions,
}: CopilotChatShellProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none",
        className,
      )}
    >
      <div className="flex min-h-[62px] shrink-0 items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf]/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <CopilotMark className="size-8 rounded-md" />
          <p className="truncate text-lg font-semibold text-neutral-900">
            {title}
          </p>
        </div>
        <div className="flex h-[38px] items-center gap-0.5">
          {headerActions}
          {onRestart ? (
            <IconButton
              onClick={onRestart}
              aria-label="New chat"
              title="New chat"
              className="size-[38px] [&_svg]:size-[18px]"
            >
              {onRestartIcon === "refresh" ? (
                <RefreshCw strokeWidth={2.25} />
              ) : (
                <MessageSquarePlus strokeWidth={2.25} />
              )}
            </IconButton>
          ) : null}
          <PanelMinimizeButton />
          <PanelExpandButton side="left" />
        </div>
      </div>

      {footer !== undefined ? (
        <>
          {scrollRef ? (
            <PanelScrollArea ref={scrollRef} className="px-4 py-4">
              <div className="flex flex-col gap-3">{children}</div>
            </PanelScrollArea>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
          )}
          <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf]/80 bg-white px-4 py-2.5">
            {footer}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

type ContentPanelShellProps = {
  title?: string;
  children: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  /** When false, panel height follows content (create-campaign overview). */
  fillHeight?: boolean;
};

/** Right-side content card chrome (list / detail / overview). */
export function ContentPanelShell({
  title,
  children,
  headerActions,
  className,
  fillHeight = true,
}: ContentPanelShellProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none",
        fillHeight
          ? "h-full min-h-0"
          : "h-auto max-h-full self-start",
        className,
      )}
    >
      {title || headerActions ? (
        <div className="flex min-h-[62px] shrink-0 items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf]/80 bg-white px-4 py-3">
          {title ? (
            <p className="truncate text-lg font-semibold text-neutral-900">
              {title}
            </p>
          ) : (
            <span />
          )}
          <div className="flex h-[38px] items-center gap-1">
            {headerActions}
            <PanelExpandButton side="right" />
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          // Stretch children to full panel width — items-start collapses
          // width to content and stacks overview text in a 1-char column.
          "flex w-full min-w-0 flex-col items-stretch overflow-x-hidden",
          fillHeight
            ? "min-h-0 flex-1 overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        {children}
      </div>
    </div>
  );
}
