// @ts-nocheck
import { useEffect, useRef } from "react";
import { formatInvoiceSheetPeriodLine, recalculateInvoiceSheetTotals } from "../lib/invoice.js";

function formatSheetMoney(currency, amount) {
  const value = Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "INR" ? `Rs. ${value}` : `${currency} ${value}`;
}

function formatTaxPercent(rate) {
  const pct = Number(rate) * 100;
  if (!Number.isFinite(pct)) {
    return "0";
  }
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
}

function linesToText(lines) {
  return (lines || []).join("\n");
}

function textToLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || index < all.length - 1);
}

function openNativeDatePicker(input) {
  if (!input) {
    return;
  }
  input.focus();
  try {
    input.showPicker?.();
  } catch {
    // showPicker can throw if not triggered by a user gesture in some browsers.
  }
}

/** Docs-style inline text: looks like static copy until focused. */
function InlineEdit({
  value,
  onCommit,
  ariaLabel,
  multiline = false,
  className = "",
  placeholder = "",
  as: Tag = "span",
}) {
  const ref = useRef(null);
  const display = value == null ? "" : String(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (document.activeElement === el) {
      return;
    }
    if (el.textContent !== display) {
      el.textContent = display;
    }
  }, [display]);

  function commit() {
    const el = ref.current;
    if (!el) {
      return;
    }
    const next = multiline ? el.innerText : el.textContent;
    onCommit?.(String(next ?? "").replace(/\u00a0/g, " "));
  }

  return (
    <Tag
      ref={ref}
      aria-label={ariaLabel}
      className={`invoice-inline-edit${multiline ? " invoice-inline-edit--multiline" : ""} ${className}`.trim()}
      contentEditable
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(event) => {
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text);
      }}
      role="textbox"
      suppressContentEditableWarning
      tabIndex={0}
    />
  );
}

function InvoiceDateField({ label, value, onChange, ariaLabel }) {
  const inputRef = useRef(null);

  return (
    <div
      className="invoice-sheet__date-field"
      onClick={() => openNativeDatePicker(inputRef.current)}
      role="group"
    >
      {label ? <span className="invoice-sheet__date-label">{label}</span> : null}
      <input
        ref={inputRef}
        aria-label={ariaLabel || label}
        onChange={(event) => onChange?.(event.target.value)}
        type="date"
        value={String(value || "").slice(0, 10)}
      />
    </div>
  );
}

/**
 * In-preview editable A4 invoice sheet (regular + Temporary Lead).
 * Click text to edit in place; Done in the modal regenerates the PDF.
 */
export function EditableInvoiceSheet({ sheet, onChange }) {
  if (!sheet) {
    return null;
  }

  const model = recalculateInvoiceSheetTotals(sheet);
  const currency = model.currency || "INR";

  function patch(next) {
    const merged = { ...model, ...next };
    // The PDF renders the billing period via the "Delivery Timeline" text, not the raw
    // periodStartIso/periodEndIso fields, so keep it in sync when the period is edited.
    const periodEdited = "periodStartIso" in next || "periodEndIso" in next;
    if (periodEdited) {
      const periodLine = formatInvoiceSheetPeriodLine(merged.periodStartIso, merged.periodEndIso);
      if (periodLine) {
        merged.deliveryLines = [periodLine];
      }
    }
    onChange?.(recalculateInvoiceSheetTotals(merged));
  }

  function patchSeller(field, value) {
    patch({ seller: { ...model.seller, [field]: value } });
  }

  function patchCustomer(field, value) {
    patch({ customer: { ...model.customer, [field]: value } });
  }

  function patchRow(rowId, field, value) {
    const rows = (model.rows || []).map((row) => {
      if (row.id !== rowId) {
        return row;
      }
      const next = { ...row, [field]: value };
      if (field === "unitPrice" || field === "qty") {
        const qty = Math.max(Number(next.qty) || 0, 0);
        const unitPrice = Number(next.unitPrice) || 0;
        next.subtotal = Math.round(unitPrice * qty * 100) / 100;
        next.netAmount = next.subtotal;
      }
      if (field === "netAmount") {
        next.netAmount = Number(value) || 0;
      }
      return next;
    });
    patch({ rows });
  }

  function patchBank(field, value) {
    patch({
      bankDetails: {
        ...(model.bankDetails || {
          accountName: "",
          bankName: "",
          accountNumber: "",
          ifsc: "",
          branch: "",
        }),
        [field]: value,
      },
    });
  }

  const bank = model.bankDetails || {
    accountName: "",
    bankName: "",
    accountNumber: "",
    ifsc: "",
    branch: "",
  };

  return (
    <article className="invoice-sheet invoice-sheet--editable" aria-label="Editable invoice">
      <header className="invoice-sheet__header">
        <div className="invoice-sheet__seller">
          <InlineEdit
            ariaLabel="Seller name"
            as="strong"
            className="invoice-inline-edit--title"
            onCommit={(value) => patchSeller("name", value)}
            value={model.seller?.name}
          />
          <InlineEdit
            ariaLabel="Seller tagline"
            onCommit={(value) => patchSeller("tagline", value)}
            value={model.seller?.tagline}
          />
          <InlineEdit
            ariaLabel="Seller address"
            multiline
            onCommit={(value) => patchSeller("address", value)}
            value={model.seller?.address}
          />
          <span className="invoice-sheet__seller-meta">
            <span>
              Seller {model.seller?.taxFieldLabel || "GST"}:
              <InlineEdit
                ariaLabel="Seller tax number"
                onCommit={(value) => patchSeller("taxNumber", value)}
                value={model.seller?.taxNumber}
              />
            </span>
            <span>
              Phone:{" "}
              <InlineEdit
                ariaLabel="Seller phone"
                onCommit={(value) => patchSeller("phone", value)}
                value={model.seller?.phone}
              />
            </span>
            <span>
              Email:{" "}
              <InlineEdit
                ariaLabel="Seller email"
                onCommit={(value) => patchSeller("email", value)}
                value={model.seller?.email}
              />
            </span>
            <span>
              Website:{" "}
              <InlineEdit
                ariaLabel="Seller website"
                onCommit={(value) => patchSeller("website", value)}
                value={model.seller?.website}
              />
            </span>
          </span>
        </div>
        <div className="invoice-sheet__meta">
          <div className="invoice-sheet__meta-row">
            <span>Invoice #:</span>
            <InlineEdit
              ariaLabel="Invoice number"
              onCommit={(value) => patch({ invoiceNumber: value })}
              value={model.invoiceNumber}
            />
          </div>
          <div className="invoice-sheet__meta-row">
            <span>Date:</span>
            <InvoiceDateField
              ariaLabel="Invoice date"
              onChange={(value) => patch({ invoiceDateIso: value })}
              value={model.invoiceDateIso}
            />
          </div>
        </div>
      </header>

      <section className="invoice-sheet__parties invoice-sheet__parties--customer-only">
        <div>
          <p className="invoice-sheet__section-label">Customer details</p>
          <InlineEdit
            ariaLabel="Customer company"
            as="strong"
            className="invoice-inline-edit--title"
            onCommit={(value) => patchCustomer("companyName", value)}
            placeholder="Company name"
            value={model.customer?.companyName}
          />
          <p className="invoice-sheet__muted">Bill to:</p>
          <InlineEdit
            ariaLabel="Billing address"
            multiline
            onCommit={(value) => patchCustomer("address", value)}
            placeholder="Billing address"
            value={model.customer?.address}
          />
          <InlineEdit
            ariaLabel="Customer country"
            onCommit={(value) => patchCustomer("country", value)}
            placeholder="Country"
            value={model.customer?.country}
          />
          <span className="invoice-sheet__tax-line">
            Buyer {model.customer?.taxFieldLabel || "Tax"}:{" "}
            <InlineEdit
              ariaLabel="Customer tax number"
              onCommit={(value) => patchCustomer("taxNumber", value)}
              value={model.customer?.taxNumber}
            />
          </span>
        </div>
      </section>

      <div className="invoice-sheet__period">
        <InvoiceDateField
          ariaLabel="Period start"
          label="Period start"
          onChange={(value) => patch({ periodStartIso: value })}
          value={model.periodStartIso}
        />
        <InvoiceDateField
          ariaLabel="Period end"
          label="Period end"
          onChange={(value) => patch({ periodEndIso: value })}
          value={model.periodEndIso}
        />
      </div>

      <table className="invoice-sheet__items">
        <thead>
          <tr>
            <th>Solution</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {(model.rows || []).length ? (
            (model.rows || []).map((row) => (
              <tr key={row.id}>
                <td>
                  <InlineEdit
                    ariaLabel="Line solution"
                    multiline
                    onCommit={(value) => patchRow(row.id, "product", value)}
                    value={row.product}
                  />
                </td>
                <td>
                  <InlineEdit
                    ariaLabel="Line description"
                    multiline
                    onCommit={(value) => patchRow(row.id, "description", value)}
                    value={row.description}
                  />
                </td>
                <td className="invoice-sheet__cell--center">
                  <InlineEdit
                    ariaLabel="Line quantity"
                    onCommit={(value) => patchRow(row.id, "qty", value)}
                    value={row.qty}
                  />
                </td>
                <td className="invoice-sheet__cell--right">
                  <InlineEdit
                    ariaLabel="Line unit price"
                    onCommit={(value) => patchRow(row.id, "unitPrice", value)}
                    value={row.unitPrice}
                  />
                </td>
                <td className="invoice-sheet__cell--right">
                  {formatSheetMoney(currency, row.netAmount ?? row.subtotal)}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="invoice-sheet__empty-row">
                No line items — click Done after adding amounts in Set pricing, or edit here once
                rows exist.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="invoice-sheet__totals">
        <div className="invoice-sheet__words">
          <p>
            <strong>Amount in words:</strong> {model.amountInWords}
          </p>
        </div>
        <dl className="invoice-sheet__summary">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatSheetMoney(currency, model.subtotal)}</dd>
          </div>
          {model.gstMode === "vat" ? (
            Number(model.taxRate) > 0 ? (
              <div>
                <dt>
                  @ {formatTaxPercent(model.taxRate)}% {model.taxLabel || "VAT"}
                </dt>
                <dd>{formatSheetMoney(currency, model.vat)}</dd>
              </div>
            ) : null
          ) : model.gstMode === "inter" ? (
            <div>
              <dt>@ {formatTaxPercent(model.taxRate ?? 0.18)}% IGST</dt>
              <dd>{formatSheetMoney(currency, model.igst)}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>@ {formatTaxPercent((model.taxRate ?? 0.18) / 2)}% CGST</dt>
                <dd>{formatSheetMoney(currency, model.cgst)}</dd>
              </div>
              <div>
                <dt>@ {formatTaxPercent((model.taxRate ?? 0.18) / 2)}% SGST</dt>
                <dd>{formatSheetMoney(currency, model.sgst)}</dd>
              </div>
            </>
          )}
          <div className="invoice-sheet__summary-total">
            <dt>Total Amount</dt>
            <dd>{formatSheetMoney(currency, model.grandTotal)}</dd>
          </div>
        </dl>
      </section>

      <section className="invoice-sheet__bank-note">
        <div className="invoice-sheet__bank">
          <strong>Bank details</strong>
          <p>
            Account name:{" "}
            <InlineEdit
              ariaLabel="Account name"
              onCommit={(value) => patchBank("accountName", value)}
              value={bank.accountName}
            />
          </p>
          <p>
            Bank:{" "}
            <InlineEdit
              ariaLabel="Bank name"
              onCommit={(value) => patchBank("bankName", value)}
              value={bank.bankName}
            />
          </p>
          <p>
            Account number:{" "}
            <InlineEdit
              ariaLabel="Account number"
              onCommit={(value) => patchBank("accountNumber", value)}
              value={bank.accountNumber}
            />
          </p>
          <p>
            IFSC:{" "}
            <InlineEdit
              ariaLabel="IFSC"
              onCommit={(value) => patchBank("ifsc", value)}
              value={bank.ifsc}
            />
          </p>
          <p>
            Branch:{" "}
            <InlineEdit
              ariaLabel="Branch"
              onCommit={(value) => patchBank("branch", value)}
              value={bank.branch}
            />
          </p>
        </div>
        <div className="invoice-sheet__note">
          <InlineEdit
            ariaLabel="Legal company name"
            as="strong"
            onCommit={(value) => patchSeller("legalName", value)}
            value={model.seller?.legalName || "WORKTUAL INNOVATIONS PRIVATE LIMITED"}
          />
          <p className="invoice-sheet__note-text">
            This is computer generated invoice and does not require signature.
          </p>
        </div>
      </section>

      <section className="invoice-sheet__footers">
        <div>
          <p className="invoice-sheet__section-label">Terms &amp; Conditions</p>
          <InlineEdit
            ariaLabel="Terms and conditions"
            multiline
            onCommit={(value) => patch({ termsLines: textToLines(value) })}
            value={linesToText(model.termsLines)}
          />
        </div>
        <div>
          <p className="invoice-sheet__section-label">Payment Terms</p>
          <InlineEdit
            ariaLabel="Payment terms"
            multiline
            onCommit={(value) => patch({ paymentLines: textToLines(value) })}
            value={linesToText(model.paymentLines)}
          />
        </div>
        <div>
          <p className="invoice-sheet__section-label">Delivery Timeline</p>
          <InlineEdit
            ariaLabel="Delivery timeline"
            multiline
            onCommit={(value) => patch({ deliveryLines: textToLines(value) })}
            value={linesToText(model.deliveryLines)}
          />
        </div>
      </section>
    </article>
  );
}

export { openNativeDatePicker };
