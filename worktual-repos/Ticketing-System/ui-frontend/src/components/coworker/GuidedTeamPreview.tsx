import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export type GuidedStepId = 'name' | 'description' | 'members';

export type GuidedTeamDraft = {
  name: string;
  description: string;
  members: string[];
};

export const emptyGuidedTeamDraft = (): GuidedTeamDraft => ({
  name: '',
  description: '',
  members: [],
});

export const TEAM_GUIDED_STEPS: Array<{
  id: GuidedStepId;
  title: string;
  prompt: string;
}> = [
  {
    id: 'name',
    title: 'Team name',
    prompt: 'what to call this team',
  },
  {
    id: 'description',
    title: 'Description',
    prompt: 'a short description used to route tickets',
  },
  {
    id: 'members',
    title: 'Members',
    prompt: 'pick at least one staff name from the list (tap or type names). Teams cannot be empty',
  },
];

export function teamStepIndex(id: GuidedStepId | string): number {
  const mapped =
    id === 'create_members' || id === 'agents' || id === 'confirm'
      ? 'members'
      : id === 'type'
        ? 'description'
        : id;
  const idx = TEAM_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

export function isTeamConfirmStep(id: string | undefined | null): boolean {
  return String(id || '').trim().toLowerCase() === 'confirm';
}

type GuidedTeamPreviewProps = {
  draft: GuidedTeamDraft;
  stepIndex: number;
  creating?: boolean;
  availableAgents?: string[];
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
  onToggleAgent?: (name: string) => void;
  confirming?: boolean;
};

function draftValue(draft: GuidedTeamDraft, id: GuidedStepId): string {
  switch (id) {
    case 'name':
      return draft.name;
    case 'description':
      return draft.description;
    case 'members':
      return draft.members.length ? draft.members.join(', ') : '';
    default:
      return '—';
  }
}

export default function GuidedTeamPreview({
  draft,
  stepIndex,
  creating = false,
  availableAgents = [],
  onCancel,
  onUseForm,
  onConfirmCreate,
  onToggleAgent,
  confirming = false,
}: GuidedTeamPreviewProps) {
  const total = TEAM_GUIDED_STEPS.length;
  const hasName = Boolean(draft.name.trim());
  const hasDescription = Boolean(draft.description.trim());
  const hasMembers = draft.members.length > 0;
  // Prefer agent stepIndex so corrections that re-ask an earlier field move the panel back.
  let displayStep = stepIndex;
  if (displayStep > 0 && !hasName) displayStep = 0;
  else if (displayStep > 1 && !hasDescription) displayStep = 1;
  const readyToCreate = confirming && hasName && hasDescription && hasMembers;
  const pct = readyToCreate ? 100 : Math.round((displayStep / total) * 100);
  const current = readyToCreate
    ? {
        id: 'confirm' as const,
        title: 'Confirm create',
        prompt: `review selected members (${draft.members.join(', ')}), then say proceed or tap Create team`,
      }
    : TEAM_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = (
    readyToCreate ? TEAM_GUIDED_STEPS : TEAM_GUIDED_STEPS.slice(0, displayStep)
  ).filter((s) => {
    if (s.id === 'name') return hasName;
    if (s.id === 'description') return hasDescription;
    if (s.id === 'members') return hasMembers;
    return Boolean(draftValue(draft, s.id).trim());
  });
  const pending = readyToCreate ? [] : TEAM_GUIDED_STEPS.slice(displayStep + 1);
  const draftLabel = draft.name.trim() || 'New team';
  const canCreate = hasName && hasDescription && hasMembers;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{draftLabel}</h3>
            {(draft.description || draft.members.length > 0) && (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                {[
                  draft.description || null,
                  draft.members.length
                    ? `${draft.members.length} member${draft.members.length === 1 ? '' : 's'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
              Step {readyToCreate ? total : Math.min(displayStep + 1, total)} of {total}
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
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Up next</p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>

            {(current.id === 'members' || current.id === 'confirm') && availableAgents.length > 0 && (
              <div className="mt-3 space-y-2">
                {current.id === 'members' && (
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Available staff — tap to add / remove (required)
                  </p>
                )}
                {current.id === 'confirm' && (
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Selected members
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(current.id === 'confirm' ? draft.members : availableAgents).map((name) => {
                    const selected = draft.members.some(
                      (a) => a.toLowerCase() === name.toLowerCase()
                    );
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => onToggleAgent?.(name)}
                        disabled={current.id === 'confirm'}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          selected || current.id === 'confirm'
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                {current.id === 'members' && draft.members.length > 0 && (
                  <p className="text-[11px] text-neutral-500 pt-1">
                    Selected:{' '}
                    <span className="font-medium text-neutral-800">
                      {draft.members.join(', ')}
                    </span>
                  </p>
                )}
                {current.id === 'members' && draft.members.length === 0 && (
                  <p className="text-[11px] text-amber-700 pt-1">
                    Select at least one member before creating this team.
                  </p>
                )}
                {onConfirmCreate && (current.id === 'confirm' || hasMembers) && (
                  <button
                    type="button"
                    disabled={creating || !canCreate}
                    onClick={onConfirmCreate}
                    className="mt-2 h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : 'Create team'}
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
                  className="flex items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      {draftValue(draft, s.id) || '—'}
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
