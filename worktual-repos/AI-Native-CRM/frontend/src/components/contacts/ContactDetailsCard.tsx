import { useState } from "react";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import { placeOutboundCall } from "@/features/voice/sip-ua";
import { ContactMultiValueField } from "@/components/contacts/ContactMultiValueField";
import { Button } from "@/components/ui/Button";
import type { ComposeContactOption } from "@/components/email/types";

export function ContactDetailsCard({
  contactId,
  displayName,
  email,
  phone,
  secondaryEmails,
  secondaryPhones,
  title,
  addressLine,
  city,
  country,
  ownerLabel,
  stacked = false,
}: {
  contactId: string;
  displayName: string;
  email: string;
  phone: string | null;
  secondaryEmails: string[];
  secondaryPhones: string[];
  title: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  ownerLabel: string | null;
  /** Single-column layout for narrow side rails. */
  stacked?: boolean;
}) {
  const contact: ComposeContactOption = {
    id: contactId,
    displayName,
    email,
    phone,
  };

  const [composeTo, setComposeTo] = useState<string | null>(null);
  const [confirmPhone, setConfirmPhone] = useState<string | null>(null);

  return (
    <>
      <section
        className={`rounded-xl border border-border-default bg-surface ${stacked ? "p-4" : "p-6"}`}
      >
        <h2 className="text-base font-semibold text-text-primary">
          Contact details
        </h2>
        <dl
          className={`mt-5 grid gap-4 ${stacked ? "grid-cols-1" : "sm:grid-cols-2"}`}
        >
          <InteractiveField
            label="Email"
            value={email}
            kind="email"
            onActivate={() => setComposeTo(email)}
          />
          <InteractiveField
            label="Phone"
            value={phone}
            kind="phone"
            onCallRequest={(value) => setConfirmPhone(value)}
          />
          <ContactMultiValueField
            className={stacked ? undefined : "sm:col-span-2"}
            label="Secondary emails"
            values={secondaryEmails}
            kind="email"
            onActivate={(value) => setComposeTo(value)}
          />
          <ContactMultiValueField
            className={stacked ? undefined : "sm:col-span-2"}
            label="Secondary phones"
            values={secondaryPhones}
            kind="phone"
            onCallRequest={(value) => setConfirmPhone(value)}
          />
          <PlainField label="Job title" value={title} />
          <PlainField label="City" value={city} />
          <PlainField label="Country" value={country} />
          <PlainField label="Address" value={addressLine} />
          <PlainField label="Owner" value={ownerLabel} />
        </dl>
      </section>

      {composeTo ? (
        <EmailComposeDialog
          initialContact={contact}
          initialTo={composeTo}
          onClose={() => setComposeTo(null)}
        />
      ) : null}

      {confirmPhone ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-confirm-title"
          onClick={() => setConfirmPhone(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="call-confirm-title"
              className="text-base font-semibold text-text-primary"
            >
              Confirm call
            </h3>
            <p className="mt-2 text-sm text-text-secondary">
              Please confirm that you would like to call{" "}
              <span className="font-medium text-text-primary">{confirmPhone}</span>.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmPhone(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const phoneToCall = confirmPhone;
                  setConfirmPhone(null);
                  void placeOutboundCall(phoneToCall, undefined, displayName);
                }}
              >
                Call
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PlainField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
        {value || "—"}
      </dd>
    </div>
  );
}

function InteractiveField({
  label,
  value,
  kind,
  onActivate,
  onCallRequest,
}: {
  label: string;
  value: string | null | undefined;
  kind: "email" | "phone";
  onActivate?: () => void;
  onCallRequest?: (value: string) => void;
}) {
  const text = value?.trim() || "";
  if (!text) {
    return <PlainField label={label} value={null} />;
  }

  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm">
        {kind === "email" ? (
          <button
            type="button"
            className="text-left break-all font-medium text-text-primary hover:text-text-link hover:underline"
            onClick={onActivate}
            title="Compose email"
          >
            {text}
          </button>
        ) : (
          <button
            type="button"
            className="text-left break-all font-medium text-text-primary hover:text-text-link"
            title="Click to call"
            onClick={() => onCallRequest?.(text)}
          >
            {text}
          </button>
        )}
      </dd>
    </div>
  );
}
