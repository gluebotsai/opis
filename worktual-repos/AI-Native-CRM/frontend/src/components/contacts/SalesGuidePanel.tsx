import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import {
  AddNoteDialog,
  ScheduleMeetingDialog,
  SmsSendDialog,
} from "@/components/contacts/ContactQuickActions";
import { ConvertLeadButton } from "@/components/contacts/ConvertLeadButton";
import { placeOutboundCall } from "@/features/voice/sip-ua";
import type { BusinessType } from "@/config/modules";
import { createContactActivity } from "@/services/contacts";
import {
  acceptSalesTask,
  fetchSalesGuide,
  type SalesGuideCtaKind,
  type SalesGuideView,
} from "@/services/salesGuide";

const ACTION_LABEL: Record<SalesGuideCtaKind, string> = {
  email: "Draft email",
  call: "Call",
  meeting: "Schedule meeting",
  sms: "SMS",
  task: "Create task",
  note: "Log note",
  quote: "Create quote",
  proposal: "Create proposal",
  deal: "Create deal",
  view_deal: "View deal",
  order: "New order",
};

const guideCache = new Map<string, SalesGuideView>();

function cachedGuide(contactId: string): SalesGuideView | null {
  const cached = guideCache.get(contactId);
  if (!cached?.action || !cached.suggestions?.length || !cached.nextBestAction) return null;
  return cached;
}

export function SalesGuidePanel({
  contactId,
  displayName,
  email,
  phone,
  companyName,
  leadStatus,
  businessType,
  onChanged,
}: {
  contactId: string;
  displayName: string;
  email: string;
  phone: string | null;
  companyName?: string | null;
  leadStatus?: string | null;
  businessType: BusinessType;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [guide, setGuide] = useState<SalesGuideView | null>(
    () => cachedGuide(contactId),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cachedGuide(contactId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState({ task: false, note: false });
  const [composer, setComposer] = useState<"email" | "meeting" | "sms" | "note" | "deal" | null>(
    null,
  );
  const started = useRef({ task: false, note: false });

  useEffect(() => {
    let cancelled = false;
    const cached = cachedGuide(contactId);
    if (cached) {
      setGuide(cached);
      setLoading(false);
    }
    void fetchSalesGuide(contactId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        if (!cachedGuide(contactId)) setError(result.error);
        return;
      }
      setError(null);
      guideCache.set(contactId, result);
      setGuide(result);
      const accepted = result.accepted;
      if (accepted?.task) started.current.task = true;
      if (accepted?.note) started.current.note = true;
      setDone({
        task: Boolean(accepted?.task),
        note: Boolean(accepted?.note),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function onAction() {
    if (!guide) return;
    const action = guide.action;
    setNotice(null);
    if (action.kind === "email") {
      setComposer("email");
      return;
    }
    if (action.kind === "call") {
      if (!phone) {
        setNotice("This contact has no phone number.");
        return;
      }
      void placeOutboundCall(phone, undefined, displayName);
      return;
    }
    if (action.kind === "meeting") {
      setComposer("meeting");
      return;
    }
    if (action.kind === "sms") {
      setComposer("sms");
      return;
    }
    if (action.kind === "note") {
      setComposer("note");
      return;
    }
    if (action.kind === "deal") {
      setComposer("deal");
      return;
    }
    if (action.kind === "quote" && action.dealId) {
      navigate(`/sales/quotes/new?dealId=${encodeURIComponent(action.dealId)}`);
      return;
    }
    if (action.kind === "proposal" && action.dealId) {
      navigate(`/sales/${encodeURIComponent(action.dealId)}?tab=proposals`);
      return;
    }
    if (action.kind === "view_deal" && action.dealId) {
      navigate(`/sales/${encodeURIComponent(action.dealId)}`);
      return;
    }
    if (action.kind === "order") {
      navigate(`/commerce?contactId=${encodeURIComponent(contactId)}`);
      return;
    }
    if (action.kind !== "task" || started.current.task) return;
    started.current.task = true;
    setDone((current) => ({ ...current, task: true }));
    setBusy(true);
    const result = await acceptSalesTask(contactId, guide.nextBestAction);
    setBusy(false);
    if (!result.ok) {
      started.current.task = false;
      setDone((current) => ({ ...current, task: false }));
      setNotice(result.error);
      return;
    }
    setNotice("Task created.");
    onChanged?.();
  }

  const action = guide?.action;
  const label = action ? ACTION_LABEL[action.kind] ?? "Continue" : "";
  const finished =
    (action?.kind === "task" && done.task) || (action?.kind === "note" && done.note);

  return (
    <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
        <Sparkles className="size-4 text-brand" strokeWidth={2} />
        Sales guide
      </h2>
      {loading && !guide ? (
        <p className="mt-3 text-sm text-text-caption">Reading the latest interactions…</p>
      ) : error && !guide ? (
        <p className="mt-3 text-sm text-text-caption">{error}</p>
      ) : guide && action ? (
        <div className="mt-4 space-y-5">
          <div>
            <p className="text-sm font-bold text-text-primary">Suggestions</p>
            <ul className="mt-2 space-y-2">
              {guide.suggestions.map((line) => (
                <li key={line} className="text-sm leading-6 text-text-primary">
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-bold text-text-primary">Next best action</p>
            <p className="mt-1 text-sm font-medium text-text-primary">
              {guide.nextBestAction.title}
            </p>
            <p className="mt-1 text-sm leading-6 text-text-primary">
              {guide.nextBestAction.detail}
            </p>
            {finished ? null : (
              <Button
                type="button"
                variant="primary"
                className="mt-3 h-8 text-xs"
                disabled={busy}
                onClick={() => void onAction()}
              >
                {busy ? "Working…" : label}
              </Button>
            )}
          </div>
          {notice ? <p className="text-sm text-text-caption">{notice}</p> : null}
        </div>
      ) : null}

      {composer === "email" && action ? (
        <EmailComposeDialog
          initialContact={{ id: contactId, displayName, email, phone }}
          initialTo={email}
          initialSubject={action.subject}
          initialMessage={action.message}
          onClose={() => setComposer(null)}
          onSent={onChanged}
        />
      ) : null}
      {composer === "meeting" ? (
        <ScheduleMeetingDialog
          contactId={contactId}
          displayName={displayName}
          email={email}
          onClose={() => setComposer(null)}
          onChanged={onChanged}
        />
      ) : null}
      {composer === "sms" && action ? (
        <SmsSendDialog
          displayName={displayName}
          phone={phone}
          initialMessage={action.message}
          onClose={() => setComposer(null)}
          onConfirmSent={async (body) => {
            const result = await createContactActivity(contactId, {
              type: "sms",
              subject: action.subject || `SMS to ${displayName}`,
              body,
            });
            if (result.ok) onChanged?.();
            return result.ok ? { ok: true } : { ok: false, error: result.error };
          }}
        />
      ) : null}
      {composer === "note" ? (
        <AddNoteDialog
          contactId={contactId}
          displayName={displayName}
          onClose={() => setComposer(null)}
          onChanged={onChanged}
        />
      ) : null}
      {composer === "deal" ? (
        <ConvertLeadButton
          contactId={contactId}
          contactName={displayName}
          companyName={companyName ?? undefined}
          leadStatus={leadStatus}
          businessType={businessType}
          opened
          hideButton
          onDismiss={() => setComposer(null)}
        />
      ) : null}
    </section>
  );
}
