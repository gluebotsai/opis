import { Download, X } from "lucide-react";

export function InvoiceReviewModal({
  error,
  eyebrow = "Invoice review",
  fileName,
  invoiceFormat = null,
  invoiceFormatNote = "",
  loading,
  onClose,
  onProceed,
  pdfDataUrl,
  previewTabs = null,
  proceedLabel = "Proceed to finance review",
  showProceed = true,
  title = "Review quotation before finance submission",
}) {
  return (
    <div className="invoice-review-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="invoice-review-overlay__backdrop" onClick={onClose} />

      <div className="invoice-review-modal">
        <header className="invoice-review-modal__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <small>{fileName || "Generating invoice..."}</small>
          </div>
          <button
            aria-label="Close invoice review"
            className="invoice-review-modal__close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        {invoiceFormat ? (
          <div className="invoice-review-modal__format">
            <span>Invoice format</span>
            <div className="invoice-review-modal__format-options">
              <label>
                <input
                  checked={invoiceFormat.value === "consolidated"}
                  name="invoiceFormat"
                  onChange={() => invoiceFormat.onChange("consolidated")}
                  type="radio"
                />
                One combined PDF
              </label>
              <label>
                <input
                  checked={invoiceFormat.value === "per_branch"}
                  name="invoiceFormat"
                  onChange={() => invoiceFormat.onChange("per_branch")}
                  type="radio"
                />
                Separate PDF per location
              </label>
            </div>
          </div>
        ) : null}

        {invoiceFormatNote ? (
          <p className="invoice-review-modal__format-note">{invoiceFormatNote}</p>
        ) : null}

        {previewTabs?.length ? (
          <div className="invoice-review-modal__tabs" role="tablist">
            {previewTabs.map((tab) => (
              <button
                aria-selected={tab.active}
                className={`invoice-review-modal__tab ${tab.active ? "is-active" : ""}`}
                key={tab.id}
                onClick={tab.onSelect}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="invoice-review-modal__body">
          {loading ? (
            <div className="invoice-review-modal__loading">Preparing A4 invoice preview...</div>
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : pdfDataUrl ? (
            <div className="invoice-a4-frame">
              <iframe
                className="invoice-a4-frame__viewer"
                src={pdfDataUrl}
                title="Invoice preview"
              />
            </div>
          ) : null}
        </div>

        <footer className="invoice-review-modal__footer">
          {pdfDataUrl && fileName ? (
            <a className="secondary-button" download={fileName} href={pdfDataUrl}>
              <Download size={16} />
              Download PDF
            </a>
          ) : (
            <span />
          )}
          {showProceed && onProceed ? (
            <button
              className="primary-button"
              disabled={loading || Boolean(error) || !pdfDataUrl}
              onClick={onProceed}
              type="button"
            >
              {proceedLabel}
            </button>
          ) : (
            <button className="primary-button" onClick={onClose} type="button">
              Close
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
