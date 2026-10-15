import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type CampaignStatus, type Prisma } from "@prisma/client";

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID?.trim() ||
  "00000000-0000-4000-8000-000000000001";

const SEED_USER_ID =
  process.env.SEED_USER_ID?.trim() ||
  "20000000-0000-4000-8000-000000000001";

const prisma = new PrismaClient();

/** Deterministic UUID v4-shaped id from a seed string. */
function demoUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `a${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

type DemoChannelRun = {
  sent?: number;
  failed?: number;
  opens?: number;
  clicks?: number;
  paused?: boolean;
  reason?: string | null;
  network?: "meta" | "google";
  impressions?: number;
  spend?: number;
  currency?: string;
  conversions?: number;
  daily_budget?: number;
  plan_summary?: string;
};

type DemoCampaign = {
  key: string;
  name: string;
  description: string;
  goal: string;
  objective: string;
  status: CampaignStatus;
  audienceCount: number;
  audienceSummary: string;
  /** Days offset from now for startsAt (ignored when startsAtIso set) */
  startsOffsetDays: number;
  /** Days offset from now for endsAt (null = none; ignored when endsAtIso set) */
  endsOffsetDays: number | null;
  /** Absolute ISO start (e.g. June synthetic month) */
  startsAtIso?: string;
  endsAtIso?: string | null;
  launchLocalDate?: string;
  channels: Array<{
    channel: string;
    howItWorks: string;
    run: DemoChannelRun;
  }>;
};

const DEMO_CAMPAIGNS: DemoCampaign[] = [
  {
    key: "live-summer-sale",
    name: "Demo · Summer Sale Blast",
    description: "Live email promo for summer SKUs.",
    goal: "Drive seasonal revenue",
    objective: "Increase checkout conversions this week",
    status: "live",
    audienceCount: 1200,
    audienceSummary: "Contacts in Chennai & Bangalore with email",
    startsOffsetDays: -3,
    endsOffsetDays: 11,
    channels: [
      {
        channel: "email",
        howItWorks: "Email drip with product highlights and limited-time offer.",
        run: { sent: 860, failed: 24, opens: 318, clicks: 74 },
      },
    ],
  },
  {
    key: "live-webinar-boost",
    name: "Demo · Webinar Boost Live",
    description: "Live invites + Meta PPC for next product webinar.",
    goal: "Fill webinar seats",
    objective: "Get 200 registrations",
    status: "live",
    audienceCount: 540,
    audienceSummary: "Trial users who have not attended a webinar",
    startsOffsetDays: -1,
    endsOffsetDays: 6,
    channels: [
      {
        channel: "email",
        howItWorks: "Single email invite with calendar CTA.",
        run: { sent: 310, failed: 8, opens: 142, clicks: 51 },
      },
      {
        channel: "ppc",
        howItWorks:
          "Meta Feed + Reels video plan — Register free · ages 28–50 India.",
        run: {
          network: "meta",
          impressions: 48200,
          clicks: 1260,
          spend: 18420,
          currency: "INR",
          conversions: 96,
          daily_budget: 3500,
          plan_summary:
            "Meta · leads · video · feed/reels · CTA Register free",
          sent: 0,
          failed: 0,
          opens: 0,
        },
      },
    ],
  },
  {
    key: "live-ppc-meta-leads",
    name: "Demo · Meta Leads PPC (Live)",
    description: "Published Meta lead-gen ads with synthetic spend outcomes.",
    goal: "Generate qualified demo leads",
    objective: "Drive webinar and demo sign-ups via Meta",
    status: "live",
    audienceCount: 0,
    audienceSummary: "Ages 25–45 · India · interests: SaaS / productivity",
    startsOffsetDays: -5,
    endsOffsetDays: 9,
    channels: [
      {
        channel: "ppc",
        howItWorks:
          "Meta image + feed placements. Headlines: Free live product demo · Reserve your webinar seat.",
        run: {
          network: "meta",
          impressions: 91200,
          clicks: 2410,
          spend: 31250,
          currency: "INR",
          conversions: 188,
          daily_budget: 5000,
          plan_summary:
            "Meta · leads · image · feed/stories · budget INR 5000/day",
        },
      },
    ],
  },
  {
    key: "live-ppc-google-search",
    name: "Demo · Google Search PPC (Live)",
    description: "Published Google Search ads with keyword match outcomes.",
    goal: "Capture high-intent CRM search traffic",
    objective: "Drive free-trial starts from Search",
    status: "live",
    audienceCount: 0,
    audienceSummary: "Search intent · India · CRM keywords",
    startsOffsetDays: -4,
    endsOffsetDays: 10,
    channels: [
      {
        channel: "ppc",
        howItWorks:
          "Google Search · phrase/exact keywords (crm software, sales crm free trial).",
        run: {
          network: "google",
          impressions: 22400,
          clicks: 980,
          spend: 27800,
          currency: "INR",
          conversions: 74,
          daily_budget: 8000,
          plan_summary:
            "Google · search · leads · keywords with phrase/exact match",
        },
      },
    ],
  },
  {
    key: "scheduled-festive",
    name: "Demo · Festive Early Access",
    description: "Scheduled festive early-bird email.",
    goal: "Warm audience before festival week",
    objective: "Announce early access window",
    status: "scheduled",
    audienceCount: 980,
    audienceSummary: "VIP + repeat buyers",
    startsOffsetDays: 5,
    endsOffsetDays: 12,
    channels: [
      {
        channel: "email",
        howItWorks: "Scheduled email with early-access code.",
        run: { sent: 0, failed: 0, opens: 0, clicks: 0 },
      },
    ],
  },
  {
    key: "scheduled-ppc-google",
    name: "Demo · Google Search PPC (Scheduled)",
    description: "Scheduled Google Search plan — not spending yet.",
    goal: "Launch Search ads for local service bookings",
    objective: "Drive appointment bookings in Chennai",
    status: "scheduled",
    audienceCount: 0,
    audienceSummary: "Geo: Chennai · ages 28–55",
    startsOffsetDays: 3,
    endsOffsetDays: 17,
    channels: [
      {
        channel: "ppc",
        howItWorks:
          "Google Search plan ready — keywords booked, spend starts on launch day.",
        run: {
          network: "google",
          impressions: 0,
          clicks: 0,
          spend: 0,
          currency: "INR",
          conversions: 0,
          daily_budget: 4000,
          plan_summary: "Google · search · traffic · scheduled",
        },
      },
    ],
  },
  {
    key: "scheduled-product-launch",
    name: "Demo · Product Launch Reminder",
    description: "Scheduled reminder before launch day.",
    goal: "Maximize launch-day awareness",
    objective: "Remind waitlist 48h before go-live",
    status: "scheduled",
    audienceCount: 1500,
    audienceSummary: "Waitlist contacts with verified email",
    startsOffsetDays: 2,
    endsOffsetDays: 4,
    channels: [
      {
        channel: "email",
        howItWorks: "Reminder email with launch countdown.",
        run: { sent: 0, failed: 0, opens: 0, clicks: 0 },
      },
    ],
  },
  {
    key: "past-onboarding",
    name: "Demo · Onboarding Nurture (Past)",
    description: "Completed onboarding series.",
    goal: "Activate new sign-ups",
    objective: "Complete profile setup",
    status: "completed",
    audienceCount: 800,
    audienceSummary: "New accounts created last month",
    startsOffsetDays: -40,
    endsOffsetDays: -10,
    channels: [
      {
        channel: "email",
        howItWorks: "Three-email onboarding sequence.",
        run: { sent: 780, failed: 12, opens: 421, clicks: 156 },
      },
    ],
  },
  {
    key: "past-reengagement",
    name: "Demo · Win-back Re-engagement (Past)",
    description: "Completed win-back campaign.",
    goal: "Reactivate dormant contacts",
    objective: "Bring back inactive buyers",
    status: "completed",
    audienceCount: 2100,
    audienceSummary: "No open in 90 days",
    startsOffsetDays: -60,
    endsOffsetDays: -25,
    channels: [
      {
        channel: "email",
        howItWorks: "Win-back offer email.",
        run: { sent: 1980, failed: 45, opens: 396, clicks: 88 },
      },
    ],
  },
  {
    key: "past-ppc-meta",
    name: "Demo · Meta Sales PPC (Past)",
    description: "Completed Meta sales campaign with final spend outcomes.",
    goal: "Drive seasonal product sales",
    objective: "Maximize ROAS on summer catalog",
    status: "completed",
    audienceCount: 0,
    audienceSummary: "Lookalike buyers · Chennai & Bangalore",
    startsOffsetDays: -35,
    endsOffsetDays: -7,
    channels: [
      {
        channel: "ppc",
        howItWorks:
          "Meta Feed sales plan — completed run with synthetic outcomes.",
        run: {
          network: "meta",
          impressions: 156000,
          clicks: 4120,
          spend: 68400,
          currency: "INR",
          conversions: 312,
          daily_budget: 6000,
          plan_summary: "Meta · sales · image · feed · completed",
        },
      },
    ],
  },
  // —— June 2026 synthetic month (dashboard Monthly = previous calendar month) ——
  {
    key: "june-email-midyear",
    name: "Demo · June Mid-Year Email",
    description: "June synthetic email blast for dashboard monthly view.",
    goal: "Mid-year engagement",
    objective: "Re-activate dormant subscribers in June",
    status: "completed",
    audienceCount: 8400,
    audienceSummary: "All opted-in email contacts · India",
    startsOffsetDays: 0,
    endsOffsetDays: null,
    startsAtIso: "2026-06-05T06:30:00.000Z",
    endsAtIso: "2026-06-12T18:00:00.000Z",
    launchLocalDate: "2026-06-05",
    channels: [
      {
        channel: "email",
        howItWorks: "June mid-year newsletter with product picks.",
        run: { sent: 7840, failed: 112, opens: 2980, clicks: 640 },
      },
    ],
  },
  {
    key: "june-webinar-combo",
    name: "Demo · June Webinar Combo",
    description: "June email + Meta leads for product webinar.",
    goal: "Fill June webinar",
    objective: "400 registrations in June",
    status: "completed",
    audienceCount: 2200,
    audienceSummary: "Trial users · June cohort",
    startsOffsetDays: 0,
    endsOffsetDays: null,
    startsAtIso: "2026-06-10T04:00:00.000Z",
    endsAtIso: "2026-06-18T16:00:00.000Z",
    launchLocalDate: "2026-06-10",
    channels: [
      {
        channel: "email",
        howItWorks: "Webinar invite + reminder sequence.",
        run: { sent: 2050, failed: 38, opens: 920, clicks: 310 },
      },
      {
        channel: "ppc",
        howItWorks: "Meta leads for June webinar registration.",
        run: {
          network: "meta",
          impressions: 186500,
          clicks: 5240,
          spend: 62400,
          currency: "INR",
          conversions: 268,
          daily_budget: 4500,
          plan_summary: "Meta · leads · June webinar · feed/reels",
          sent: 0,
          failed: 0,
          opens: 0,
        },
      },
    ],
  },
  {
    key: "june-google-search",
    name: "Demo · June Google Search PPC",
    description: "June Search ads with synthetic spend outcomes.",
    goal: "Capture June search intent",
    objective: "Trial starts from CRM keywords",
    status: "completed",
    audienceCount: 0,
    audienceSummary: "Search · India · CRM keywords",
    startsOffsetDays: 0,
    endsOffsetDays: null,
    startsAtIso: "2026-06-01T05:00:00.000Z",
    endsAtIso: "2026-06-30T18:00:00.000Z",
    launchLocalDate: "2026-06-01",
    channels: [
      {
        channel: "ppc",
        howItWorks: "Google Search · June full-month campaign.",
        run: {
          network: "google",
          impressions: 98400,
          clicks: 4120,
          spend: 142800,
          currency: "INR",
          conversions: 286,
          daily_budget: 5500,
          plan_summary: "Google · search · June · phrase/exact",
        },
      },
    ],
  },
  {
    key: "june-app-push-flash",
    name: "Demo · June App Push Flash",
    description: "June mobile push flash sale (synthetic outcomes).",
    goal: "App re-engagement",
    objective: "Drive June flash checkout opens",
    status: "completed",
    audienceCount: 15600,
    audienceSummary: "App users with push enabled",
    startsOffsetDays: 0,
    endsOffsetDays: null,
    startsAtIso: "2026-06-20T08:00:00.000Z",
    endsAtIso: "2026-06-22T20:00:00.000Z",
    launchLocalDate: "2026-06-20",
    channels: [
      {
        channel: "push",
        howItWorks: "Two-day flash push with deep link to sale.",
        run: { sent: 14820, failed: 210, opens: 5210, clicks: 1180 },
      },
    ],
  },
  {
    key: "june-web-push-restock",
    name: "Demo · June Web Push Restock",
    description: "June browser push for restock alerts.",
    goal: "Recover waitlist interest",
    objective: "Notify waitlist when SKUs return",
    status: "completed",
    audienceCount: 4300,
    audienceSummary: "Web push subscribers · wishlist",
    startsOffsetDays: 0,
    endsOffsetDays: null,
    startsAtIso: "2026-06-15T07:00:00.000Z",
    endsAtIso: "2026-06-16T19:00:00.000Z",
    launchLocalDate: "2026-06-15",
    channels: [
      {
        channel: "web",
        howItWorks: "Browser notification with product CTA.",
        run: { sent: 3920, failed: 45, opens: 1680, clicks: 420 },
      },
    ],
  },
];

function dayOffset(days: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function resolveDemoDates(demo: DemoCampaign): {
  startsAt: Date;
  endsAt: Date | null;
  launchLocalDate: string | null;
} {
  if (demo.startsAtIso) {
    return {
      startsAt: new Date(demo.startsAtIso),
      endsAt: demo.endsAtIso ? new Date(demo.endsAtIso) : null,
      launchLocalDate: demo.launchLocalDate ?? null,
    };
  }
  return {
    startsAt: dayOffset(demo.startsOffsetDays),
    endsAt:
      demo.endsOffsetDays === null ? null : dayOffset(demo.endsOffsetDays),
    launchLocalDate: demo.launchLocalDate ?? null,
  };
}

async function ensureDefaultBranch() {
  const branch = await prisma.branch.upsert({
    where: { id: "10000000-0000-4000-8000-000000000001" },
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      organizationId: DEFAULT_TENANT_ID,
      name: "Default",
      isDefault: true,
    },
    update: {
      name: "Default",
      isDefault: true,
    },
  });

  for (const productCode of ["campaign", "crm"] as const) {
    await prisma.organizationProduct.upsert({
      where: {
        organizationId_branchId_productCode: {
          organizationId: branch.organizationId,
          branchId: branch.id,
          productCode,
        },
      },
      create: {
        organizationId: branch.organizationId,
        branchId: branch.id,
        productCode,
        status: "active",
        startsAt: new Date(),
      },
      update: {
        status: "active",
      },
    });
  }

  return branch;
}

function buildChannelRunRow(run: DemoChannelRun): Record<string, unknown> {
  const row: Record<string, unknown> = {
    sent: run.sent ?? 0,
    failed: run.failed ?? 0,
    opens: run.opens ?? 0,
    clicks: run.clicks ?? 0,
    paused: Boolean(run.paused),
    reason: run.reason ?? null,
    paused_at: null,
  };
  if (run.network) row.network = run.network;
  if (run.impressions != null) row.impressions = run.impressions;
  if (run.spend != null) row.spend = run.spend;
  if (run.currency) row.currency = run.currency;
  if (run.conversions != null) row.conversions = run.conversions;
  if (run.daily_budget != null) row.daily_budget = run.daily_budget;
  if (run.plan_summary) row.plan_summary = run.plan_summary;
  return row;
}

async function seedDemoCampaignsForBranch(branch: {
  id: string;
  organizationId: string;
}) {
  for (const demo of DEMO_CAMPAIGNS) {
    const campaignId = demoUuid(`${branch.id}:${demo.key}`);
    const { startsAt, endsAt, launchLocalDate } = resolveDemoDates(demo);

    const channelRun: Record<string, unknown> = {};
    for (const ch of demo.channels) {
      channelRun[ch.channel] = buildChannelRunRow(ch.run);
    }

    const launchPlan: Prisma.InputJsonValue = {
      schedule_mode: demo.status === "scheduled" ? "later" : "now",
      scheduled_at: startsAt.toISOString(),
      launch_channels: demo.channels.map((c) => c.channel),
      ab_enabled: false,
      channel_run: channelRun,
      ...(launchLocalDate
        ? { launch_local_date: launchLocalDate, timezone: "Asia/Kolkata" }
        : {}),
    };

    await prisma.campaign.upsert({
      where: { id: campaignId },
      create: {
        id: campaignId,
        organizationId: branch.organizationId,
        branchId: branch.id,
        name: demo.name,
        description: demo.description,
        goal: demo.goal,
        objective: demo.objective,
        audienceSummary: demo.audienceSummary,
        audienceCount: demo.audienceCount,
        status: demo.status,
        startsAt,
        endsAt,
        timezone: "Asia/Kolkata",
        launchLocalDate,
        launchLocalTime: launchLocalDate ? "12:00" : null,
        sourceChannel: "standalone_campaign",
        createdByUserId: SEED_USER_ID,
        launchPlan,
      },
      update: {
        name: demo.name,
        description: demo.description,
        goal: demo.goal,
        objective: demo.objective,
        audienceSummary: demo.audienceSummary,
        audienceCount: demo.audienceCount,
        status: demo.status,
        startsAt,
        endsAt,
        timezone: "Asia/Kolkata",
        launchLocalDate,
        launchLocalTime: launchLocalDate ? "12:00" : null,
        launchPlan,
      },
    });

    for (const ch of demo.channels) {
      const channelId = demoUuid(`${branch.id}:${demo.key}:${ch.channel}`);
      await prisma.campaignChannel.upsert({
        where: {
          campaignId_channel: { campaignId, channel: ch.channel },
        },
        create: {
          id: channelId,
          campaignId,
          organizationId: branch.organizationId,
          channel: ch.channel,
          howItWorks: ch.howItWorks,
          plannedLaunchAt: startsAt.toISOString(),
          status: "ready",
        },
        update: {
          howItWorks: ch.howItWorks,
          plannedLaunchAt: startsAt.toISOString(),
          status: "ready",
        },
      });
    }
  }
}

async function main() {
  await ensureDefaultBranch();

  const branches = await prisma.branch.findMany({
    select: { id: true, organizationId: true, name: true },
  });

  for (const branch of branches) {
    await seedDemoCampaignsForBranch(branch);
    console.log(
      `Seeded ${DEMO_CAMPAIGNS.length} demo campaigns for tenant=${branch.organizationId} branch=${branch.id}`,
    );
  }

  console.log(
    `Done. Demo campaigns include email + PPC with synthetic spend/impressions/conversions in launch_plan.channel_run.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
