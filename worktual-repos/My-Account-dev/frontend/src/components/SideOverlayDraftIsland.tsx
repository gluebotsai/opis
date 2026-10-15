// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const DRAG_THRESHOLD_PX = 4;
const ISLAND_STACK_GAP_PX = 88;
const DEFAULT_TOP_RATIO = 0.5;
const EDGE_PAD_PX = 8;

/**
 * Shared right-edge draft tab for side overlays (Y-drag, hover peek, resume / discard).
 */
export function SideOverlayDraftIsland({
  badge = null,
  draftKind = "create",
  icon: Icon,
  label,
  stackIndex = 0,
  onOpen,
  onDiscard,
}) {
  const isEditDraft = draftKind === "edit";
  const rootRef = useRef(null);
  const dragState = useRef(null);
  const [topPx, setTopPx] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const badgeLabel = badge != null && badge !== "" ? String(badge) : null;

  useEffect(() => {
    function handlePointerMove(event) {
      const drag = dragState.current;
      if (!drag) {
        return;
      }

      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dy) >= DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setIsDragging(true);
      }
      if (!drag.moved) {
        return;
      }

      const node = rootRef.current;
      const height = node?.offsetHeight || 124;
      const half = height / 2;
      const nextCenterY = Math.min(
        Math.max(EDGE_PAD_PX + half, drag.originCenterY + dy),
        window.innerHeight - EDGE_PAD_PX - half,
      );
      setTopPx(nextCenterY);
    }

    function handlePointerUp() {
      const drag = dragState.current;
      if (!drag) {
        return;
      }
      dragState.current = null;
      setIsDragging(false);
      if (!drag.moved) {
        onOpen?.();
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onOpen]);

  function handlePointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest(".side-overlay-draft-island__discard")) {
      return;
    }
    const node = rootRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    dragState.current = {
      startY: event.clientY,
      originCenterY: rect.top + rect.height / 2,
      moved: false,
    };
    event.preventDefault();
  }

  const style =
    topPx != null
      ? { top: topPx }
      : { top: `calc(${DEFAULT_TOP_RATIO * 100}% + ${stackIndex * ISLAND_STACK_GAP_PX}px)` };

  const resumeHint = badgeLabel
    ? `${isEditDraft ? "Unsaved edit" : "Draft"} step ${badgeLabel}. Drag up or down to move, click to resume.`
    : `${isEditDraft ? "Unsaved edit" : "Draft"}. Drag up or down to move, click to resume.`;

  return (
    <div
      aria-label={`${label}. ${resumeHint}`}
      className={`side-overlay-draft-island${isDragging ? " is-dragging" : ""}`}
      onPointerDown={handlePointerDown}
      ref={rootRef}
      role="status"
      style={style}
    >
      <button
        aria-label={`Resume ${label}${badgeLabel ? `, step ${badgeLabel}` : ""}`}
        className="side-overlay-draft-island__open"
        tabIndex={0}
        title={badgeLabel ? `${label} · Step ${badgeLabel}` : label}
        type="button"
      >
        {Icon ? (
          <span aria-hidden="true" className="side-overlay-draft-island__icon">
            <Icon size={16} />
          </span>
        ) : null}
        {badgeLabel ? (
          <span aria-hidden="true" className="side-overlay-draft-island__badge">
            {badgeLabel}
          </span>
        ) : null}
      </button>
      <button
        aria-label={isEditDraft ? "Discard unsaved edits" : "Discard draft"}
        className="side-overlay-draft-island__discard"
        onClick={(event) => {
          event.stopPropagation();
          onDiscard?.();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
