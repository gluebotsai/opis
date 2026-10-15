import { CheckCircle2, X } from "lucide-react";

import { RazorpayLogo, StripeLogo } from "./PaymentProviderLogos.jsx";

export function ApproveQuotationModal({
  companyName,
  loading,
  note,
  paymentProvider,
  onPaymentProviderChange,
  stripeConfigured = false,
  razorpayConfigured = false,
  onCancel,
  onConfirm,
}) {
  const canChooseStripe = stripeConfigured;
  const canChooseRazorpay = razorpayConfigured;

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
              You are approving the quotation for <strong>{companyName}</strong>. Finance will
              notify the sales team, and the invoice will be emailed to the customer from the
              sales account.
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

        <div className="confirm-modal__note approve-payment-provider">
          <span>Payment provider</span>
          <p className="approve-payment-provider__hint">
            Choose how the customer will pay. A payment link will be created with the selected
            provider.
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
          {!canChooseStripe || !canChooseRazorpay ? (
            <p className="approve-payment-provider__warning">
              {!canChooseStripe && !canChooseRazorpay
                ? "No payment providers are configured. Add Stripe or Razorpay keys in the server environment."
                : !canChooseStripe
                  ? "Stripe is not configured on the server."
                  : "Razorpay is not configured on the server."}
            </p>
          ) : null}
        </div>

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
            disabled={loading || (!canChooseStripe && !canChooseRazorpay)}
            onClick={onConfirm}
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
