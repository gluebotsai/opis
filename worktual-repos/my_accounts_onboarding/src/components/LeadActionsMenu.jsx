import { useEffect, useRef } from "react";

export function LeadActionsMenu({
  lead,
  onClose,
  onEditLead,
  onViewAccount,
  onEditProduct,
  onToggleActive,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
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
  }, [onClose]);

  return (
    <div className="lead-actions-menu" ref={menuRef}>
      <button
        className="lead-actions-menu__item"
        onClick={(event) => {
          event.stopPropagation();
          onEditLead();
        }}
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
        type="button"
      >
        {lead.isActive !== false ? "Mark inactive" : "Mark active"}
      </button>
    </div>
  );
}
