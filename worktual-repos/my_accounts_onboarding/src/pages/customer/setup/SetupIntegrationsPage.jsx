import {
  Calendar,
  CreditCard,
  Database,
  MessageSquare,
  Phone,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import { useSetupWorkspace } from "../../../lib/setup/SetupWorkspaceContext.jsx";
import {
  SetupPageHeader,
  SetupStatCard,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";

const ICON_MAP = {
  database: Database,
  sparkles: Sparkles,
  "shopping-bag": ShoppingBag,
  calendar: Calendar,
  "credit-card": CreditCard,
  "message-square": MessageSquare,
  phone: Phone,
};

function getIntegrationIcon(iconName) {
  return ICON_MAP[iconName] || Database;
}

export function SetupIntegrationsPage() {
  const { integrations, toggleIntegration } = useSetupWorkspace();

  const connectedCount = integrations.filter((item) => item.connected).length;

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        copy="Connect third-party platforms for CRM sync, payments, calendars, and messaging."
        title="Integrations"
      />

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          <div className="setup-card-grid">
            {integrations.map((integration) => {
              const Icon = getIntegrationIcon(integration.iconName);

              return (
                <article className="setup-entity-card" key={integration.id}>
                  <div className="setup-entity-card__top">
                    <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                      <span className="setup-entity-card__icon">
                        <Icon size={18} />
                      </span>
                      <div>
                        <strong>{integration.name}</strong>
                        <p
                          style={{
                            color: "var(--text-caption)",
                            fontSize: "12px",
                            margin: "4px 0 0",
                          }}
                        >
                          {integration.category}
                        </p>
                      </div>
                    </div>
                    <SetupStatusBadge
                      status={integration.connected ? "Connected" : "Disconnected"}
                      tone={integration.connected ? "success" : "neutral"}
                    />
                  </div>

                  <p style={{ fontSize: "13px", margin: 0 }}>{integration.description}</p>

                  <button
                    className={integration.connected ? "secondary-button" : "primary-button"}
                    onClick={() => toggleIntegration(integration.id)}
                    type="button"
                  >
                    {integration.connected ? "Disconnect" : "Connect"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Integrations" value={integrations.length} />
          <SetupStatCard label="Connected" value={connectedCount} />
          <SetupStatCard label="Available" value={integrations.length - connectedCount} />
        </aside>
      </div>
    </section>
  );
}
