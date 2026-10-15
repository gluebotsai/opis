import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  ContactPushAppEditFields,
  EMPTY_PUSH_FORM,
  type ContactPushFormValues,
} from "@/components/contacts/ContactPushFields";
import {
  formatContactsApiError,
  saveContactPushFields,
  updateContact,
  type ContactItem,
} from "@/services/contacts.service";
import { validateContactEmailPhone } from "@/lib/contact-validation";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  city: string;
};

function toForm(row: ContactItem): FormState {
  return {
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    companyName: row.company_name ?? "",
    city: row.city ?? "",
  };
}

type Props = {
  contact: ContactItem;
  open: boolean;
  b2c?: boolean;
  onClose: () => void;
  onSaved: (contact: ContactItem) => void;
};

export function ContactManualEditDialog({
  contact,
  open,
  b2c,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(contact));
  const [pushForm, setPushForm] = useState<ContactPushFormValues>(EMPTY_PUSH_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const entity = b2c ? "customer" : "contact";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) next.firstName = "First name is required.";
    const identity = validateContactEmailPhone({
      email: form.email,
      phone: form.phone,
    });
    if (!identity.ok) {
      if (identity.field === "email") next.email = identity.message;
      else if (identity.field === "phone") next.phone = identity.message;
      else {
        next.email = identity.message;
        next.phone = identity.message;
      }
    }
    setFieldErrors(next);
    if (Object.keys(next).length || !identity.ok) return;

    setSaving(true);
    try {
      const result = await updateContact(contact.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        email: identity.email,
        phone: identity.phone,
        companyName: form.companyName.trim() || undefined,
        city: form.city.trim() || undefined,
      });
      let nextContact = result.contact;
      if (pushForm.appPushToken.trim() && nextContact) {
        nextContact = await saveContactPushFields(nextContact, {
          appPushToken: pushForm.appPushToken.trim(),
          appPushPlatform: pushForm.appPushPlatform || "android",
        });
      }
      onSaved(nextContact);
      onClose();
    } catch (err) {
      setFormError(formatContactsApiError(err, `Failed to update ${entity}.`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contact-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#bfbfbf]/80 px-5 py-4">
          <h2
            id="edit-contact-title"
            className="text-base font-semibold text-neutral-900"
          >
            Edit {entity}
          </h2>
          <button
            type="button"
            className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X className="size-[18px]" strokeWidth={2.25} />
          </button>
        </div>
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="First name"
                name="firstName"
                required
                requiredMark
                value={form.firstName}
                error={fieldErrors.firstName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, firstName: e.target.value }))
                }
              />
              <Input
                label="Last name"
                name="lastName"
                value={form.lastName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lastName: e.target.value }))
                }
              />
            </div>
            <Input
              label="Primary email"
              name="email"
              type="email"
              value={form.email}
              error={fieldErrors.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
            <Input
              label="Primary phone"
              name="phone"
              placeholder="+91 98765 43210"
              value={form.phone}
              error={fieldErrors.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: e.target.value }))
              }
            />
            <Input
              label="Company"
              name="companyName"
              value={form.companyName}
              onChange={(e) =>
                setForm((f) => ({ ...f, companyName: e.target.value }))
              }
            />
            <Input
              label="City"
              name="city"
              value={form.city}
              onChange={(e) =>
                setForm((f) => ({ ...f, city: e.target.value }))
              }
            />
            <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-[#f3f4f6]/40 p-3">
              <p className="mb-2 text-xs font-medium text-neutral-500">
                App push (optional)
              </p>
              <ContactPushAppEditFields
                values={pushForm}
                onChange={setPushForm}
              />
            </div>
            {formError ? (
              <p className="text-sm text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
