import React from 'react';
import { AlertTriangle, RotateCcw, ArrowUpRight, X } from 'lucide-react';
import type { CriticalAlert } from '../../types';
import { criticalAlertUi } from './criticalAlertRegistry';

function ScenarioIcon({ scenario }: { scenario: CriticalAlert['scenario'] }) {
  if (scenario === 'ticket_reopened') {
    return <RotateCcw className="h-5 w-5 shrink-0" aria-hidden />;
  }
  if (scenario === 'escalation_to_resolver') {
    return <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden />;
  }
  return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />;
}

export default function CriticalAlertModal({
  alert,
  onDismiss,
  onDismissAll,
  onViewTicket,
}: {
  alert: CriticalAlert;
  onDismiss: () => void;
  onDismissAll: () => void;
  onViewTicket: () => void;
}) {
  const ui = criticalAlertUi(alert.scenario);
  const canOpenTicket =
    alert.primaryAction === 'open_ticket' && Boolean(alert.ticketNumber);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="critical-alert-title"
      aria-describedby="critical-alert-message"
    >
      <div
        className={`relative max-w-md w-full overflow-hidden rounded-2xl border-[0.6px] bg-white shadow-2xl ${ui.borderClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismissAll}
          aria-label="Close all alerts"
          title="Close all alerts"
          className="absolute right-3 top-3 inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-500 hover:bg-white/70 hover:text-neutral-900 shadow-none"
        >
          <X className="h-[18px] w-[18px] stroke-[2.25]" />
        </button>
        <div className={`px-5 py-4 pr-14 border-b ${ui.accentClass}`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <ScenarioIcon scenario={alert.scenario} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                Critical alert
              </p>
              <h2
                id="critical-alert-title"
                className="text-base font-semibold tracking-tight text-neutral-900"
              >
                {alert.title}
              </h2>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p
            id="critical-alert-message"
            className="text-sm leading-relaxed text-neutral-700"
          >
            {alert.message}
          </p>
          {alert.customerName ? (
            <p className="text-xs text-neutral-500">
              Customer: {alert.customerName}
            </p>
          ) : null}
          <p className="text-[11px] text-neutral-400">{alert.createdAt}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3.5 bg-neutral-50">
          <button
            type="button"
            onClick={onDismiss}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"
          >
            {ui.dismissLabel}
          </button>
          {canOpenTicket ? (
            <button
              type="button"
              onClick={onViewTicket}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-neutral-900 text-white hover:bg-black"
            >
              {ui.viewTicketLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
