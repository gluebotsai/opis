// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, X } from "lucide-react";
import { EditableInvoiceSheet } from "./EditableInvoiceSheet.tsx";

function sanitizeDownloadFileName(fileName) {
  const raw = String(fileName || "WIPL-DRAFT").trim();
  const withoutExt = raw.replace(/\.pdf$/i, "");
  const safe = withoutExt.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "WIPL-DRAFT";
  return `${safe}.pdf`;
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || "").split(",");
  if (parts.length < 2) {
    throw new Error("Invalid PDF data URL.");
  }
  const header = parts[0];
  const data = parts.slice(1).join(",");
  const mime = header.match(/:(.*?);/)?.[1] || "application/pdf";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function downloadPdfWithFileName(pdfDataUrl, fileName) {
  const safeName = sanitizeDownloadFileName(fileName);
  const blob = dataUrlToBlob(pdfDataUrl);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = safeName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_500);
}

export function InvoiceReviewModal({
  contentEdit = null,
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
  temporaryInvoiceContents = null,
  title = "Review invoice before finance submission",
}) {
  const [editingSheet, setEditingSheet] = useState(false);
  const [draftSheet, setDraftSheet] = useState(null);
  const [savingSheet, setSavingSheet] = useState(false);
  const [previewObjectUrl, setPreviewObjectUrl] = useState("");

  const downloadName = useMemo(() => sanitizeDownloadFileName(fileName), [fileName]);

  useEffect(() => {
    if (!contentEdit) {
      setEditingSheet(false);
      setDraftSheet(null);
    }
  }, [contentEdit]);

  useEffect(() => {
    if (!editingSheet) {
      return;
    }
    if (!draftSheet && contentEdit?.sheet) {
      setDraftSheet(contentEdit.sheet);
    }
  }, [editingSheet, contentEdit?.sheet, draftSheet]);

  // Chrome ignores <a download> on data: URLs (saves as download.pdf). Use a blob: URL instead.
  useEffect(() => {
    if (!pdfDataUrl) {
      setPreviewObjectUrl("");
      return undefined;
    }
    let objectUrl = "";
    try {
      const blob = dataUrlToBlob(pdfDataUrl);
      const file =
        typeof File !== "undefined"
          ? new File([blob], downloadName, { type: "application/pdf" })
          : blob;
      objectUrl = URL.createObjectURL(file);
      setPreviewObjectUrl(objectUrl);
    } catch {
      setPreviewObjectUrl(pdfDataUrl);
    }
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [pdfDataUrl, downloadName]);

  function openSheetEdit() {
    if (!contentEdit?.sheet) {
      return;
    }
    setDraftSheet(contentEdit.sheet);
    setEditingSheet(true);
  }

  function cancelSheetEdit() {
    setEditingSheet(false);
    setDraftSheet(null);
  }

  async function applySheetEdit() {
    if (!draftSheet || !contentEdit?.onApplySheet) {
      setEditingSheet(false);
      return;
    }
    setSavingSheet(true);
    try {
      await contentEdit.onApplySheet(draftSheet);
      setEditingSheet(false);
      setDraftSheet(null);
    } finally {
      setSavingSheet(false);
    }
  }

  function handleDownloadPdf(event) {
    event.preventDefault();
    if (!pdfDataUrl) {
      return;
    }
    try {
      downloadPdfWithFileName(pdfDataUrl, downloadName);
    } catch {
      // Fallback: open the blob URL if conversion fails.
      if (previewObjectUrl) {
        window.open(previewObjectUrl, "_blank", "noopener,noreferrer");
      }
    }
  }

  const canEditSheet = Boolean(contentEdit?.sheet && contentEdit?.onApplySheet);
  const iframeSrc = previewObjectUrl || pdfDataUrl || "";

  return (
    <div className="invoice-review-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="invoice-review-overlay__backdrop" onClick={onClose} />

      <div className="invoice-review-modal">
        <header className="invoice-review-modal__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <small>{downloadName || "Generating invoice..."}</small>
          </div>
          <div className="invoice-review-modal__header-actions">
            {canEditSheet && !temporaryInvoiceContents ? (
              <button
                aria-label={editingSheet ? "Close invoice editor" : "Edit invoice in preview"}
                aria-pressed={editingSheet}
                className={`icon-button invoice-review-modal__edit-toggle${
                  editingSheet ? " is-active" : ""
                }`}
                disabled={loading || savingSheet}
                onClick={() => (editingSheet ? cancelSheetEdit() : openSheetEdit())}
                type="button"
              >
                <Pencil size={14} />
              </button>
            ) : null}
            <button
              aria-label="Close invoice review"
              className="invoice-review-modal__close"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
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

        {temporaryInvoiceContents ? (
          <div className="invoice-review-modal__format">
            <div className="invoice-review-modal__format-heading">
              <span>Invoice contents</span>
              {canEditSheet ? (
                <button
                  aria-label={editingSheet ? "Close invoice editor" : "Edit invoice in preview"}
                  aria-pressed={editingSheet}
                  className={`icon-button invoice-review-modal__edit-toggle${
                    editingSheet ? " is-active" : ""
                  }`}
                  disabled={loading || savingSheet}
                  onClick={() => (editingSheet ? cancelSheetEdit() : openSheetEdit())}
                  type="button"
                >
                  <Pencil size={14} />
                </button>
              ) : null}
            </div>
            <div className="invoice-review-modal__format-options">
              <label>
                <input
                  checked={temporaryInvoiceContents.value === "implementation"}
                  disabled={editingSheet}
                  name="temporaryInvoiceContents"
                  onChange={() => temporaryInvoiceContents.onChange("implementation")}
                  type="radio"
                />
                Implementation only
              </label>
              <label>
                <input
                  checked={temporaryInvoiceContents.value === "configuration"}
                  disabled={editingSheet}
                  name="temporaryInvoiceContents"
                  onChange={() => temporaryInvoiceContents.onChange("configuration")}
                  type="radio"
                />
                Configuration only
              </label>
              <label>
                <input
                  checked={temporaryInvoiceContents.value === "both"}
                  disabled={editingSheet}
                  name="temporaryInvoiceContents"
                  onChange={() => temporaryInvoiceContents.onChange("both")}
                  type="radio"
                />
                Implementation and configuration
              </label>
              <label>
                <input
                  checked={temporaryInvoiceContents.value === "addon"}
                  disabled={editingSheet}
                  name="temporaryInvoiceContents"
                  onChange={() => temporaryInvoiceContents.onChange("addon")}
                  type="radio"
                />
                Add-on only
              </label>
              <label>
                <input
                  checked={temporaryInvoiceContents.value === "all"}
                  disabled={editingSheet}
                  name="temporaryInvoiceContents"
                  onChange={() => temporaryInvoiceContents.onChange("all")}
                  type="radio"
                />
                All in one
              </label>
            </div>
            <p className="invoice-review-modal__format-note">
              Temporary lead invoices go to finance for approval only — no payment link.
              {canEditSheet
                ? " Click the pencil, then click any text on the invoice to edit it in place. Done refreshes the PDF."
                : ""}
            </p>
          </div>
        ) : null}

        {invoiceFormatNote ? (
          <p className="invoice-review-modal__format-note">{invoiceFormatNote}</p>
        ) : null}

        {previewTabs?.length && !editingSheet ? (
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

        {editingSheet ? (
          <div className="invoice-review-modal__edit-toolbar">
            <p>Click any text on the invoice to edit it. Done updates the PDF.</p>
            <div className="invoice-review-modal__edit-actions">
              <button
                className="secondary-button"
                disabled={savingSheet}
                onClick={cancelSheetEdit}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={savingSheet || !draftSheet}
                onClick={applySheetEdit}
                type="button"
              >
                {savingSheet ? "Updating PDF…" : "Done"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="invoice-review-modal__body">
          {loading ? (
            <div className="invoice-review-modal__loading">Preparing A4 invoice preview...</div>
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : editingSheet && draftSheet ? (
            <div className="invoice-a4-frame invoice-a4-frame--sheet">
              <EditableInvoiceSheet sheet={draftSheet} onChange={setDraftSheet} />
            </div>
          ) : iframeSrc ? (
            <div className="invoice-a4-frame">
              <iframe
                className="invoice-a4-frame__viewer"
                src={iframeSrc}
                title={downloadName || "Invoice preview"}
              />
            </div>
          ) : null}
        </div>

        <footer className="invoice-review-modal__footer">
          {pdfDataUrl && downloadName && !editingSheet ? (
            <button className="secondary-button" onClick={handleDownloadPdf} type="button">
              <Download size={16} />
              Download PDF
            </button>
          ) : (
            <span />
          )}
          {showProceed && onProceed ? (
            <button
              className="primary-button"
              disabled={
                loading ||
                editingSheet ||
                savingSheet ||
                !pdfDataUrl ||
                Boolean(temporaryInvoiceContents && !temporaryInvoiceContents.value)
              }
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
