export const DASHBOARD_VIEWS = {
  TEAM: "team",
  MINE: "mine",
};

export const DASHBOARD_VIEW_OPTIONS = [
  { value: DASHBOARD_VIEWS.TEAM, label: "Team dashboard" },
  { value: DASHBOARD_VIEWS.MINE, label: "My dashboard" },
];

export const LEAD_SCOPE_OPTIONS = [
  { value: "all", label: "All leads" },
  { value: "mine", label: "My leads" },
];

export function parseDashboardView(value) {
  return value === DASHBOARD_VIEWS.MINE ? DASHBOARD_VIEWS.MINE : DASHBOARD_VIEWS.TEAM;
}

export function parseLeadScope(value) {
  return value === "mine" ? "mine" : "all";
}
