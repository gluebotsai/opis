import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, MessageSquare, Phone, Plus, Radio } from "lucide-react";

import {
  SetupPageHeader,
  SetupStatCard,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import {
  EMAIL_CHANNEL_PRODUCT_IDS,
  getEmailEligibleProductCatalog,
  getProductName,
  getPurchasedProductCatalog,
} from "../../../lib/productCatalog.js";
import { listChannelConfigs } from "../../../lib/setup/setupApi.js";

const EMAIL_ALLOWED = new Set(EMAIL_CHANNEL_PRODUCT_IDS);

const COMING_SOON_CHANNELS = [
  {
    id: "voice",
    name: "Voice / Call",
    description:
      "CCaaS and CRM: map a DID to an agent or queue. Routing: Auto Attendant, Virtual Agent, or Human Agent.",
    icon: Phone,
  },
  {
    id: "social",
    name: "Social Media",
    description: "WhatsApp, Instagram, and Facebook via Meta. Used with CCaaS and Campaign.",
    icon: Radio,
  },
  {
    id: "sms",
    name: "SMS",
    description: "SMS gateway configuration (additional setup required).",
    icon: MessageSquare,
  },
];

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function statusLabel(status) {
  if (status === "active") return "Active";
  if (status === "pending") return "Pending";
  if (status === "inactive") return "Inactive";
  return status || "Unknown";
}

function displayEmailProductIds(productIds = []) {
  return (Array.isArray(productIds) ? productIds : []).filter((id) => EMAIL_ALLOWED.has(id));
}

function ccaasHandlerLabel(handler) {
  if (handler === "bot") return "Bot";
  if (handler === "human") return "Human";
  if (handler === "bot_then_human") return "Bot → Human";
  return "—";
}

export function SetupCommunicationPage() {
  const navigate = useNavigate();
  const { dashboard } = useCustomerDashboard();
  const purchasedProducts = useMemo(
    () => getPurchasedProductCatalog(dashboard?.activeProducts),
    [dashboard?.activeProducts],
  );
  const emailEligibleProducts = useMemo(
    () => getEmailEligibleProductCatalog(dashboard?.activeProducts),
    [dashboard?.activeProducts],
  );
  const purchasedIds = useMemo(() => new Set(purchasedProducts.map((p) => p.id)), [purchasedProducts]);
  const hasCcaas = purchasedIds.has("contact-center");
  const canConfigureEmail = emailEligibleProducts.length > 0;

  const [emailConfigs, setEmailConfigs] = useState([]);
  const [webchatConfigs, setWebchatConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    const [emails, webchats] = await Promise.all([
      listChannelConfigs("email"),
      hasCcaas ? listChannelConfigs("web_chat") : Promise.resolve([]),
    ]);
    setEmailConfigs(emails);
    setWebchatConfigs(webchats);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load channel configurations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when CCaaS purchase known
  }, [hasCcaas]);

  function openEmailConfig(config) {
    if (!config?.id) return;
    navigate(`/customer/setup/communication/email/${config.id}`);
  }

  function openWebchatConfig(config) {
    if (!config?.id) return;
    navigate(`/customer/setup/communication/web-chat/${config.id}`);
  }

  const activeEmailCount = emailConfigs.filter((cfg) => cfg.status === "active").length;
  const visibleComingSoon = COMING_SOON_CHANNELS;

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        copy="Configure communication channels for your products. Inbox, bots, and live routing stay in each product spoke."
        title="Channel Setup"
      />

      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          <section className="setup-form-panel">
            <div className="setup-entity-card__top">
              <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                <span className="setup-entity-card__icon">
                  <Mail size={18} />
                </span>
                <div>
                  <strong>Email</strong>
                  <p style={{ color: "var(--text-caption)", fontSize: "12px", margin: "4px 0 0" }}>
                    Third-party, own domain, or hosted — for Contact Centre and Campaign only.
                  </p>
                </div>
              </div>
              {canConfigureEmail ? (
                <button
                  className="primary-button"
                  onClick={() => navigate("/customer/setup/communication/email/new")}
                  type="button"
                >
                  <Plus size={16} />
                  Add email
                </button>
              ) : null}
            </div>

            {!canConfigureEmail ? (
              <p style={{ color: "var(--text-caption)", fontSize: "13px", margin: "12px 0 0" }}>
                Purchase Contact Centre or Campaign to configure email.
              </p>
            ) : null}

            {loading ? (
              <p style={{ fontSize: "13px", margin: canConfigureEmail ? 0 : "12px 0 0" }}>
                Loading email configurations…
              </p>
            ) : emailConfigs.length ? (
              <div className="setup-table-wrap" style={{ marginTop: "12px" }}>
                <table className="setup-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Method</th>
                      <th>Products</th>
                      <th>CCaaS handling</th>
                      <th>Address</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailConfigs.map((config) => (
                      <tr
                        className="setup-table-row--clickable"
                        key={config.id || config.name}
                        onClick={() => openEmailConfig(config)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openEmailConfig(config);
                          }
                        }}
                        role="link"
                        tabIndex={0}
                      >
                        <td>
                          <strong>{config.name}</strong>
                        </td>
                        <td>
                          {config.providerType === "third_party"
                            ? "Third-party"
                            : config.providerType === "custom_domain"
                              ? "Own domain"
                              : "Hosted"}
                        </td>
                        <td>
                          <div className="setup-chip-row">
                            {displayEmailProductIds(config.productIds).map((productId) => (
                              <span className="setup-chip" key={`${config.id}-${productId}`}>
                                {getProductName(productId)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {config.ccaasHandler ? (
                            <span className="setup-chip setup-chip--active">
                              {ccaasHandlerLabel(config.ccaasHandler)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{config.senderEmail || "—"}</td>
                        <td>
                          <SetupStatusBadge
                            status={statusLabel(config.status)}
                            tone={statusTone(config.status)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : canConfigureEmail ? (
              <p style={{ color: "var(--text-caption)", fontSize: "13px", margin: "12px 0 0" }}>
                No email configurations yet. Add one to connect a mailbox for Contact Centre or
                Campaign.
              </p>
            ) : null}
          </section>

          {hasCcaas ? (
            <section className="setup-form-panel" style={{ marginTop: "16px" }}>
              <div className="setup-entity-card__top">
                <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                  <span className="setup-entity-card__icon">
                    <MessageSquare size={18} />
                  </span>
                  <div>
                    <strong>Web Chat</strong>
                    <p style={{ color: "var(--text-caption)", fontSize: "12px", margin: "4px 0 0" }}>
                      Configure a chat widget for Contact Centre. Bot replies run in CCaaS.
                    </p>
                  </div>
                </div>
                <button
                  className="primary-button"
                  onClick={() => navigate("/customer/setup/communication/web-chat/new")}
                  type="button"
                >
                  <Plus size={16} />
                  Add widget
                </button>
              </div>

              {loading ? (
                <p style={{ fontSize: "13px", margin: "12px 0 0" }}>Loading web chat widgets…</p>
              ) : webchatConfigs.length ? (
                <div className="setup-table-wrap" style={{ marginTop: "12px" }}>
                  <table className="setup-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Alias</th>
                        <th>Webchat ID</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webchatConfigs.map((config) => (
                        <tr
                          className="setup-table-row--clickable"
                          key={config.id || config.webchatId}
                          onClick={() => openWebchatConfig(config)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openWebchatConfig(config);
                            }
                          }}
                          role="link"
                          tabIndex={0}
                        >
                          <td>
                            <strong>{config.title || config.name}</strong>
                          </td>
                          <td>{config.aliasTitle || "—"}</td>
                          <td>
                            <code style={{ fontSize: "12px" }}>{config.webchatId}</code>
                          </td>
                          <td>
                            <SetupStatusBadge
                              status={statusLabel(config.status)}
                              tone={statusTone(config.status)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: "var(--text-caption)", fontSize: "13px", margin: "12px 0 0" }}>
                  No web chat widgets yet. Add one to configure Basic Settings for Contact Centre.
                </p>
              )}
            </section>
          ) : null}

          <div className="setup-card-grid" style={{ marginTop: "16px" }}>
            {visibleComingSoon.map((channel) => {
              const Icon = channel.icon;
              return (
                <article className="setup-entity-card" key={channel.id}>
                  <div className="setup-entity-card__top">
                    <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                      <span className="setup-entity-card__icon">
                        <Icon size={18} />
                      </span>
                      <div>
                        <strong>{channel.name}</strong>
                        <p
                          style={{
                            color: "var(--text-caption)",
                            fontSize: "12px",
                            margin: "4px 0 0",
                          }}
                        >
                          Coming soon
                        </p>
                      </div>
                    </div>
                    <SetupStatusBadge status="Coming soon" tone="neutral" />
                  </div>
                  <p style={{ fontSize: "13px", margin: 0 }}>{channel.description}</p>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Email configs" value={emailConfigs.length} />
          <SetupStatCard label="Active email" value={activeEmailCount} />
          <SetupStatCard label="Web chat widgets" value={webchatConfigs.length} />
        </aside>
      </div>
    </section>
  );
}
