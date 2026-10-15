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
  { value: "temporary", label: "Temporary Lead" },
];

export const CUSTOMER_SCOPE_OPTIONS = [
  { value: "all", label: "All customers" },
  { value: "mine", label: "My customers" },
];

export function parseDashboardView(value) {
  return value === DASHBOARD_VIEWS.MINE ? DASHBOARD_VIEWS.MINE : DASHBOARD_VIEWS.TEAM;
}

export function parseLeadScope(value) {
  if (value === "mine") return "mine";
  if (value === "temporary") return "temporary";
  return "all";
}

export function isTemporaryLeadScope(scope) {
  return scope === "temporary";
}

export function isTemporaryLead(lead) {
  return String(lead?.leadKind || "").toLowerCase() === "temporary";
}
