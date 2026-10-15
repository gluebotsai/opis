import Link from "next/link";
import { Activity, LayoutDashboard } from "lucide-react";
import { requireCampaignSession } from "@/server/auth/login-action";
import { prisma } from "@/server/db/prisma";
import { ModulePage } from "@/components/layout/ModulePage";

export default async function DashboardPage() {
  const session = await requireCampaignSession();

  const [live, scheduled, draft, past] = await Promise.all([
    prisma.campaign.count({
      where: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        status: "live",
      },
    }),
    prisma.campaign.count({
      where: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        status: "scheduled",
      },
    }),
    prisma.campaign.count({
      where: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        status: "draft",
      },
    }),
    prisma.campaign.count({
      where: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        status: { in: ["completed", "cancelled"] },
      },
    }),
  ]);

  const cards = [
    { label: "Live", value: live, href: "/campaigns?tab=live" },
    {
      label: "Scheduled",
      value: scheduled + draft,
      href: "/campaigns?tab=scheduled",
    },
    { label: "Past", value: past, href: "/campaigns?tab=past" },
  ];

  return (
    <ModulePage
      title="Dashboard"
      description="Overview of campaign performance for your branch."
      icon={LayoutDashboard}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-border-default bg-surface p-5 transition-colors hover:border-border-strong"
          >
            <p className="text-sm text-text-caption">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
              {card.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Link
          href="/campaigns"
          className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-4 hover:border-border-strong"
        >
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Activity className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              Campaign monitoring
            </p>
            <p className="text-xs text-text-caption">
              Review live, scheduled, and past campaigns
            </p>
          </div>
        </Link>
      </div>
    </ModulePage>
  );
}
