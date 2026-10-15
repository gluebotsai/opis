import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, LayoutDashboard, PlusCircle } from "lucide-react";
import { MarketingModulePage } from "@/components/marketing/MarketingModulePage";
import { fetchMarketingStatus } from "@/services/marketing";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { TONE_ACCENT } from "@/lib/ui-tones";

export function MarketingDashboardPage() {
  const [base, setBase] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    void fetchMarketingStatus()
      .then((data) => {
        setConfigured(data.configured);
        setBase(data.baseUrl);
      })
      .catch(() => {
        setConfigured(false);
        setBase(null);
      });
  }, []);

  const workspace = (
    <MarketingModulePage
      title="Dashboard"
      description="Overview of campaign performance for your branch."
      icon={LayoutDashboard}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Live", href: "/marketing/campaigns" },
          { label: "Scheduled", href: "/marketing/campaigns" },
          { label: "Past", href: "/marketing/campaigns" },
        ].map((card) => (
          <Link
            key={card.label}
            to={card.href}
            className="rounded-xl border border-border-default bg-surface p-5 transition-colors hover:border-border-strong"
          >
            <p className="text-sm text-text-caption">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
              —
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          to="/marketing/create"
          className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-4 hover:border-border-strong"
        >
          <span className={`inline-flex size-10 items-center justify-center rounded-lg ${TONE_ACCENT}`}>
            <PlusCircle className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              Create campaign
            </p>
            <p className="text-xs text-text-caption">Open create workspace</p>
          </div>
        </Link>
        <Link
          to="/marketing/campaigns"
          className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-4 hover:border-border-strong"
        >
          <span className={`inline-flex size-10 items-center justify-center rounded-lg ${TONE_ACCENT}`}>
            <Activity className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              Campaign monitoring
            </p>
            <p className="text-xs text-text-caption">
              Live, scheduled, and past campaigns
            </p>
          </div>
        </Link>
      </div>

      {configured && base ? (
        <p className="mt-6 text-sm text-text-caption">
          Standalone Campaign app:{" "}
          <a
            href={base}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-text-link hover:underline"
          >
            {base}
          </a>
        </p>
      ) : null}
    </MarketingModulePage>
  );

  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Marketing dashboard"
      welcome="I'm your **marketing agent**. Ask me to create a new campaign or check on performance — the dashboard stays fully usable on the right."
      chips={[
        {
          id: "chip-new-campaign",
          label: "Create a new campaign",
          prompt: "Help me create a new marketing campaign",
        },
      ]}
      surface="list"
      workspace={workspace}
    />
  );
}
