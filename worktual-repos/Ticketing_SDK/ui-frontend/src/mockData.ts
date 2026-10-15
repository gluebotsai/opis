import type { DashboardMetrics } from './types';

/**
 * UI must load tickets/teams/agents from API/DB.
 * This file only provides empty metric placeholders for initial render.
 * Do not add sample team/queue names here.
 */
export const emptyMetrics: DashboardMetrics = {
  openTickets: 0,
  onHold: 0,
  overdue: 0,
  dueToday: 0,
  createdToday: 0,
  unassigned: 0,
  openChange: "—",
  onHoldChange: "—",
  overdueChange: "—",
  dueTodayChange: "—",
  unassignedChange: "—",
  priorityCounts: { low: 0, medium: 0, high: 0, urgent: 0 },
  topQueues: [],
};
