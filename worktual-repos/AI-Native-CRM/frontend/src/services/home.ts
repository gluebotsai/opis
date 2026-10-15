import { api } from "./api";

export type ChartSlice = {
  id: string;
  label: string;
  value: number;
};

export type KpiCard = {
  id: string;
  label: string;
  value: string;
  hint: string;
  href?: string;
};

export type AssignableUser = {
  id: string;
  label: string;
  role?: string;
};

export type ScorecardRowStatus = "on_track" | "behind" | "ahead";

export type SalesWeeklyScorecardData = {
  weekKey: string;
  weekLabel: string;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  region: string | null;
  regions: string[];
  quoteScorecard: {
    targetPerWeek: number;
    rows: Array<{
      userId: string;
      name: string;
      seniorityTier: string | null;
      target: number;
      achieved: number;
      gap: number;
      status: ScorecardRowStatus;
      quoteIds: string[];
    }>;
    orgTotal: { target: number; achieved: number };
  };
  sqmScorecard: {
    targetPerWeek: number;
    rows: Array<{
      userId: string;
      name: string;
      seniorityTier: string | null;
      target: number;
      achieved: number;
      gap: number;
      status: ScorecardRowStatus;
      meetingIds: string[];
    }>;
    orgTotal: { target: number; achieved: number };
  };
  proposalPipeline: {
    rows: Array<{
      proposalId: string;
      proposalNumber: string;
      customerName: string;
      companyName: string;
      region: string | null;
      bdmUserId: string | null;
      bdmName: string | null;
      status: string;
      approvalStatus: string;
      dealStage: string;
      value: string | null;
      expectedClose: string | null;
      href: string;
    }>;
  };
  repsBehindCount: number;
  limitations: string[];
};

export type RepWeeklyScorecardData = {
  weekLabel: string;
  timeZone: string;
  track: "quotes" | "sqm" | null;
  target: number;
  achieved: number;
  gap: number;
  status: ScorecardRowStatus;
};

export type AdminOpsData = {
  assignableUsers: AssignableUser[];
  leaderboard: {
    metric: string;
    period: string;
    rows: Array<{
      userId: string;
      name: string;
      value: number;
      valueLabel: string;
    }>;
  };
  untouchedLeads: {
    thresholdHours: number;
    items: Array<{
      id: string;
      displayName: string;
      email: string;
      ownerUserId: string | null;
      ownerName: string | null;
      updatedAt: string;
      ageHours: number;
    }>;
  };
  needsReview?: {
    items: Array<{
      id: string;
      displayName: string;
      email: string;
      ownerUserId: string | null;
      ownerName: string | null;
      reason: string | null;
      flaggedAt: string | null;
    }>;
  };
  monthlyMetrics: {
    period: string;
    title: string;
    compareLabel: string;
    cards: Array<{
      id: string;
      label: string;
      value: string;
      changePct: number | null;
      href: string;
    }>;
  };
  pipelineSnapshot: {
    openDeals: { value: string; hint: string; href: string };
    closedWon: { value: string; hint: string; href: string };
  };
  activityFeed: {
    loggedToday: number;
    repCount: number;
    items: Array<{
      id: string;
      type: string;
      subject: string;
      contactId: string;
      contactName: string;
      createdAt: string;
      actorName: string | null;
    }>;
  };
  teamDeals: {
    groupBy: string;
    region: string | null;
    regions: string[];
    summary: {
      open: number;
      negotiation: number;
      closed: number;
    };
    groups: Array<{
      id: string;
      label: string;
      deals: Array<{
        id: string;
        title: string;
        stage: string;
        stageLabel: string;
        amount: string | null;
        companyName: string;
        region: string | null;
        ownerUserId: string | null;
        ownerName: string | null;
      }>;
    }>;
  };
  focusedRep: {
    userId: string;
    name: string;
    openDeals: number;
    wonDeals: number;
    pipelineValue: string;
    callsInPeriod: number;
  } | null;
  salesMetrics: {
    /** ISO code from the tenant country. */
    currency: string;
    methodologyNote: string;
    periodLabel: string;
    cards: Array<{
      id: string;
      label: string;
      value: string;
      hint: string;
      href?: string;
    }>;
    funnel: ChartSlice[];
    /** Stage deal value (alongside funnel counts). */
    funnelValue: ChartSlice[];
    winLoss: ChartSlice[];
    aging: ChartSlice[];
    pipelineByOwner: ChartSlice[];
    lostReasons: ChartSlice[];
    dealSizeBands: ChartSlice[];
    /** Last 6 calendar months of closed-won revenue. */
    wonRevenueTrend: ChartSlice[];
    topOpportunities: Array<{
      id: string;
      title: string;
      stage: string;
      stageLabel: string;
      amount: string | null;
      companyName: string;
      ownerName: string | null;
      agingDays: number;
      weightPct: number;
    }>;
  };
  weeklyScorecard: SalesWeeklyScorecardData;
  revenueBoard: {
    currency: string;
    quarterLabel: string;
    previousQuarterLabel: string;
    companyCurrent: number;
    companyPrevious: number;
    companyChangePct: number | null;
    employeeCurrent: number;
    employeePrevious: number;
    reps: Array<{
      userId: string;
      name: string;
      current: number;
      previous: number;
      changePct: number | null;
    }>;
    byCustomer: Array<{ id: string; label: string; amount: number }>;
    byProduct: Array<{ id: string; label: string; amount: number }>;
  };
};

export type RepOpsData = {
  meetingsToday: Array<{
    id: string;
    subject: string;
    dueAt: string;
    contactId: string;
    contactName: string;
  }>;
  tasksToday: Array<{
    id: string;
    subject: string;
    dueAt: string;
    overdue: boolean;
    contactId: string;
    contactName: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    subject: string;
    createdAt: string;
    contactId: string;
    contactName: string;
  }>;
  myLeads: Array<{
    id: string;
    displayName: string;
    email: string;
    updatedAt: string;
    ageHours: number;
    untouched: boolean;
  }>;
  needsReview?: Array<{
    id: string;
    displayName: string;
    email: string;
    reason: string | null;
  }>;
  quickActionContacts: Array<{
    id: string;
    displayName: string;
    email: string;
  }>;
  assignableUsers: Array<{ id: string; label: string }>;
  currentUserId: string;
  canAssignTaskAssignee: boolean;
  openDeals: Array<{
    id: string;
    title: string;
    stage: string;
    stageLabel: string;
    amount: string | null;
    companyName: string;
  }>;
  closedDeals: Array<{
    id: string;
    title: string;
    stage: string;
    stageLabel: string;
    amount: string | null;
    companyName: string;
    closedAt: string | null;
  }>;
  totals: {
    open: number;
    closedWon: number;
    closedLost: number;
    total: number;
  };
  salesMetrics: AdminOpsData["salesMetrics"];
  myWeek: RepWeeklyScorecardData | null;
};

export type HomeDashboardData = {
  persona: string;
  role: string;
  businessType: string;
  userId: string | null;
  title: string;
  subtitle: string;
  periodLabel: string;
  kpis: KpiCard[];
  pipelineBars: ChartSlice[];
  statusDonut: ChartSlice[];
  dueActivities: Array<{
    id: string;
    type: string;
    subject: string;
    dueAt: string | null;
    contactId: string;
    contactName: string;
  }>;
  openDeals: Array<{
    id: string;
    title: string;
    stage: string;
    amount: string | null;
    companyName: string;
  }>;
  openInvoices: Array<{
    id: string;
    number: string;
    total: string;
    currency: string;
    companyName: string;
    status: string;
  }>;
  recentContacts: Array<{
    id: string;
    displayName: string;
    email: string;
    contactType: string | null;
  }>;
  adminOps?: AdminOpsData | null;
  repOps?: RepOpsData | null;
  analytics: DashboardAnalyticsData;
};

export type CoachingInsightSummary = {
  id: string;
  activityId: string;
  contactId: string | null;
  overallImpression: string;
  discoveryQuality: string | null;
  objectionHandling: string | null;
  methodologyNote: string | null;
  talkBalanceNote: string | null;
  strengths: string[];
  growthAreas: string[];
  highlightedMoment: string | null;
  coachingNote: string;
  analyzedAt: string;
};

export type CoachingTrendRow = {
  repUserId: string;
  repName: string;
  strong: number;
  solid: number;
  needsWork: number;
  total: number;
};

export type DashboardFunnelSnapshot = {
  generatedAt: string | null;
  wonCount: number;
  lostCount: number;
  dealsByStage: Record<string, number>;
  lostReasons: Record<string, number>;
  quoteCounts: Record<string, number>;
  invoiceCounts: Record<string, number>;
};

export type DashboardAnalyticsData = {
  canSeeOrgSnapshot: boolean;
  funnelSnapshot: DashboardFunnelSnapshot | null;
  myCoaching: CoachingInsightSummary[];
  teamCoachingTrends: CoachingTrendRow[] | null;
};

export type HomeQuery = {
  lbMetric?: string;
  lbPeriod?: string;
  metricsPeriod?: string;
  untouchedHours?: string;
  teamGroup?: string;
  region?: string;
  repId?: string;
};

export async function fetchHomeDashboard(params?: HomeQuery) {
  const { data } = await api.get<{ ok: true; data: HomeDashboardData }>(
    "/api/home",
    { params },
  );
  return data.data;
}

export async function bulkAssignLeads(input: {
  contactIds: string[];
  ownerUserId: string;
}) {
  const { data } = await api.post<
    { ok: true; assigned?: number } | { ok: false; error: string }
  >("/api/home/ops/bulk-assign-leads", input);
  return data;
}

export async function autoAssignUntouchedLeads(input: {
  contactIds: string[];
}) {
  const { data } = await api.post<
    { ok: true; assigned?: number } | { ok: false; error: string }
  >("/api/home/ops/auto-assign-leads", input);
  return data;
}

export async function reassignDeal(input: {
  dealId: string;
  ownerUserId: string;
}) {
  const { data } = await api.post<
    { ok: true } | { ok: false; error: string }
  >("/api/home/ops/reassign-deal", input);
  return data;
}

export async function refreshFunnelSnapshot() {
  const { data } = await api.post<
    { ok: true; generatedAt: string } | { ok: false; error: string }
  >("/api/home/analytics/refresh");
  return data;
}

export type DailyBriefingResponse = {
  enabled: boolean;
  script?: string;
  playedAt?: string | null;
  briefingDate?: string;
};

export async function fetchDailyBriefing(): Promise<DailyBriefingResponse> {
  const { data, status } = await api.get<
    DailyBriefingResponse & { ok?: boolean; error?: string }
  >("/api/home/briefing");
  if (status >= 400 || data.ok === false) {
    throw new Error(data.error || "Failed to load briefing.");
  }
  return data;
}

export async function markDailyBriefingPlayed(): Promise<DailyBriefingResponse> {
  const { data } = await api.post<DailyBriefingResponse>(
    "/api/home/briefing/played",
  );
  return data;
}

export async function fetchDailyBriefingAudio(): Promise<ArrayBuffer> {
  const res = await fetch("/api/home/briefing/tts", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(typeof window !== "undefined" &&
      /\.ngrok-free\.(dev|app)$/i.test(window.location.hostname)
        ? { "ngrok-skip-browser-warning": "true" }
        : {}),
    },
    body: "{}",
  });
  const type = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  if (!res.ok) {
    throw new Error("Voice briefing is unavailable.");
  }
  const bytes = new Uint8Array(buf);
  if (type.includes("application/json") || bytes[0] === 0x7b) {
    throw new Error("Voice briefing is unavailable.");
  }
  return buf;
}

