// @ts-nocheck
import { CheckCircle2, X } from "lucide-react";

import { RazorpayLogo, StripeLogo } from "./PaymentProviderLogos.tsx";

export function ApproveQuotationModal({
  companyName,
  loading,
  note,
  paymentProvider,
  onPaymentProviderChange,
  stripeConfigured = false,
  razorpayConfigured = false,
  paymentPolicy = null,
  isResellerLead = false,
  isTemporaryLead = false,
  paymentRecipientEmail = "",
  paymentRecipientCc = [],
  onCancel,
  onConfirm,
}) {
  const isOffline = !isTemporaryLead && paymentPolicy?.mode === "offline";
  const isZeroValue = !isTemporaryLead && paymentPolicy?.mode === "zero";
  const allowedProviders = paymentPolicy?.allowedProviders || ["stripe", "razorpay"];
  const canChooseStripe =
    !isTemporaryLead &&
    !isOffline &&
    !isZeroValue &&
    stripeConfigured &&
    allowedProviders.includes("stripe");
  const canChooseRazorpay =
    !isTemporaryLead &&
    !isOffline &&
    !isZeroValue &&
    razorpayConfigured &&
    allowedProviders.includes("razorpay");
  const canConfirm =
    isTemporaryLead || isOffline || isZeroValue || canChooseStripe || canChooseRazorpay;

  return (
    <div
      className="confirm-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm quotation approval"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={onCancel} />

      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon confirm-modal__icon--approve">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <p className="eyebrow">Confirm approval</p>
            <h2>Approve this quotation?</h2>
            <p className="confirm-modal__copy">
              You are approving the quotation for <strong>{companyName}</strong>.
              {isTemporaryLead ? (
                <>
                  {" "}
                  This is a temporary lead — approval is for record only. No payment link will be
                  created and the customer will not be emailed a payment link.
                </>
              ) : isZeroValue ? (
                <>
                  {" "}
                  This is a zero-value invoice — no payment link will be created. Approval marks it
                  paid, fulfills products, and sends the welcome/login email.
                </>
              ) : isOffline ? (
                <>
                  {" "}
                  Online payment links are not available for this invoice amount. The approved
                  invoice will be emailed with offline payment instructions.
                </>
              ) : isResellerLead ? (
                <>
                  {" "}
                  A payment link will be created and the approved invoice will be emailed to the
                  reseller
                  {paymentRecipientEmail ? (
                    <>
                      {" "}
                      at <strong>{paymentRecipientEmail}</strong>
                    </>
                  ) : null}
                  . The end customer will not receive billing emails.
                </>
              ) : (
                <>
                  {" "}
                  Finance will notify the sales team, and the invoice will be emailed to the
                  customer from the sales account.
                </>
              )}
            </p>
          </div>
          <button
            aria-label="Close approval confirmation"
            className="confirm-modal__close"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        {isTemporaryLead ? (
          <div className="confirm-modal__note approve-payment-provider">
            <span>Payment method</span>
            <p className="approve-payment-provider__hint">
              Finance approval only. Stripe and Razorpay are skipped for temporary leads.
            </p>
          </div>
        ) : isZeroValue ? (
          <div className="confirm-modal__note approve-payment-provider">
            <span>Payment method</span>
            <p className="approve-payment-provider__hint">
              No payment due. Stripe and Razorpay are skipped for zero-value invoices.
            </p>
            {paymentPolicy?.reason ? (
              <p className="approve-payment-provider__warning">{paymentPolicy.reason}</p>
            ) : null}
          </div>
        ) : isOffline ? (
          <div className="confirm-modal__note approve-payment-provider">
            <span>Payment method</span>
            <p className="approve-payment-provider__hint">
              Offline payment only. Stripe and Razorpay are disabled because the invoice amount
              exceeds ₹25,00,000.
            </p>
            {paymentPolicy?.reason ? (
              <p className="approve-payment-provider__warning">{paymentPolicy.reason}</p>
            ) : null}
          </div>
        ) : (
          <div className="confirm-modal__note approve-payment-provider">
            <span>Payment provider</span>
            <p className="approve-payment-provider__hint">
              Choose how {isResellerLead ? "the reseller" : "the customer"} will pay. A payment link
              will be created with the selected provider and included in the approval email.
            </p>
            <div
              className="approve-payment-provider__options"
              role="radiogroup"
              aria-label="Payment provider"
            >
              <button
                aria-checked={paymentProvider === "stripe"}
                aria-label="Stripe"
                className={`approve-payment-provider__option approve-payment-provider__option--stripe ${
                  paymentProvider === "stripe" ? "is-selected" : ""
                }`}
                disabled={loading || !canChooseStripe}
                onClick={() => onPaymentProviderChange("stripe")}
                role="radio"
                type="button"
              >
                <StripeLogo className="approve-payment-provider__logo approve-payment-provider__logo--stripe" />
              </button>
              <button
                aria-checked={paymentProvider === "razorpay"}
                aria-label="Razorpay"
                className={`approve-payment-provider__option approve-payment-provider__option--razorpay ${
                  paymentProvider === "razorpay" ? "is-selected" : ""
                }`}
                disabled={loading || !canChooseRazorpay}
                onClick={() => onPaymentProviderChange("razorpay")}
                role="radio"
                type="button"
              >
                <RazorpayLogo className="approve-payment-provider__logo approve-payment-provider__logo--razorpay" />
              </button>
            </div>
            {paymentPolicy?.reason ? (
              <p className="approve-payment-provider__warning">{paymentPolicy.reason}</p>
            ) : !canChooseStripe || !canChooseRazorpay ? (
              <p className="approve-payment-provider__warning">
                {!canChooseStripe && !canChooseRazorpay
                  ? "No payment providers are configured. Add Stripe or Razorpay keys in the server environment."
                  : !canChooseStripe
                    ? "Stripe is not configured on the server."
                    : "Razorpay is not configured on the server."}
              </p>
            ) : null}
          </div>
        )}

        {isResellerLead && !isTemporaryLead && !isZeroValue && paymentRecipientEmail ? (
          <div className="confirm-modal__note">
            <span>Payment email recipient</span>
            <p>
              <strong>{paymentRecipientEmail}</strong>
              {paymentRecipientCc.length
                ? ` (CC: ${paymentRecipientCc.join(", ")})`
                : ""}
            </p>
          </div>
        ) : null}

        {note?.trim() ? (
          <div className="confirm-modal__note">
            <span>Your note</span>
            <p>{note.trim()}</p>
          </div>
        ) : null}

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={loading} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="confirm-modal__approve"
            disabled={loading || !canConfirm}
            onClick={() => onConfirm()}
            type="button"
          >
            <CheckCircle2 size={18} />
            {loading ? "Approving..." : "Confirm approval"}
          </button>
        </footer>
      </div>
    </div>
  );
}
