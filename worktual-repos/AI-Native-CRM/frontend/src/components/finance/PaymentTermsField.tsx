import { Select } from "@/components/ui/Select";
import {
  normalizePaymentTerms,
  PAYMENT_TERMS_OPTIONS,
} from "@/lib/invoice-payment-terms";

export function PaymentTermsField({
  value,
  onChange,
  disabled,
  required,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <Select
        label="Payment terms"
        required={required}
        disabled={disabled}
        error={error}
        value={normalizePaymentTerms(value)}
        options={PAYMENT_TERMS_OPTIONS}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-text-caption">
        When the customer should pay after the invoice date (printed on the
        invoice). Put billing periods or other notes in Notes instead.
      </p>
    </div>
  );
}
