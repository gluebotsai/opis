import { ArrowUp, Expand, PanelLeftClose, Shrink, X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { CopilotMark } from "@/components/brand/CopilotMark";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { Button, IconButton, buttonClassName } from "@/components/ui/button";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import { useMainFlush } from "@/contexts/main-flush";
import { useSidebarLayout } from "@/contexts/sidebar-layout";
import { useSetPageTitle } from "@/features/layout/page-title-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fitComposerTextarea } from "@/lib/fit-composer-textarea";
import { contentPanelClassName, MEDIA_XL } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

type ExpandedSide = "left" | "right";

type CopilotWorkspacePanelContextValue = {
  expandedSide: ExpandedSide;
  requestExpand: (side: ExpandedSide) => void;
  copilotMinimized: boolean;
  setCopilotMinimized: (minimized: boolean) => void;
};

const CopilotWorkspacePanelContext = createContext<CopilotWorkspacePanelContextValue | null>(
  null,
);

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
    >
      <PanelLeftClose className="size-4" />
    </IconButton>
  );
}

const DRAG_THRESHOLD_PX = 4;
const SIDEBAR_EXPANDED_PX = 260;
const SIDEBAR_COLLAPSED_PX = 72;
const LG_BREAKPOINT_PX = 1024;
/** Inset from the sidebar (or viewport) into the content so the dock is not under Logout. */
const COPILOT_RESTORE_INSET_PX = 16;
/** Distance from viewport bottom to the top of the restore trigger (~63px tall). */
const COPILOT_RESTORE_BOTTOM_OFFSET_PX = 109;

type FloatingPosition = { x: number; y: number };

function sidebarWidthPx(collapsed: boolean): number {
  if (typeof window === "undefined") {
    return collapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_EXPANDED_PX;
  }
  if (window.innerWidth < LG_BREAKPOINT_PX) return 0;
  return collapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_EXPANDED_PX;
}

function defaultCopilotRestorePosition(sidebarCollapsed = false): FloatingPosition {
  const x = sidebarWidthPx(sidebarCollapsed) + COPILOT_RESTORE_INSET_PX;
  if (typeof window === "undefined") {
    return { x, y: 780 };
  }
  return {
    x,
    y: Math.max(16, window.innerHeight - COPILOT_RESTORE_BOTTOM_OFFSET_PX),
  };
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
  const { collapsed: sidebarCollapsed } = useSidebarLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  // Always start at the fixed minimize dock; ignore any previously dragged position.
  const [position, setPosition] = useState<FloatingPosition>(() =>
    defaultCopilotRestorePosition(sidebarCollapsed),
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
      size ? { width: size.width, height: size.height } : { width: 48, height: 48 },
    );
    setPosition(clamped);
    return clamped;
  }, []);

  useEffect(() => {
    function dock() {
      const size = containerRef.current?.getBoundingClientRect();
      setPosition(
        clampCopilotRestorePosition(
          defaultCopilotRestorePosition(sidebarCollapsed),
          size ? { width: size.width, height: size.height } : { width: 48, height: 48 },
        ),
      );
    }

    dock();
    window.addEventListener("resize", dock);
    return () => window.removeEventListener("resize", dock);
  }, [sidebarCollapsed]);

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
    if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
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
      applyPosition({ x: drag.originX + dx, y: drag.originY + dy });
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
        "pointer-events-auto fixed z-50 hidden touch-none flex-col items-start gap-1 select-none xl:flex",
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
            className="absolute -bottom-1 left-3.5 size-1.5 rotate-45 border-r-[0.6px] border-b-[0.6px] border-[#bfbfbf] bg-white"
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
        <CopilotMark className="pointer-events-none" />
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
      className="max-xl:hidden"
      onClick={() => {
        if (ctx.copilotMinimized) {
          ctx.setCopilotMinimized(false);
          return;
        }
        ctx.requestExpand(isExpanded ? oppositeSide : side);
      }}
      aria-label={
        ctx.copilotMinimized ? "Open co-worker" : isExpanded ? "Shrink panel" : "Expand panel"
      }
      title={ctx.copilotMinimized ? "Open co-worker" : isExpanded ? "Shrink panel" : "Expand panel"}
    >
      {isExpanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}
    </IconButton>
  );
}

export function PanelRefreshButton({
  onClick,
  disabled = false,
  refreshing = false,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  refreshing?: boolean;
  className?: string;
}) {
  return (
    <IconButton
      onClick={onClick}
      disabled={disabled || refreshing}
      aria-label="Refresh"
      title="Refresh"
      className={className}
    >
      <RefreshIcon className={cn(refreshing && "animate-spin")} />
    </IconButton>
  );
}

type CopilotWorkspaceProps = {
  title: string;
  subtitle?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  actions?: ReactNode;
  copilot: ReactNode;
  children: ReactNode;
  className?: string;
  /** Put main content in the wide (60%) left column; copilot docks right. */
  contentFirst?: boolean;
  /** Fixed equal-height panels (chat pages). Forms should use false. */
  fillHeight?: boolean;
  expandedSide?: ExpandedSide;
  onExpandedSideChange?: (side: ExpandedSide) => void;
  copilotMinimized?: boolean;
  onCopilotMinimizedChange?: (minimized: boolean) => void;
};

export function CopilotWorkspace({
  title,
  subtitle: _subtitle,
  onCancel,
  cancelLabel = "Cancel",
  actions,
  copilot,
  children,
  className,
  contentFirst = false,
  fillHeight = true,
  expandedSide: expandedSideProp,
  onExpandedSideChange,
  copilotMinimized: copilotMinimizedProp,
  onCopilotMinimizedChange,
}: CopilotWorkspaceProps) {
  useSetPageTitle(title);
  const {
    setFlush,
    copilotMinimized: storedMinimized,
    setCopilotMinimized: setStoredMinimized,
    setCopilotAvailable,
  } = useMainFlush();
  const [internalExpandedSide, setInternalExpandedSide] = useState<ExpandedSide>("left");
  const expandedSide = expandedSideProp ?? internalExpandedSide;
  const copilotMinimized = copilotMinimizedProp ?? storedMinimized;
  const desktopSplit = useMediaQuery(MEDIA_XL);

  useEffect(() => {
    setCopilotAvailable(true);
    return () => setCopilotAvailable(false);
  }, [setCopilotAvailable]);

  useEffect(() => {
    setFlush(copilotMinimized);
    return () => setFlush(false);
  }, [copilotMinimized, setFlush]);

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
        setStoredMinimized(minimized);
      }
      onCopilotMinimizedChange?.(minimized);
    },
    [copilotMinimizedProp, onCopilotMinimizedChange, setStoredMinimized],
  );

  const splitLayout = !contentFirst;
  const gridCols =
    expandedSide === "left"
      ? "xl:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]"
      : "xl:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]";

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
    [splitLayout, expandedSide, handleRequestExpand, copilotMinimized, handleSetCopilotMinimized],
  );

  const hasHeaderActions = Boolean(actions) || Boolean(onCancel);

  return (
    <CopilotWorkspacePanelContext.Provider value={panelContext}>
    <div
      className={cn(
        "flex w-full flex-col gap-3",
        fillHeight && "h-full min-h-0 flex-1",
        className,
      )}
    >
      {hasHeaderActions ? (
        <div className="flex shrink-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-end">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {onCancel ? (
              <Button variant="outline" onClick={onCancel}>
                <X className="size-4" />
                {cancelLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          copilotMinimized || !desktopSplit
            ? "flex h-full min-h-0 flex-1 flex-col"
            : "grid grid-rows-1 items-stretch gap-4",
          desktopSplit && !copilotMinimized && gridCols,
          fillHeight ? "h-full min-h-0 flex-1" : "min-h-[28rem]",
        )}
      >
        {copilotMinimized || !desktopSplit ? (
          <div
            className={cn(
              "relative min-h-0 min-w-0",
              fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&>*]:h-full [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!shadow-none">
              {children}
            </div>
            {!desktopSplit && !copilotMinimized ? (
              <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden bg-white [&>*]:h-full [&>*]:min-h-0">
                {copilot}
              </div>
            ) : null}
            {copilotMinimized ? (
              <CopilotRestoreTrigger onRestore={() => handleSetCopilotMinimized(false)} />
            ) : null}
          </div>
        ) : contentFirst ? (
          <>
            <div
              className={cn(
                "min-h-0 min-w-0",
                fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
              )}
            >
              {children}
            </div>
            <div
              className={cn(fillHeight && "flex h-full min-h-0 flex-col overflow-hidden")}
            >
              {copilot}
            </div>
          </>
        ) : (
          <>
            <div
              className={cn(fillHeight && "flex h-full min-h-0 flex-col overflow-hidden")}
            >
              {copilot}
            </div>
            <div
              className={cn(
                "min-h-0 min-w-0",
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
  children: ReactNode;
  footer: ReactNode;
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  embedded?: boolean;
};

export function CopilotChatShell({
  title = "Your Worktual co-worker",
  onRestart,
  children,
  footer,
  className,
  scrollRef,
  embedded = false,
}: CopilotChatShellProps) {
  const panels = useCopilotWorkspacePanels();
  // Narrow (shrunk) bot column: use full width. Wide/expanded: cap and center content.
  const contentConstrained = panels?.expandedSide === "left";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-white",
        embedded
          ? "rounded-none border-0 shadow-none"
          : contentPanelClassName,
        className,
      )}
    >
      {embedded ? null : (
        <div className="flex items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
          <div className="flex items-center gap-2">
            <CopilotMark />
            <p className="text-[18px] font-semibold">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            {onRestart ? (
              <IconButton onClick={onRestart} aria-label="Restart conversation" title="Restart conversation">
                <RefreshIcon />
              </IconButton>
            ) : null}
            <PanelMinimizeButton />
            <PanelExpandButton side="left" />
          </div>
        </div>
      )}

      <PanelScrollArea ref={scrollRef} className="min-w-0 overflow-x-auto px-4 pt-6 pb-3">
        <div
          className={cn(
            "flex w-full min-w-0 flex-col gap-[30px]",
            contentConstrained && "mx-auto max-w-[798px]",
          )}
        >
          {children}
        </div>
      </PanelScrollArea>
      <div className="relative z-10 shrink-0 bg-white px-4 pt-0 pb-4">
        <div className={cn("w-full", contentConstrained && "mx-auto max-w-[798px]")}>{footer}</div>
      </div>
    </div>
  );
}

type GuidedMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  time?: string;
};

export function GuidedMessageList({ messages }: { messages: GuidedMessage[] }) {
  return (
    <>
      {messages.map((message) =>
        message.role === "assistant" ? (
          <div key={message.id} className="max-w-[90%] min-w-0">
            <div className="break-words [overflow-wrap:anywhere] rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-800">
              {message.content}
            </div>
          </div>
        ) : (
          <div key={message.id} className="ml-auto flex max-w-[85%] min-w-0 flex-col items-end gap-1">
            <div className="break-words [overflow-wrap:anywhere] whitespace-pre-wrap rounded-2xl rounded-tr-md border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 text-sm text-neutral-900">
              {message.content}
            </div>
            {message.time ? (
              <span className="text-[11px] text-neutral-400">{message.time}</span>
            ) : null}
          </div>
        ),
      )}
    </>
  );
}

export const CopilotChatInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    placeholder?: string;
  }
>(function CopilotChatInput(
  {
    value,
    onChange,
    onSubmit,
    disabled,
    placeholder = "Reply to your co-worker…",
  },
  ref,
) {
  const canSend = Boolean(value.trim()) && !disabled;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (textareaRef.current) fitComposerTextarea(textareaRef.current);
  }, [value]);

  return (
    <form
      className="space-y-0"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div
        className={cn(
          "relative flex items-end rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-1.5 transition",
          "focus-within:border-[#bfbfbf] focus-within:bg-white focus-within:shadow-sm focus-within:ring-2 focus-within:ring-neutral-200/70",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={setTextareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="min-h-[2.25rem] min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-3 py-2 text-sm leading-5 text-neutral-900 outline-none placeholder:text-neutral-600"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className={buttonClassName(canSend ? "send" : "sendDisabled", "mb-0.5")}
        >
          <ArrowUp className="size-4 stroke-[2.5]" aria-hidden />
        </button>
      </div>
    </form>
  );
});
