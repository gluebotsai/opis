// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Send } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import {
  DEFAULT_UAT_DURATION_DAYS,
  UAT_DURATION_OPTIONS_DAYS,
  extendLeadUatAccess,
  fetchLeadGoLiveProducts,
  goLiveStatusLabel,
  sendLeadUatAccess,
} from "../lib/goLive.js";

import "../styles/admin-users-light.css";
import "../styles/implementation-uat.css";

function goLiveStatusPillModifier(status) {
  switch (status) {
    case "awaiting_implementation":
      return "progress";
    case "uat":
      return "info";
    case "uat_expired":
      return "caution";
    case "awaiting_subscription_payment":
      return "info";
    case "live":
      return "success";
    default:
      return "neutral";
  }
}

function StatusPill({ status }) {
  const modifier = goLiveStatusPillModifier(status);
  return (
    <span
      className={`implementation-uat-status-pill implementation-uat-status-pill--${modifier}`}
    >
      <span className="implementation-uat-status-pill__dot" aria-hidden="true" />
      {goLiveStatusLabel(status)}
    </span>
  );
}

function draftFromProduct(product) {
  const credentials = product?.uatCredentials || {};
  return {
    portalUrl: credentials.portalUrl || credentials.portal_url || "",
    username: credentials.username || "",
    password: credentials.password || "",
    notes: credentials.notes || credentials.note || "",
    durationDays: Number(credentials.durationDays) || DEFAULT_UAT_DURATION_DAYS,
  };
}

function updateDraft(setCredentialDrafts, productId, draft, patch) {
  setCredentialDrafts((current) => ({
    ...current,
    [productId]: { ...draft, ...patch },
  }));
}

export function ImplementationUatPage() {
  const { leadId } = useParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionId, setActionId] = useState("");
  const [credentialDrafts, setCredentialDrafts] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLeadGoLiveProducts(leadId);
      const nextProducts = Array.isArray(data?.products) ? data.products : [];
      setProducts(nextProducts);
      setCredentialDrafts((current) => {
        const next = { ...current };
        for (const product of nextProducts) {
          if (!next[product.id]) {
            next[product.id] = draftFromProduct(product);
          }
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load UAT products.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSendUat(product) {
    setActionId(product.id);
    setError("");
    setSuccess("");
    try {
      const draft = credentialDrafts[product.id] || draftFromProduct(product);
      const durationDays = Number(draft.durationDays) || DEFAULT_UAT_DURATION_DAYS;
      const result = await sendLeadUatAccess(leadId, product.id, {
        credentials: {
          portalUrl: draft.portalUrl || "",
          username: draft.username || "",
          password: draft.password || "",
          notes: draft.notes || "",
        },
        note: draft.notes || "",
        durationDays,
      });
      setSuccess(
        result?.notificationQueued !== false
          ? `UAT access sent. Customer email is being sent (valid ${durationDays} days).`
          : "UAT access saved, but customer email could not be queued. Check mail worker / outbox and try again.",
      );
      await refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send UAT.");
    } finally {
      setActionId("");
    }
  }

  async function handleExtend(product) {
    setActionId(product.id);
    setError("");
    setSuccess("");
    try {
      const draft = credentialDrafts[product.id] || draftFromProduct(product);
      const durationDays = Number(draft.durationDays) || DEFAULT_UAT_DURATION_DAYS;
      const result = await extendLeadUatAccess(leadId, product.id, {
        credentials: {
          portalUrl: draft.portalUrl || "",
          username: draft.username || "",
          password: draft.password || "",
          notes: draft.notes || "",
        },
        note: draft.notes || "",
        durationDays,
      });
      setSuccess(
        result?.notificationQueued !== false
          ? `UAT extended by ${durationDays} days. Customer email is being sent.`
          : `UAT extended by ${durationDays} days, but customer email could not be queued.`,
      );
      await refresh();
    } catch (extendError) {
      setError(extendError instanceof Error ? extendError.message : "Could not extend UAT.");
    } finally {
      setActionId("");
    }
  }

  const productCount = products.length;
  const panelSubtitle = loading
    ? "Loading products…"
    : productCount
      ? `${productCount} product${productCount === 1 ? "" : "s"} — choose duration and send portal credentials after implementation fee is paid`
      : "No products yet";

  return (
    <section className="admin-users-page implementation-uat-page">
      <header className="admin-users-page__header implementation-uat-page__header">
        <div className="implementation-uat-page__header-text">
          <h1>Implementation / UAT</h1>
          <p className="admin-users-page__subtitle">
            After the implementation fee is paid, send product UAT credentials for one product at a
            time. Choose how long access lasts. My Accounts portal login does not expire.
          </p>
        </div>
        <div className="implementation-uat-page__actions">
          <Link className="secondary-button" to={`/customers/${leadId}`}>
            <ArrowLeft size={16} />
            Back to customer
          </Link>
          <button className="secondary-button" onClick={() => void refresh()} type="button">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setSuccess("");
        }}
        success={success}
        variant="pill"
      />

      <div className="admin-users-panel implementation-uat-panel">
        <div className="admin-users-panel__section-header">
          <div>
            <h2>Products</h2>
            <p>{panelSubtitle}</p>
          </div>
        </div>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="implementation-uat-loading" role="status">
              Loading…
            </p>
          ) : null}

          {!loading && !products.length ? (
            <p className="implementation-uat-empty">
              No implementation / UAT products yet. They appear after an implementation-fee invoice
              is paid.
            </p>
          ) : null}

          {!loading && products.length ? (
            <div className="implementation-uat-list">
              {products.map((product) => {
                const draft = credentialDrafts[product.id] || draftFromProduct(product);
                const canSend = product.lifecycleStatus === "awaiting_implementation";
                const canExtend = product.lifecycleStatus === "uat_expired";
                const showCredentialForm = canSend || canExtend;
                const busy = actionId === product.id;
                const activeUat = product.lifecycleStatus === "uat";

                return (
                  <article className="implementation-uat-section" key={product.id}>
                    <div className="implementation-uat-section__head">
                      <div className="implementation-uat-section__title-block">
                        <h3 className="implementation-uat-section__title">
                          {product.productId} · {product.branchId}
                        </h3>
                        {product.uatExpiresAt ? (
                          <p className="implementation-uat-section__meta">
                            UAT expires {new Date(product.uatExpiresAt).toLocaleString()}
                          </p>
                        ) : null}
                        {activeUat ? (
                          <p className="implementation-uat-section__meta">
                            UAT is active. Send controls are hidden until access expires.
                          </p>
                        ) : null}
                      </div>
                      <StatusPill status={product.lifecycleStatus} />
                    </div>

                    {product.changeRequestNote ? (
                      <p className="implementation-uat-notice">
                        Change request: {product.changeRequestNote}
                      </p>
                    ) : null}

                    {showCredentialForm ? (
                      <div className="implementation-uat-fields">
                        <label className="admin-users-field">
                          <span>UAT duration</span>
                          <select
                            onChange={(event) =>
                              updateDraft(setCredentialDrafts, product.id, draft, {
                                durationDays: Number(event.target.value),
                              })
                            }
                            value={draft.durationDays || DEFAULT_UAT_DURATION_DAYS}
                          >
                            {UAT_DURATION_OPTIONS_DAYS.map((days) => (
                              <option key={days} value={days}>
                                {days} days
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="admin-users-field admin-users-field--full">
                          <span>Product portal URL</span>
                          <input
                            onChange={(event) =>
                              updateDraft(setCredentialDrafts, product.id, draft, {
                                portalUrl: event.target.value,
                              })
                            }
                            placeholder="https://"
                            type="url"
                            value={draft.portalUrl || ""}
                          />
                        </label>
                        <label className="admin-users-field">
                          <span>Username</span>
                          <input
                            autoComplete="off"
                            onChange={(event) =>
                              updateDraft(setCredentialDrafts, product.id, draft, {
                                username: event.target.value,
                              })
                            }
                            value={draft.username || ""}
                          />
                        </label>
                        <label className="admin-users-field">
                          <span>Password</span>
                          <input
                            autoComplete="new-password"
                            onChange={(event) =>
                              updateDraft(setCredentialDrafts, product.id, draft, {
                                password: event.target.value,
                              })
                            }
                            type="text"
                            value={draft.password || ""}
                          />
                        </label>
                        <label className="admin-users-field admin-users-field--full">
                          <span>Notes</span>
                          <input
                            onChange={(event) =>
                              updateDraft(setCredentialDrafts, product.id, draft, {
                                notes: event.target.value,
                              })
                            }
                            value={draft.notes || ""}
                          />
                        </label>
                      </div>
                    ) : null}

                    {canSend || canExtend ? (
                      <div className="implementation-uat-section__actions">
                        {canSend ? (
                          <button
                            className="primary-button"
                            disabled={busy}
                            onClick={() => void handleSendUat(product)}
                            type="button"
                          >
                            <Send size={16} />
                            Send UAT
                          </button>
                        ) : null}
                        {canExtend ? (
                          <button
                            className="primary-button"
                            disabled={busy}
                            onClick={() => void handleExtend(product)}
                            type="button"
                          >
                            <Send size={16} />
                            Extend UAT
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
