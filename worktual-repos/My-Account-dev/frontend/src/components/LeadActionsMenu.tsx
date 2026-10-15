// @ts-nocheck
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function getMenuPosition(anchorEl, menuEl) {
  if (!anchorEl) {
    return null;
  }

  const rect = anchorEl.getBoundingClientRect();
  const menuHeight = menuEl?.offsetHeight || 0;
  const menuWidth = menuEl?.offsetWidth || 168;
  const gap = 6;
  const viewportPadding = 8;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const openUpward = menuHeight > 0 && spaceBelow < menuHeight + viewportPadding;

  let top = openUpward ? rect.top - gap - menuHeight : rect.bottom + gap;
  top = Math.max(
    viewportPadding,
    Math.min(top, window.innerHeight - (menuHeight || 0) - viewportPadding),
  );

  let left = rect.right - menuWidth;
  left = Math.max(
    viewportPadding,
    Math.min(left, window.innerWidth - menuWidth - viewportPadding),
  );

  return { top, left };
}

export function LeadActionsMenu({
  anchorEl,
  lead,
  onClose,
  onEditLead,
  onViewAccount,
  onEditProduct,
  onToggleActive,
  onDeleteLead,
}) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    function updatePosition() {
      setPosition(getMenuPosition(anchorEl, menuRef.current));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    function handlePointerDown(event) {
      const target = event.target;
      if (menuRef.current?.contains(target) || anchorEl?.contains?.(target)) {
        return;
      }
      onClose();
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [anchorEl, onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="lead-actions-menu lead-actions-menu--portal"
      ref={menuRef}
      role="menu"
      style={
        position
          ? {
              left: `${position.left}px`,
              top: `${position.top}px`,
            }
          : {
              visibility: "hidden",
            }
      }
    >
      <button
        className="lead-actions-menu__item"
        onClick={(event) => {
          event.stopPropagation();
          onEditLead();
        }}
        role="menuitem"
        type="button"
      >
        Edit customer
      </button>
      <button
        className="lead-actions-menu__item"
        onClick={(event) => {
          event.stopPropagation();
          onViewAccount();
        }}
        role="menuitem"
        type="button"
      >
        View account
      </button>
      <button
        className="lead-actions-menu__item"
        onClick={(event) => {
          event.stopPropagation();
          onEditProduct();
        }}
        role="menuitem"
        type="button"
      >
        Start quote
      </button>
      <button
        className="lead-actions-menu__item"
        onClick={(event) => {
          event.stopPropagation();
          onToggleActive();
        }}
        role="menuitem"
        type="button"
      >
        {lead.isActive !== false ? "Mark inactive" : "Mark active"}
      </button>
      {typeof onDeleteLead === "function" ? (
        <button
          className="lead-actions-menu__item lead-actions-menu__item--danger"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteLead();
          }}
          role="menuitem"
          type="button"
        >
          Delete
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
