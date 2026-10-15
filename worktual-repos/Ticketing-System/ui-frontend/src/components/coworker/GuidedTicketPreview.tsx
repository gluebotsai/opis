import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Channel, Priority } from '../../types';

export type TicketGuidedStepId =
  | 'customerName'
  | 'contact'
  | 'issue'
  | 'priority'
  | 'confirm';

export type TicketDraft = {
  subject: string;
  description: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  channel: Channel | '';
  priority: Priority | '';
  queue: string;
  assignee: string;
  assigneeId?: string;
  resolver?: string;
  resolverId?: string;
  resolverConfidence?: number | null;
  category?: string;
  skill?: string;
  /** Raw issue text collected in chat before LLM enrich */
  issue: string;
  enrichedByAi?: boolean;
  rationale?: string;
  /** Guided progress: confirm | done after successful file */
  awaiting?: string;
  progressComplete?: boolean;
};

export const emptyTicketDraft = (): TicketDraft => ({
  subject: '',
  description: '',
  customerId: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  channel: '',
  priority: '',
  queue: '',
  assignee: '',
  assigneeId: '',
  resolver: '',
  resolverId: '',
  resolverConfidence: null,
  category: '',
  skill: '',
  issue: '',
  enrichedByAi: false,
  rationale: '',
});

export const TICKET_GUIDED_STEPS: Array<{
  id: TicketGuidedStepId;
  title: string;
  /** Short intent hint for the LLM nextStep — never a canned chat script. */
  prompt: string;
}> = [
  {
    id: 'customerName',
    title: 'Full name',
    prompt: 'existing customer name from the directory',
  },
  {
    id: 'contact',
    title: 'Email or phone',
    prompt: 'email address or phone number',
  },
  {
    id: 'issue',
    title: 'Issue',
    prompt: 'short description of the customer issue',
  },
  {
    id: 'priority',
    title: 'Priority',
    prompt: 'priority (urgent, high, medium, or low)',
  },
  {
    id: 'confirm',
    title: 'Confirm',
    prompt: 'confirm to file, or cancel',
  },
];

export function ticketStepIndex(id: TicketGuidedStepId | string): number {
  const mapped =
    id === 'name' || id === 'customerName'
      ? 'customerName'
      : id === 'customername'
        ? 'customerName'
        : id;
  const idx = TICKET_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

type GuidedTicketPreviewProps = {
  draft: TicketDraft;
  stepIndex: number;
  submitting?: boolean;
  enriching?: boolean;
  onCancel: () => void;
  onConfirmCreate?: () => void;
  onUseForm?: () => void;
};

function draftValue(draft: TicketDraft, id: TicketGuidedStepId): string {
  switch (id) {
    case 'customerName':
      return draft.customerName;
    case 'contact':
      return draft.customerEmail || draft.customerPhone || '';
    case 'issue':
      return draft.issue || draft.description;
    case 'priority':
      return draft.priority || '';
    case 'confirm':
      return 'Ready';
    default:
      return '—';
  }
}

export default function GuidedTicketPreview({
  draft,
  stepIndex,
  submitting = false,
  enriching = false,
  onCancel,
  onConfirmCreate,
  onUseForm,
}: GuidedTicketPreviewProps) {
  const total = TICKET_GUIDED_STEPS.length;
  const hasName = Boolean(draft.customerName.trim());
  const hasContact = Boolean(draft.customerEmail.trim() || draft.customerPhone.trim());
  const hasIssue = Boolean((draft.issue || draft.description).trim());
  const filed =
    String(draft.awaiting || '').toLowerCase() === 'done' ||
    Boolean(draft.progressComplete);
  let displayStep = stepIndex;
  if (filed) {
    displayStep = total;
  } else if (displayStep > 0 && !hasName) displayStep = 0;
  else if (displayStep > 1 && !hasContact) displayStep = 1;
  else if (displayStep > 2 && !hasIssue) displayStep = 2;
  const pct = Math.min(100, Math.round((displayStep / total) * 100));
  const current = TICKET_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = (
    filed ? TICKET_GUIDED_STEPS : TICKET_GUIDED_STEPS.slice(0, displayStep)
  ).filter((s) => {
    if (filed) return true;
    if (s.id === 'customerName') return hasName;
    if (s.id === 'contact') return hasContact;
    if (s.id === 'issue') return hasIssue;
    return Boolean(draftValue(draft, s.id).trim());
  });
  const pending = filed ? [] : TICKET_GUIDED_STEPS.slice(displayStep + 1);
  const title = draft.subject.trim() || draft.customerName.trim() || 'New ticket';
  const canConfirm =
    Boolean(draft.subject.trim()) &&
    Boolean(draft.description.trim()) &&
    Boolean(draft.customerName.trim()) &&
    hasContact &&
    Boolean(draft.channel) &&
    Boolean(draft.priority) &&
    Boolean(draft.queue) &&
    Boolean(draft.assignee);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{title}</h3>
            {(draft.priority || draft.assignee) && (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                {[draft.priority, draft.assignee, draft.queue].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onUseForm && (
              <button
                type="button"
                onClick={onUseForm}
                className="text-xs font-semibold text-neutral-700 hover:text-black underline-offset-2 hover:underline"
              >
                Use form
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
            <span>
              {filed
                ? `Step ${total} of ${total}`
                : `Step ${Math.min(displayStep + 1, total)} of ${total}`}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-black transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            {filed ? 'Filed' : 'Up next'}
          </p>
          {!filed && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              {enriching
                ? 'Generating subject, priority, and assignee from skills…'
                : `Next in chat: ${current.prompt}`}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                {(draft.subject || draft.assignee) && (
                  <dl className="text-xs space-y-1.5 text-neutral-600">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-neutral-400">Subject</dt>
                      <dd className="font-medium text-neutral-900">{draft.subject || '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-neutral-400">Priority</dt>
                      <dd className="font-medium text-neutral-900 capitalize">{draft.priority || '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-neutral-400">Agent</dt>
                      <dd className="font-medium text-neutral-900">{draft.assignee || '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-neutral-400">Resolver</dt>
                      <dd className="font-medium text-neutral-900">
                        {draft.resolver
                          ? `${draft.resolver}${
                              draft.resolverConfidence != null
                                ? ` (${Number(draft.resolverConfidence).toFixed(2)})`
                                : ''
                            }`
                          : 'Needs manual pick'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-neutral-400">Team</dt>
                      <dd className="font-medium text-neutral-900">{draft.queue || '—'}</dd>
                    </div>
                    {draft.rationale && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-neutral-400">Why</dt>
                        <dd className="text-neutral-500">{draft.rationale}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={submitting || enriching || !canConfirm}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {submitting ? 'Filing…' : 'File ticket'}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="h-9 px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
          {!filed && pending.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {pending.map((s) => (
                <li
                  key={s.id}
                  className="text-xs text-neutral-400 px-3 py-2 rounded-lg border border-dashed border-neutral-200"
                >
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        {completed.length > 0 && (
          <section className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Completed</p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-xs text-neutral-500 truncate">{draftValue(draft, s.id) || '—'}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
