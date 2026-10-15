import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Mail, Phone, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ContactChatBar } from "@/components/contacts/ContactChatBar";
import { ContentFadeIn } from "@/components/skeleton";
import {
  contactDisplayName,
  formatContactAddedOn,
  formatContactsApiError,
  getContact,
  saveContactPushFields,
  updateContact,
  type ContactItem,
} from "@/services/contacts.service";
import { validateContactEmailPhone } from "@/lib/contact-validation";
import { ContactDetailSkeleton } from "@/pages/ContactDetailSkeleton";
import {
  ContactPushAppEditFields,
  ContactPushRegistered,
  EMPTY_PUSH_FORM,
  type ContactPushFormValues,
} from "@/components/contacts/ContactPushFields";
import { ContactCampaignActivityPanel } from "@/components/contacts/ContactCampaignActivityPanel";

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

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value?: string | null;
  icon?: LucideIcon;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-caption">
        {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1 text-sm text-text-primary">{value?.trim() || "—"}</p>
    </div>
  );
}

export function ContactDetailPage() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [contact, setContact] = useState<ContactItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pushForm, setPushForm] = useState<ContactPushFormValues>(EMPTY_PUSH_FORM);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    try {
      const match = await getContact(contactId);
      setContact(match);
    } catch (err) {
      setContact(null);
      setError(formatContactsApiError(err, "Failed to load contact"));
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const state = location.state as { contactsRefresh?: boolean } | null;
    if (state?.contactsRefresh) {
      void load();
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, load, navigate]);

  const openContactChat = (text: string) => {
    if (!contactId || !contact) return;
    const sessionId = crypto.randomUUID();
    navigate(`/audience/chat/${sessionId}`, {
      state: {
        initialMessage: text,
        focusContactId: contactId,
        focusContactName: contactDisplayName(contact),
        focusContactEmail: contact.email || undefined,
        skipWelcome: true,
        listHref: `/audience/${contactId}`,
      },
    });
  };

  const openEdit = () => {
    if (!contact) return;
    setForm(toForm(contact));
    setPushForm(EMPTY_PUSH_FORM);
    setFormError(null);
    setFieldErrors({});
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditOpen(false);
    setFormError(null);
    setFieldErrors({});
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!contact || !form) return;
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
      let next = result.contact;
      const hasPush = Boolean(pushForm.appPushToken.trim());
      if (hasPush && next) {
        next = await saveContactPushFields(next, {
          appPushToken: pushForm.appPushToken.trim() || undefined,
          appPushPlatform: pushForm.appPushPlatform || "android",
        });
      }
      setContact(next);
      setEditOpen(false);
      setToast(result.message || "Contact updated successfully");
      window.setTimeout(() => setToast(null), 3200);
    } catch (err) {
      setFormError(formatContactsApiError(err, "Failed to update contact."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ContactDetailSkeleton />;
  }

  if (error || !contact) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/audience"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          All audience
        </Link>
        <p className="mt-6 text-sm text-text-danger">
          {error || "Contact not found."}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => navigate("/audience")}
        >
          Back to audience
        </Button>
      </div>
    );
  }

  const name = contactDisplayName(contact);

  return (
    <ContentFadeIn className="min-h-full bg-subtle/40 px-4 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-28">
      <Link
        to="/audience"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        All audience
      </Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {name}
          </h1>
          {contact.company_name ? (
            <p className="mt-1 text-sm text-text-secondary">
              {contact.company_name}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-text-caption">
            Added On {formatContactAddedOn(contact.created_at)}
          </p>
        </div>
        <Button type="button" variant="brand" onClick={openEdit}>
          Edit
        </Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none">
          <h2 className="text-sm font-semibold text-text-primary">
            Contact details
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Email" value={contact.email} icon={Mail} />
            <Field label="Phone" value={contact.phone} icon={Phone} />
            <Field label="City" value={contact.city} />
            <Field label="Added on" value={formatContactAddedOn(contact.created_at)} />
          </div>
        </section>

        <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none">
          <h2 className="text-sm font-semibold text-text-primary">
            Company details
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={contact.company_name} />
            <Field label="Location" value={contact.city} />
          </div>
        </section>

        <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none lg:col-span-2">
          <h2 className="text-sm font-semibold text-text-primary">
            App / Web push
          </h2>
          <div className="mt-4">
            <ContactPushRegistered
              appPush={contact.app_push}
              webPush={contact.web_push}
            />
          </div>
        </section>

        {contactId ? (
          <ContactCampaignActivityPanel
            contactId={contactId}
            active={Boolean(contact)}
            engagement={contact.campaign_engagement ?? null}
            className="lg:col-span-2"
          />
        ) : null}
      </div>

      {toast ? (
        <div
          className="fixed top-4 right-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-white shadow-lg"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-white"
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Success</p>
            <p className="mt-0.5 text-sm text-neutral-300">{toast}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      {editOpen && form ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-contact-title"
            className="w-full max-w-md rounded-2xl border border-border-default bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
              <h2
                id="edit-contact-title"
                className="text-base font-semibold text-text-primary"
              >
                Update contact
              </h2>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
                onClick={closeEdit}
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-4 px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="First name"
                  name="firstName"
                  required
                  requiredMark
                  value={form.firstName}
                  error={fieldErrors.firstName}
                  onChange={(e) =>
                    setForm((f) =>
                      f ? { ...f, firstName: e.target.value } : f,
                    )
                  }
                />
                <Input
                  label="Last name"
                  name="lastName"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((f) =>
                      f ? { ...f, lastName: e.target.value } : f,
                    )
                  }
                />
              </div>
              <Input
                label="Email"
                name="email"
                type="email"
                required
                requiredMark
                value={form.email}
                error={fieldErrors.email}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, email: e.target.value } : f))
                }
              />
              <Input
                label="Phone"
                name="phone"
                required
                requiredMark
                placeholder="+91 98765 43210"
                value={form.phone}
                error={fieldErrors.phone}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, phone: e.target.value } : f))
                }
              />
              <Input
                label="Company"
                name="companyName"
                value={form.companyName}
                onChange={(e) =>
                  setForm((f) =>
                    f ? { ...f, companyName: e.target.value } : f,
                  )
                }
              />
              <Input
                label="City"
                name="city"
                value={form.city}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, city: e.target.value } : f))
                }
              />
              <div className="rounded-xl border border-border-default bg-subtle p-3">
                <p className="mb-2 text-xs font-medium text-text-caption">
                  App push
                </p>
                <ContactPushAppEditFields
                  values={pushForm}
                  onChange={setPushForm}
                />
              </div>
              {formError ? (
                <p className="text-sm text-text-danger" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeEdit}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="brand" disabled={saving}>
                  {saving ? "Saving…" : "Update contact"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ContactChatBar placeholder="Ask" onSend={openContactChat} />
    </ContentFadeIn>
  );
}
