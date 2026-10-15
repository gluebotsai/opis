import React from 'react';

export type DeleteKind = 'team' | 'macro' | 'priority' | 'status';

export type PendingDelete = {
  kind: DeleteKind;
  id: string;
  name: string;
  /** Form trash stays on the panel; chat-started delete confirms in chat. */
  source?: 'form' | 'chat';
};

const KIND_LABEL: Record<DeleteKind, string> = {
  team: 'team',
  macro: 'macro',
  priority: 'priority',
  status: 'status',
};

const KIND_WARNING: Record<DeleteKind, string> = {
  team: 'Tickets keep their assignees. This team is removed from the catalog.',
  macro: 'This snippet will no longer be available for notes and replies.',
  priority: 'Tickets already using this priority keep their current value.',
  status: 'Tickets already using this status keep their current value.',
};

type GuidedDeletePreviewProps = {
  pending: PendingDelete;
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function GuidedDeletePreview({
  pending,
  deleting = false,
  onCancel,
  onConfirm,
}: GuidedDeletePreviewProps) {
  const kind = KIND_LABEL[pending.kind];
  const label = pending.name.trim() || `this ${kind}`;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Deleting with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
            <p className="text-xs text-neutral-500 mt-0.5">Delete {kind}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-900 shrink-0"
          >
            Cancel
          </button>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
            <span>Step 1 of 1</span>
            <span className="tabular-nums">100%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-black" style={{ width: '100%' }} />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            Up next
          </p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">Confirm delete</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              {pending.source === 'chat' ? (
                <>
                  Confirm in chat to permanently delete <strong>{label}</strong>, or
                  use the button below.
                </>
              ) : (
                <>
                  Permanently delete <strong>{label}</strong> here, or cancel.
                </>
              )}
            </p>
            <p className="text-xs text-neutral-600 mt-2 leading-relaxed">
              {KIND_WARNING[pending.kind]}
            </p>
            <button
              type="button"
              disabled={deleting || !pending.id}
              onClick={onConfirm}
              className="mt-3 h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : `Delete ${kind}`}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
