import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  Circle,
  Equal,
  Plus,
  PlusCircle,
  Tag,
  Trash2,
} from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import CoworkerSplitWorkspace from './coworker/CoworkerSplitWorkspace';
import { llmOnlyReply } from './coworker/llmGuidedReply';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import GuidedDeletePreview, {
  type PendingDelete,
} from './coworker/GuidedDeletePreview';

type OrgPriority = {
  id: string;
  priority: string;
  displayName: string;
  resolutionHours: number;
  firstResponseHours: number;
  isSystem: boolean;
  sortOrder: number;
  active: boolean;
};

type OrgTicketStatus = {
  id: string;
  status: string;
  displayName: string;
  isSystem: boolean;
  isTerminal: boolean;
  sortOrder: number;
  active: boolean;
};

interface PrioritiesViewProps {
  embedded?: boolean;
  startCreateIntent?: boolean;
  startCreateStep?: string | null;
  /** priority (default) | status — which catalog create to start from chat. */
  startCreateKind?: 'priority' | 'status' | null;
  startCreateSeed?: {
    label?: string;
    hours?: string | number;
    step?: string;
    kind?: 'priority' | 'status';
  } | null;
  onConsumeCreateIntent?: () => void;
  listRefreshToken?: number;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string) => void;
}

type GuidedPriorityStep = 'name' | 'hours' | 'confirm';
type GuidedStatusStep = 'name' | 'confirm';
type GuidedCreate =
  | { kind: 'priority'; step: GuidedPriorityStep }
  | { kind: 'status'; step: GuidedStatusStep };

const PRIORITY_GUIDED_STEPS: Array<{
  id: GuidedPriorityStep;
  title: string;
  prompt: string;
}> = [
  { id: 'name', title: 'Label', prompt: 'what to call this priority' },
  { id: 'hours', title: 'SLA hours', prompt: 'breach hours (e.g. 4, 8, 24)' },
  { id: 'confirm', title: 'Confirm', prompt: 'confirm to save, or cancel' },
];

const STATUS_GUIDED_STEPS: Array<{
  id: GuidedStatusStep;
  title: string;
  prompt: string;
}> = [
  { id: 'name', title: 'Label', prompt: 'what to call this status' },
  { id: 'confirm', title: 'Confirm', prompt: 'confirm to save, or cancel' },
];

function priorityStepIndex(id: string): number {
  const mapped =
    id === 'displayname' || id === 'label' || id === 'display_name'
      ? 'name'
      : id === 'resolutionhours' || id === 'resolution_hours'
        ? 'hours'
        : id;
  const idx = PRIORITY_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

function statusStepIndex(id: string): number {
  const mapped =
    id === 'displayname' || id === 'label' || id === 'display_name' ? 'name' : id;
  const idx = STATUS_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

function GuidedPriorityPreview({
  draft,
  stepIndex,
  saving = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { label: string; hours: string };
  stepIndex: number;
  saving?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = PRIORITY_GUIDED_STEPS.length;
  const hasName = Boolean(draft.label.trim());
  const hasHours =
    Number.isFinite(Number(draft.hours)) && Number(draft.hours) > 0;
  let displayStep = stepIndex;
  if (displayStep > 0 && !hasName) displayStep = 0;
  else if (displayStep > 1 && !hasHours) displayStep = 1;
  const pct = Math.round((displayStep / total) * 100);
  const current = PRIORITY_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = PRIORITY_GUIDED_STEPS.slice(0, displayStep).filter((s) => {
    if (s.id === 'name') return hasName;
    if (s.id === 'hours') return hasHours;
    return true;
  });
  const pending = PRIORITY_GUIDED_STEPS.slice(displayStep + 1);
  const canSave = hasName && hasHours;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating priority with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">
              {draft.label.trim() || 'New priority'}
            </h3>
            {hasHours ? (
              <p className="text-xs text-neutral-500 mt-0.5">{draft.hours} hours</p>
            ) : null}
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
              Step {Math.min(displayStep + 1, total)} of {total}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full bg-black transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            Up next
          </p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Label</dt>
                    <dd className="font-medium text-neutral-900">
                      {draft.label || '—'}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Hours</dt>
                    <dd className="font-medium text-neutral-900">
                      {draft.hours || '—'}
                    </dd>
                  </div>
                </dl>
                {onConfirmCreate && (
                  <button
                    type="button"
                    disabled={saving || !canSave}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Add priority'}
                  </button>
                )}
              </div>
            )}
          </div>
          {pending.length > 0 && (
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
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-[11px] text-neutral-500 truncate">
                      {s.id === 'name' ? draft.label : draft.hours}
                    </p>
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

function GuidedStatusPreview({
  draft,
  stepIndex,
  saving = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { label: string };
  stepIndex: number;
  saving?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = STATUS_GUIDED_STEPS.length;
  const hasName = Boolean(draft.label.trim());
  let displayStep = stepIndex;
  if (displayStep > 0 && !hasName) displayStep = 0;
  const pct = Math.round((displayStep / total) * 100);
  const current = STATUS_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = STATUS_GUIDED_STEPS.slice(0, displayStep).filter((s) => {
    if (s.id === 'name') return hasName;
    return true;
  });
  const pending = STATUS_GUIDED_STEPS.slice(displayStep + 1);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating status with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">
              {draft.label.trim() || 'New status'}
            </h3>
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
              Step {Math.min(displayStep + 1, total)} of {total}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full bg-black transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            Up next
          </p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Label</dt>
                    <dd className="font-medium text-neutral-900">
                      {draft.label || '—'}
                    </dd>
                  </div>
                </dl>
                {onConfirmCreate && (
                  <button
                    type="button"
                    disabled={saving || !hasName}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Add status'}
                  </button>
                )}
              </div>
            )}
          </div>
          {pending.length > 0 && (
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
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{draft.label}</p>
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

function PriorityGlyph({ priority }: { priority: string }) {
  const key = priority.toLowerCase();
  const shell =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg';
  if (key === 'urgent') {
    return (
      <span className={`${shell} bg-rose-100 text-rose-600`}>
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'high') {
    return (
      <span className={`${shell} bg-orange-100 text-orange-600`}>
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'medium') {
    return (
      <span className={`${shell} bg-amber-100 text-amber-600`}>
        <Equal className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'low') {
    return (
      <span className={`${shell} bg-sky-100 text-sky-600`}>
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={`${shell} bg-neutral-200 text-neutral-800`}>
      <Tag className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  );
}

function StatusGlyph({ status }: { status: string }) {
  const key = status.toLowerCase();
  const shell =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg';
  if (key === 'open') {
    return (
      <span className={`${shell} bg-sky-100 text-sky-600`}>
        <Circle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'pending') {
    return (
      <span className={`${shell} bg-teal-100 text-teal-600`}>
        <Equal className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'resolved') {
    return (
      <span className={`${shell} bg-emerald-100 text-emerald-600`}>
        <Circle className="h-3.5 w-3.5 fill-current" strokeWidth={2.5} />
      </span>
    );
  }
  if (key === 'overdue') {
    return (
      <span className={`${shell} bg-rose-100 text-rose-600`}>
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={`${shell} bg-neutral-200 text-neutral-800`}>
      <Tag className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  );
}

function EnableToggle({
  enabled,
  disabled,
  onChange,
  label,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={
        label || (enabled ? 'Disable' : 'Enable')
      }
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:opacity-40 ${
        enabled ? 'bg-neutral-900' : 'bg-neutral-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function ActivePill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        active ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-600'
      }`}
    >
      {active ? 'Active' : 'Off'}
    </span>
  );
}

export default function PrioritiesView({
  embedded = false,
  startCreateIntent = false,
  startCreateStep = null,
  startCreateKind = null,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: PrioritiesViewProps) {
  useSetPageTitle('Priorities');
  const [items, setItems] = useState<OrgPriority[]>([]);
  const [statuses, setStatuses] = useState<OrgTicketStatus[]>([]);
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState('24');
  const [statusLabel, setStatusLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [guided, setGuided] = useState<GuidedCreate | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null);
  const [editingHours, setEditingHours] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'priorities' | 'statuses'>('priorities');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const recentlyDeletedRef = useRef(new Set<string>());
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const selectedPriority = items.find((p) => p.id === selectedCatalogId) || null;
  const selectedStatus = statuses.find((s) => s.id === selectedCatalogId) || null;
  useReportFocusedEntity(
    selectedPriority
      ? { type: 'priority', id: selectedPriority.id, name: selectedPriority.displayName }
      : selectedStatus
        ? { type: 'status', id: selectedStatus.id, name: selectedStatus.displayName }
        : null
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/priorities?all=1', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = (await res.json()) as OrgPriority[];
      setItems(Array.isArray(data) ? data : []);
      const next: Record<string, string> = {};
      for (const p of data) {
        next[p.id] = String(p.resolutionHours);
      }
      setEditingHours(next);
    } catch {
      setError('Could not load priorities.');
    } finally {
      setLoading(false);
    }
  };

  const loadStatuses = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/statuses?all=1', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = (await res.json()) as OrgTicketStatus[];
      setStatuses(Array.isArray(data) ? data : []);
    } catch {
      setStatusError('Could not load statuses.');
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadStatuses();
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void load();
    void loadStatuses();
  }, [listRefreshToken]);

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    const seed = startCreateSeed || {};
    const stepRaw = String(seed.step || startCreateStep || 'name').trim().toLowerCase();
    // Never open create panel for delete-confirm seeds.
    if (stepRaw === 'delete_confirm') {
      return;
    }
    const kind =
      seed.kind === 'status' || startCreateKind === 'status' ? 'status' : 'priority';
    const seedName = String(seed.label || '').trim();
    const seedHours = seed.hours;
    if (kind === 'status') {
      setTab('statuses');
      const step: GuidedStatusStep =
        stepRaw === 'confirm' ? 'confirm' : 'name';
      setGuided({ kind: 'status', step });
      if (seedName) setStatusLabel(seedName);
      else if (!startCreateStep && !seed.step) setStatusLabel('');
    } else {
      setTab('priorities');
      const step: GuidedPriorityStep =
        stepRaw === 'hours' ||
        stepRaw === 'resolutionhours' ||
        stepRaw === 'resolution_hours'
          ? 'hours'
          : stepRaw === 'confirm'
            ? 'confirm'
            : 'name';
      setGuided({ kind: 'priority', step });
      if (seedName) setLabel(seedName);
      else if (!startCreateStep && !seed.step) setLabel('');
      if (seedHours != null && seedHours !== '') setHours(String(seedHours));
      else if (seedName || startCreateStep || seed.step) setHours('');
      else setHours('24');
    }
  }, [
    startCreateIntent,
    startCreateStep,
    startCreateKind,
    startCreateSeed,
    onConsumeCreateIntent,
  ]);

  const phrase = (
    kind: string,
    fallback: string,
    context?: Record<string, string | number | boolean | null | undefined>,
    userText = ''
  ) =>
    llmOnlyReply(
      {
        module: 'priority',
        kind,
        userText,
        pageLabel: 'Priorities',
        context,
      },
      fallback,
      { message: userText, page: 'Priorities', allowAgentsFallback: false }
    );

  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (onCoworkerMessage) return onCoworkerMessage(text);
      return phrase(
        'unavailable',
        'Chat is temporarily unavailable. Use the priority form on the right, or try again shortly.',
        { chatUnavailable: true },
        text
      );
    },
    [onCoworkerMessage, phrase]
  );

  const getChatContext = useCallback(() => {
    if (pendingDelete) {
      return {
        module: 'admin',
        surface: 'priorities',
        draft: {
          awaiting: 'delete_confirm',
          kind: pendingDelete.kind,
          displayName: pendingDelete.name || undefined,
          id: pendingDelete.id || undefined,
        },
      };
    }
    if (!guided) {
      return { module: 'admin', surface: 'priorities', draft: null };
    }
    if (guided.kind === 'status') {
      if (!statusLabel.trim() && guided.step === 'name') {
        return {
          module: 'admin',
          surface: 'priorities',
          draft: { awaiting: 'displayName', kind: 'status' },
        };
      }
      return {
        module: 'admin',
        surface: 'priorities',
        draft: {
          awaiting: guided.step === 'confirm' ? 'confirm' : 'displayName',
          kind: 'status',
          displayName: statusLabel || undefined,
          name: statusLabel || undefined,
        },
      };
    }
    const hasProgress = Boolean(label.trim() || hours.trim());
    if (!hasProgress && guided.step === 'name') {
      return {
        module: 'admin',
        surface: 'priorities',
        draft: { awaiting: 'displayName', kind: 'priority' },
      };
    }
    return {
      module: 'admin',
      surface: 'priorities',
      draft: {
        awaiting:
          guided.step === 'hours'
            ? 'resolutionHours'
            : guided.step === 'confirm'
              ? 'confirm'
              : 'displayName',
        kind: 'priority',
        displayName: label || undefined,
        resolutionHours:
          guided.step !== 'name' && hours.trim() ? hours : undefined,
      },
    };
  }, [pendingDelete, guided, label, hours, statusLabel]);

  const create = async () => {
    if (!label.trim()) return;
    const resolutionHours = Number(hours);
    if (!Number.isFinite(resolutionHours) || resolutionHours <= 0) {
      setError('SLA breach hours must be a positive number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/priorities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: label.trim(),
          resolutionHours,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgPriority & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || 'Failed');
      }
      setLabel('');
      setHours('24');
      setGuided(null);
      await load();
      if (body.id) setSelectedCatalogId(body.id);
      setTab('priorities');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save priority.');
    } finally {
      setSaving(false);
    }
  };

  const createStatus = async () => {
    if (!statusLabel.trim()) return;
    setSavingStatus(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/statuses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: statusLabel.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgTicketStatus & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || 'Failed');
      }
      setStatusLabel('');
      setGuided(null);
      await loadStatuses();
      if (body.id) setSelectedCatalogId(body.id);
      setTab('statuses');
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not save status.');
    } finally {
      setSavingStatus(false);
    }
  };

  const saveHours = async (id: string) => {
    const resolutionHours = Number(editingHours[id]);
    if (!Number.isFinite(resolutionHours) || resolutionHours <= 0) {
      setError('SLA breach hours must be a positive number.');
      return;
    }
    setError(null);
    setSavingId(id);
    try {
      const res = await fetch(`/api/priorities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionHours }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update hours.');
    } finally {
      setSavingId(null);
    }
  };

  const setEnabled = async (id: string, active: boolean) => {
    setError(null);
    setTogglingId(id);
    try {
      const res = await fetch(`/api/priorities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update priority.');
    } finally {
      setTogglingId(null);
    }
  };

  const setStatusEnabled = async (id: string, active: boolean) => {
    setStatusError(null);
    setTogglingStatusId(id);
    try {
      const res = await fetch(`/api/statuses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      await loadStatuses();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not update status.');
    } finally {
      setTogglingStatusId(null);
    }
  };

  const removeCustom = async (id: string) => {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/priorities/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      setPendingDelete(null);
      recentlyDeletedRef.current.add(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove priority.');
    } finally {
      setDeleting(false);
    }
  };

  const removeCustomStatus = async (id: string) => {
    setStatusError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/statuses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      setPendingDelete(null);
      recentlyDeletedRef.current.add(id);
      await loadStatuses();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not remove status.');
    } finally {
      setDeleting(false);
    }
  };

  const requestRemovePriority = (p: OrgPriority) => {
    setGuided(null);
    setPendingDelete({
      kind: 'priority',
      id: p.id,
      name: p.displayName,
      source: 'form',
    });
  };

  const requestRemoveStatus = (s: OrgTicketStatus) => {
    setGuided(null);
    setPendingDelete({
      kind: 'status',
      id: s.id,
      name: s.displayName,
      source: 'form',
    });
  };

  const isDirty = (p: OrgPriority) =>
    String(editingHours[p.id] ?? '') !== String(p.resolutionHours);

  const body = (
    <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col gap-4 overflow-x-hidden">
      <div
        role="tablist"
        aria-label="Priority and status catalogs"
        className="flex shrink-0 gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'priorities'}
          onClick={() => setTab('priorities')}
          className={`inline-flex flex-1 min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === 'priorities'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
              tab === 'priorities'
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-200 text-neutral-600'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          Priorities
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'statuses'}
          onClick={() => setTab('statuses')}
          className={`inline-flex flex-1 min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === 'statuses'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
              tab === 'statuses'
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-200 text-neutral-600'
            }`}
          >
            <Circle className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          Statuses
        </button>
      </div>

      {tab === 'priorities' ? (
      <section
        role="tabpanel"
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <div className="flex shrink-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <Bookmark className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900">Priorities</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
              Default priorities ship with SLA breach hours. Edit hours or add custom
              labels — ticket due times and overdue metrics use these values from the
              same catalog.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex shrink-0 items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="w-full min-w-0 shrink-0 rounded-2xl border border-neutral-200 bg-neutral-50/90 p-3.5 shadow-sm">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900">
            <PlusCircle className="h-4 w-4" />
            Add priority
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. Inta)"
              className="h-9 min-w-[10rem] flex-1 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
            <input
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              aria-label="SLA breach hours"
              className="h-9 w-14 shrink-0 rounded-xl border border-neutral-200 bg-white px-2 text-center text-sm outline-none focus:border-neutral-900"
            />
            <span className="shrink-0 text-sm text-neutral-500">hours</span>
            <button
              type="button"
              disabled={saving || !label.trim()}
              onClick={() => void create()}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-neutral-900 px-3 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Add
            </button>
          </div>
        </div>

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {loading ? (
            <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              No priorities found.
            </div>
          ) : (
            <div className="w-full min-w-0 rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[26%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    <th className="px-2.5 py-2.5 font-semibold sm:px-3">Label</th>
                    <th className="px-2 py-2.5 font-semibold">Hours</th>
                    <th className="hidden px-2 py-2.5 font-semibold sm:table-cell">Type</th>
                    <th className="px-2 py-2.5 font-semibold">Status</th>
                    <th className="px-1 py-2.5 text-center font-semibold">On</th>
                    <th className="sticky right-0 z-10 bg-white px-1.5 py-2.5 text-right font-semibold shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const dirty = isDirty(p);
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-neutral-50 last:border-0 cursor-pointer ${
                          p.active ? '' : 'opacity-60'
                        }`}
                        onClick={() => setSelectedCatalogId(p.id)}
                      >
                        <td className="px-2.5 py-2 sm:px-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <PriorityGlyph priority={p.priority} />
                            <span className="truncate text-[13px] font-medium text-neutral-900">
                              {p.displayName}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex min-w-0 items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              value={editingHours[p.id] ?? String(p.resolutionHours)}
                              onChange={(e) =>
                                setEditingHours((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && dirty) void saveHours(p.id);
                              }}
                              className="h-8 w-11 shrink-0 rounded-lg border border-neutral-200 bg-white px-1 text-center text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900/15"
                            />
                            <button
                              type="button"
                              disabled={!dirty || savingId === p.id}
                              onClick={() => void saveHours(p.id)}
                              className={`h-8 shrink-0 rounded-lg px-1.5 text-[11px] font-semibold transition-colors ${
                                dirty
                                  ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                                  : 'bg-transparent text-neutral-300'
                              }`}
                            >
                              {savingId === p.id ? '…' : 'Save'}
                            </button>
                          </div>
                        </td>
                        <td className="hidden px-2 py-2 sm:table-cell">
                          <span
                            className={`text-xs ${
                              p.isSystem
                                ? 'text-neutral-500'
                                : 'font-medium text-neutral-800'
                            }`}
                          >
                            {p.isSystem ? 'Default' : 'Custom'}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <ActivePill active={p.active} />
                        </td>
                        <td className="px-1 py-2">
                          <div className="flex justify-center">
                            <EnableToggle
                              enabled={p.active}
                              disabled={togglingId === p.id}
                              onChange={(next) => void setEnabled(p.id, next)}
                              label={
                                p.active ? 'Disable priority' : 'Enable priority'
                              }
                            />
                          </div>
                        </td>
                        <td className="sticky right-0 z-10 bg-white px-1.5 py-2 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                          {!p.isSystem ? (
                            <button
                              type="button"
                              title="Remove"
                              onClick={() => requestRemovePriority(p)}
                              className="inline-flex rounded-lg p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="inline-block w-7" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      ) : (
      <section
        role="tabpanel"
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <div className="flex shrink-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <Circle className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900">
              Ticket statuses
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
              Default workflow statuses ship with the product. Add custom labels or
              disable unused ones — ticket filters and status dropdowns use this
              catalog.
            </p>
          </div>
        </div>

        {statusError && (
          <div className="flex shrink-0 items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{statusError}</span>
          </div>
        )}

        <div className="w-full min-w-0 shrink-0 rounded-2xl border border-neutral-200 bg-neutral-50/90 p-3.5 shadow-sm">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900">
            <PlusCircle className="h-4 w-4" />
            Add status
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <input
              value={statusLabel}
              onChange={(e) => setStatusLabel(e.target.value)}
              placeholder="Label (e.g. Waiting on customer)"
              className="h-9 min-w-[10rem] flex-1 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createStatus();
              }}
            />
            <button
              type="button"
              disabled={savingStatus || !statusLabel.trim()}
              onClick={() => void createStatus()}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-neutral-900 px-3 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Add
            </button>
          </div>
        </div>

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {statusLoading ? (
            <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>
          ) : statuses.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              No statuses found.
            </div>
          ) : (
            <div className="w-full min-w-0 rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[36%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    <th className="px-2.5 py-2.5 font-semibold sm:px-3">Label</th>
                    <th className="hidden px-2 py-2.5 font-semibold sm:table-cell">Type</th>
                    <th className="px-2 py-2.5 font-semibold">Status</th>
                    <th className="px-1 py-2.5 text-center font-semibold">On</th>
                    <th className="sticky right-0 z-10 bg-white px-1.5 py-2.5 text-right font-semibold shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statuses.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-b border-neutral-50 last:border-0 cursor-pointer ${
                        s.active ? '' : 'opacity-60'
                      }`}
                      onClick={() => setSelectedCatalogId(s.id)}
                    >
                      <td className="px-2.5 py-2 sm:px-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusGlyph status={s.status} />
                          <span className="truncate text-[13px] font-medium text-neutral-900">
                            {s.displayName}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 sm:table-cell">
                        <span
                          className={`text-xs ${
                            s.isSystem
                              ? 'text-neutral-500'
                              : 'font-medium text-neutral-800'
                          }`}
                        >
                          {s.isSystem ? 'Default' : 'Custom'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <ActivePill active={s.active} />
                      </td>
                      <td className="px-1 py-2">
                        <div className="flex justify-center">
                          <EnableToggle
                            enabled={s.active}
                            disabled={togglingStatusId === s.id}
                            onChange={(next) => void setStatusEnabled(s.id, next)}
                            label={
                              s.active ? 'Disable status' : 'Enable status'
                            }
                          />
                        </div>
                      </td>
                      <td className="sticky right-0 z-10 bg-white px-1.5 py-2 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                        {!s.isSystem ? (
                          <button
                            type="button"
                            title="Remove"
                            onClick={() => requestRemoveStatus(s)}
                            className="inline-flex rounded-lg p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="inline-block w-7" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      )}
    </div>
  );

  return onCoworkerMessage || onCoworkerChatActions ? (
    <CoworkerSplitWorkspace
      pageLabel="Priorities"
      contentTitle={
        pendingDelete || guided ? 'Next steps' : 'Priorities & statuses'
      }
      getChatContext={getChatContext}
      module="admin"
      surface="priorities"
      onChatRestart={() => {
        setPendingDelete(null);
        setGuided(null);
      }}
      onUserMessage={handleChatMessage}
      onChatActions={async (actions, meta) => {
        const catalogMutated = actions.some((raw) => {
          const type = String(raw.type || '').toLowerCase();
          const done = Boolean(raw.done || raw.refresh || raw.save);
          return (
            type === 'refresh_priorities' ||
            ((type === 'update_priority' || type === 'update_status') && done) ||
            ((type === 'create_priority' || type === 'create_status') && done)
          );
        });
        if (catalogMutated) {
          setPendingDelete(null);
          setGuided(null);
        }
        for (const raw of actions) {
          const type = String(raw.type || '').toLowerCase();
          if (
            catalogMutated &&
            (type === 'delete_priority' ||
              type === 'delete_status' ||
              type === 'create_priority' ||
              type === 'create_status') &&
            !Boolean(raw.done || raw.refresh || raw.save)
          ) {
            continue;
          }
          if (
            type === 'update_priority' ||
            type === 'update_status' ||
            type === 'refresh_priorities'
          ) {
            setPendingDelete(null);
            setGuided(null);
            continue;
          }
          if (type === 'delete_priority' || type === 'delete_status') {
            const done = Boolean(raw.done || raw.refresh);
            const name = String(raw.displayName || raw.name || raw.label || '').trim();
            const id = String(raw.id || '').trim();
            if (done) {
              setPendingDelete(null);
              setGuided(null);
            } else if (id || name) {
              const gone =
                (id && recentlyDeletedRef.current.has(id)) ||
                (name && recentlyDeletedRef.current.has(name.toLowerCase()));
              if (!gone) {
                setGuided(null);
                setPendingDelete({
                  kind: type === 'delete_status' ? 'status' : 'priority',
                  id,
                  name:
                    name ||
                    (type === 'delete_status' ? 'this status' : 'this priority'),
                  source: 'chat',
                });
              }
            }
            continue;
          }
          if (type === 'create_priority') {
            const done = Boolean(raw.done || raw.save);
            const stepRaw = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            const name = String(raw.displayName || raw.label || raw.name || '').trim();
            const id = String(raw.id || '').trim();
            // Mid-delete must never open create SLA collect.
            if (stepRaw === 'delete_confirm' || (id && !done)) {
              setGuided(null);
              if (id || name) {
                setPendingDelete({
                  kind: 'priority',
                  id,
                  name: name || 'this priority',
                  source: 'chat',
                });
              }
              continue;
            }
            if (name) setLabel(name);
            const hoursRaw = raw.resolutionHours ?? raw.hours ?? raw.resolution_hours;
            if (hoursRaw != null && hoursRaw !== '') setHours(String(hoursRaw));
            else if (!done) setHours('');
            setTab('priorities');
            setStatusLabel('');
            setPendingDelete(null);
            if (done) {
              const createdId = String(raw.id || '').trim();
              if (createdId) setSelectedCatalogId(createdId);
              setGuided(null);
            } else {
              const step: GuidedPriorityStep =
                stepRaw === 'hours' ||
                stepRaw === 'resolutionhours' ||
                stepRaw === 'resolution_hours'
                  ? 'hours'
                  : stepRaw === 'confirm'
                    ? 'confirm'
                    : 'name';
              setGuided({ kind: 'priority', step });
            }
            continue;
          }
          if (type === 'create_status') {
            const done = Boolean(raw.done || raw.save);
            const stepRaw = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            const name = String(raw.displayName || raw.label || raw.name || '').trim();
            const id = String(raw.id || '').trim();
            if (stepRaw === 'delete_confirm' || (id && !done)) {
              setGuided(null);
              if (id || name) {
                setPendingDelete({
                  kind: 'status',
                  id,
                  name: name || 'this status',
                  source: 'chat',
                });
              }
              continue;
            }
            if (name) setStatusLabel(name);
            setTab('statuses');
            setLabel('');
            setHours('24');
            setPendingDelete(null);
            if (done) {
              const id = String(raw.id || '').trim();
              if (id) setSelectedCatalogId(id);
              setGuided(null);
            } else {
              const step: GuidedStatusStep =
                stepRaw === 'confirm' ? 'confirm' : 'name';
              setGuided({ kind: 'status', step });
            }
            continue;
          }
          if (type === 'open_priority') {
            const id = String(raw.id || '').trim();
            if (id) {
              setSelectedCatalogId(id);
              setTab('priorities');
              setGuided(null);
              setPendingDelete(null);
            }
          } else if (type === 'open_status') {
            const id = String(raw.id || '').trim();
            if (id) {
              setSelectedCatalogId(id);
              setTab('statuses');
              setGuided(null);
              setPendingDelete(null);
            }
          }
        }
        await onCoworkerChatActions?.(actions, meta);
      }}
      onDraftPatch={(patch) => {
        const awaiting = String(patch.step || patch.awaiting || '')
          .trim()
          .toLowerCase();
        if (awaiting === 'delete_confirm') {
          const kind =
            String(patch.kind || '').toLowerCase() === 'status' ? 'status' : 'priority';
          setGuided(null);
          setPendingDelete({
            kind,
            id: String(patch.id || '').trim(),
            name: String(patch.displayName || patch.name || patch.label || '').trim(),
            source: 'chat',
          });
          return;
        }
        const patchKind = String(patch.kind || '').toLowerCase();
        const workflow = String(patch.workflow || patch.current_workflow || '')
          .trim()
          .toLowerCase();
        const isStatus =
          patchKind === 'status' ||
          workflow === 'create_status' ||
          (patchKind !== 'priority' &&
            workflow !== 'create_priority' &&
            guided?.kind === 'status');
        const name = String(patch.displayName || patch.label || patch.name || '').trim();
        const hoursRaw = patch.resolutionHours ?? patch.hours ?? patch.resolution_hours;
        if (isStatus) {
          if (name) setStatusLabel(name);
          setLabel('');
          setHours('24');
          setTab('statuses');
          setPendingDelete(null);
          const step: GuidedStatusStep =
            awaiting === 'confirm' ? 'confirm' : 'name';
          setGuided({ kind: 'status', step });
          return;
        }
        if (name) setLabel(name);
        if (hoursRaw != null && hoursRaw !== '') setHours(String(hoursRaw));
        else if (
          awaiting === 'name' ||
          awaiting === 'hours' ||
          awaiting === 'displayname' ||
          awaiting === 'display_name' ||
          awaiting === 'resolutionhours' ||
          awaiting === 'resolution_hours'
        ) {
          setHours('');
        }
        setStatusLabel('');
        setTab('priorities');
        setPendingDelete(null);
        const step: GuidedPriorityStep =
          awaiting === 'hours' ||
          awaiting === 'resolutionhours' ||
          awaiting === 'resolution_hours'
            ? 'hours'
            : awaiting === 'confirm'
              ? 'confirm'
              : 'name';
        setGuided({ kind: 'priority', step });
      }}
      onAgentRoute={onAgentRoute}
      suggestionChips={
        pendingDelete?.source === 'form'
          ? [
              'add priority',
              'add status',
              'list priorities',
              'list statuses',
            ]
          : pendingDelete
            ? []
            : guided
              ? guided.step === 'confirm'
                ? ['confirm', 'cancel']
                : ['cancel']
              : [
                  'add priority',
                  'add status',
                  'list priorities',
                  'list statuses',
                ]
      }
      placeholder="Add a priority or status, or manage the catalog…"
    >
      <PageShell embedded fillHeight>
        {pendingDelete ? (
          <GuidedDeletePreview
            pending={pendingDelete}
            deleting={deleting}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              if (pendingDelete.kind === 'status') {
                void removeCustomStatus(pendingDelete.id);
              } else {
                void removeCustom(pendingDelete.id);
              }
            }}
          />
        ) : guided?.kind === 'priority' ? (
          <GuidedPriorityPreview
            draft={{ label, hours }}
            stepIndex={priorityStepIndex(guided.step)}
            saving={saving}
            onCancel={() => {
              setGuided(null);
              setLabel('');
              setHours('24');
            }}
            onUseForm={() => setGuided(null)}
            onConfirmCreate={() => {
              void create();
            }}
          />
        ) : guided?.kind === 'status' ? (
          <GuidedStatusPreview
            draft={{ label: statusLabel }}
            stepIndex={statusStepIndex(guided.step)}
            saving={savingStatus}
            onCancel={() => {
              setGuided(null);
              setStatusLabel('');
            }}
            onUseForm={() => setGuided(null)}
            onConfirmCreate={() => {
              void createStatus();
            }}
          />
        ) : (
          body
        )}
      </PageShell>
    </CoworkerSplitWorkspace>
  ) : (
    <PageShell embedded={embedded} fillHeight>
      {body}
    </PageShell>
  );
}
