import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

export function RemoveProductsModal({ items, onCancel, onConfirm }) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    setSelectedIds([]);
  }, [items]);

  function toggleItem(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function selectAll() {
    setSelectedIds(items.map((item) => item.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  const selectedCount = selectedIds.length;
  const removingAll = selectedCount === items.length;

  return (
    <div
      className="confirm-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Remove products from quote"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={onCancel} />

      <div className="confirm-modal remove-products-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon confirm-modal__icon--remove">
            <Trash2 size={22} />
          </div>
          <div>
            <p className="eyebrow">Manage quote</p>
            <h2>Remove products from this quote?</h2>
            <p className="confirm-modal__copy">
              Select one or more products to remove. Their branch assignment and pricing
              configuration will be discarded.
            </p>
          </div>
          <button
            aria-label="Close remove products dialog"
            className="confirm-modal__close"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="remove-products-modal__toolbar">
          <span>{selectedCount} selected</span>
          <div className="remove-products-modal__toolbar-actions">
            <button className="link-button" onClick={selectAll} type="button">
              Select all
            </button>
            <button className="link-button" disabled={!selectedCount} onClick={clearSelection} type="button">
              Clear
            </button>
          </div>
        </div>

        <ul className="remove-products-modal__list">
          {items.map((item) => {
            const checked = selectedIds.includes(item.id);

            return (
              <li key={item.id}>
                <label className={`remove-products-modal__item ${checked ? "is-selected" : ""}`}>
                  <input
                    checked={checked}
                    onChange={() => toggleItem(item.id)}
                    type="checkbox"
                  />
                  <span className="remove-products-modal__item-copy">
                    <strong>{item.label}</strong>
                    {item.meta ? <small>{item.meta}</small> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {removingAll ? (
          <p className="remove-products-modal__warning">
            Removing all products will return you to product selection.
          </p>
        ) : null}

        <footer className="confirm-modal__footer">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button remove-products-modal__confirm"
            disabled={!selectedCount}
            onClick={() => onConfirm(selectedIds)}
            type="button"
          >
            <Trash2 size={16} />
            Remove {selectedCount || ""} product{selectedCount === 1 ? "" : "s"}
          </button>
        </footer>
      </div>
    </div>
  );
}
