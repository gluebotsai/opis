import type { CriticalAlertScenario, CriticalAlertSeverity } from '../../types';

export type CriticalAlertUiConfig = {
  severity: CriticalAlertSeverity;
  accentClass: string;
  borderClass: string;
  iconLabel: string;
  viewTicketLabel: string;
  dismissLabel: string;
};

export const criticalAlertRegistry: Record<
  CriticalAlertScenario,
  CriticalAlertUiConfig
> = {
  sla_breach: {
    severity: 'critical',
    accentClass: 'text-red-700 bg-red-50 border-red-200',
    borderClass: 'border-red-300',
    iconLabel: 'SLA',
    viewTicketLabel: 'View ticket',
    dismissLabel: 'Dismiss',
  },
  escalation_to_resolver: {
    severity: 'warning',
    accentClass: 'text-amber-900 bg-amber-50 border-amber-200',
    borderClass: 'border-amber-300',
    iconLabel: 'Esc',
    viewTicketLabel: 'View ticket',
    dismissLabel: 'Dismiss',
  },
  ticket_assigned: {
    severity: 'warning',
    accentClass: 'text-sky-900 bg-sky-50 border-sky-200',
    borderClass: 'border-sky-300',
    iconLabel: 'Agent',
    viewTicketLabel: 'View ticket',
    dismissLabel: 'Dismiss',
  },
  ticket_reopened: {
    severity: 'warning',
    accentClass: 'text-sky-900 bg-sky-50 border-sky-200',
    borderClass: 'border-sky-300',
    iconLabel: 'Reopen',
    viewTicketLabel: 'View ticket',
    dismissLabel: 'Dismiss',
  },
};

export function criticalAlertUi(
  scenario: CriticalAlertScenario
): CriticalAlertUiConfig {
  return criticalAlertRegistry[scenario] ?? criticalAlertRegistry.ticket_reopened;
}
