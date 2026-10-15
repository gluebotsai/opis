// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { Headphones, MessageSquarePlus, Ticket, X } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { SideOverlayDraftIsland } from "../../components/SideOverlayDraftIsland.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import { useSideOverlayDraftDismiss } from "../../hooks/useSideOverlayDraftDismiss.js";
import {
  ACCOUNT_PRODUCT_VALUE,
  SUPPORT_DATE_FILTERS,
  SUPPORT_STATUS_OPTIONS,
  buildSupportProductOptions,
  findSupportProductOption,
  getCategoryLabel,
  getSupportCategories,
  getSupportPriorityLabel,
  getSupportStatusLabel,
  supportPriorityClassName,
  supportStatusClassName,
} from "../../lib/productSupport.js";
import { isSupportRaiseTicketFormEmpty } from "../../lib/sideOverlayFormDraft.js";
import {
  createSupportTicket,
  getMySupportTicket,
  listMySupportTickets,
  replyToSupportTicket,
} from "../../lib/supportTickets.js";
import { getCustomerSession } from "../../lib/customerAuth.js";
import { subscribeToAppEvents } from "../../lib/eventStream.js";
import "../../styles/admin-users-light.css";

function formatTicketDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const EMPTY_RAISE_TICKET_FORM = {
  productSelection: ACCOUNT_PRODUCT_VALUE,
  category: "",
  subject: "",
  description: "",
  unableToUse: false,
  startedAfterChange: false,
};

function RaiseTicketOverlay({ dashboard, lead, onClose, onCreated }) {
  const session = getCustomerSession();
  const productOptions = useMemo(
    () => buildSupportProductOptions(dashboard?.activeProducts || []),
    [dashboard?.activeProducts],
  );

  const [form, setForm] = useState({ ...EMPTY_RAISE_TICKET_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [minimized, setMinimized] = useState(false);

  const categories = useMemo(
    () => getSupportCategories(form.productSelection, dashboard?.activeProducts || []),
    [form.productSelection, dashboard?.activeProducts],
  );

  useEffect(() => {
    if (!categories.some((entry) => entry.value === form.category)) {
      setForm((current) => ({
        ...current,
        category: categories[0]?.value || "",
      }));
    }
  }, [categories, form.category]);

  const resetForm = useCallback(() => {
    setForm({ ...EMPTY_RAISE_TICKET_FORM });
    setApiError("");
    setFieldErrors({});
    setMinimized(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose?.();
  }, [onClose, resetForm]);

  const isOverlayDirty = useCallback(
    () => !isSupportRaiseTicketFormEmpty(form),
    [form],
  );

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    isBusy: submitting,
    isDirty: isOverlayDirty,
    minimized,
    onClose: handleClose,
    onExpand: () => setMinimized(false),
    onMinimize: () => setMinimized(true),
  });

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (apiError) {
      setApiError("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setApiError("");

    const selectedProduct = findSupportProductOption(productOptions, form.productSelection);
    const nextErrors = {};

    if (!form.subject.trim()) {
      nextErrors.subject = "Subject is required.";
    }
    if (!form.description.trim()) {
      nextErrors.description = "Description is required.";
    }
    if (!form.category) {
      nextErrors.category = "Category is required.";
    }

    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSupportTicket({
        subscriptionId: selectedProduct?.subscriptionId || null,
        productId: selectedProduct?.productId || null,
        subscriptionKey: selectedProduct?.subscriptionKey || null,
        productLabel: selectedProduct?.label || "Account & billing",
        category: form.category,
        priority: "medium",
        subject: form.subject.trim(),
        description: form.description.trim(),
        unableToUse: form.unableToUse,
        startedAfterChange: form.startedAfterChange,
        tenantId: dashboard?.contact?.tenantId || lead?.tenantId || "",
        companyName: dashboard?.contact?.companyName || "",
        contactEmail: dashboard?.contact?.workEmail || session?.email || "",
      });

      resetForm();
      onCreated?.(result.ticket);
    } catch (submitError) {
      setApiError(submitError instanceof Error ? submitError.message : "Could not create ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  if (minimized) {
    if (!isOverlayDirty()) {
      return null;
    }

    return (
      <SideOverlayDraftIsland
        draftKind="create"
        icon={MessageSquarePlus}
        label="Raise ticket"
        onDiscard={discardDraft}
        onOpen={expandDraft}
      />
    );
  }

  return (
    <div
      aria-label="Raise support ticket"
      aria-modal="true"
      className="admin-side-overlay customer-support-raise-overlay"
      role="dialog"
    >
      <button
        aria-label="Minimize form to draft"
        className="admin-side-overlay__backdrop"
        disabled={submitting}
        onClick={requestDismiss}
        type="button"
      />
      <section className="admin-side-overlay__panel">
        <header className="admin-side-overlay__header">
          <div>
            <h2>Raise ticket</h2>
            <p>Tell us which product needs help and describe the issue.</p>
          </div>
          <button
            aria-label="Close"
            className="admin-users-panel__icon-button"
            disabled={submitting}
            onClick={requestDismiss}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="admin-users-form admin-side-overlay__form" onSubmit={handleSubmit}>
          <div className="admin-side-overlay__body">
            {apiError ? <p className="admin-side-overlay__alert">{apiError}</p> : null}

            <div className="admin-users-form__grid">
              <label
                className={`field field--full${fieldErrors.product ? " field--invalid" : ""}`}
              >
                <span>Product *</span>
                <select
                  onChange={(event) => updateField("productSelection", event.target.value)}
                  value={form.productSelection}
                >
                  {productOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className={`field field--full${fieldErrors.category ? " field--invalid" : ""}`}
              >
                <span>Category *</span>
                <select
                  onChange={(event) => updateField("category", event.target.value)}
                  value={form.category}
                >
                  {categories.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.category ? (
                  <span className="field__error">{fieldErrors.category}</span>
                ) : null}
              </label>

              <label
                className={`field field--full${fieldErrors.subject ? " field--invalid" : ""}`}
              >
                <span>Subject *</span>
                <input
                  onChange={(event) => updateField("subject", event.target.value)}
                  placeholder="Short summary of the issue"
                  value={form.subject}
                />
                {fieldErrors.subject ? (
                  <span className="field__error">{fieldErrors.subject}</span>
                ) : null}
              </label>

              <label
                className={`field field--full${fieldErrors.description ? " field--invalid" : ""}`}
              >
                <span>Description *</span>
                <textarea
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="Include steps to reproduce, error messages, and when it started."
                  rows={6}
                  value={form.description}
                />
                {fieldErrors.description ? (
                  <span className="field__error">{fieldErrors.description}</span>
                ) : null}
              </label>

              <div className="customer-support-checkboxes field--full">
                <label className="checkbox-field">
                  <input
                    checked={form.unableToUse}
                    onChange={(event) => updateField("unableToUse", event.target.checked)}
                    type="checkbox"
                  />
                  <span>I am unable to use the product</span>
                </label>
                <label className="checkbox-field">
                  <input
                    checked={form.startedAfterChange}
                    onChange={(event) => updateField("startedAfterChange", event.target.checked)}
                    type="checkbox"
                  />
                  <span>This started after a recent change</span>
                </label>
              </div>
            </div>

            <aside className="customer-support-context customer-support-context--overlay">
              <h3>Your account context</h3>
              <dl className="customer-support-context__details">
                <div>
                  <dt>Company</dt>
                  <dd>{dashboard?.contact?.companyName || "—"}</dd>
                </div>
                <div>
                  <dt>Tenant ID</dt>
                  <dd>{dashboard?.contact?.tenantId || "—"}</dd>
                </div>
                <div>
                  <dt>Contact email</dt>
                  <dd>{dashboard?.contact?.workEmail || session?.email || "—"}</dd>
                </div>
                <div>
                  <dt>Active products</dt>
                  <dd>{dashboard?.summary?.activeProductCount ?? 0}</dd>
                </div>
              </dl>
            </aside>
          </div>

          <div className="admin-side-overlay__footer">
            <button
              className="secondary-button"
              disabled={submitting}
              onClick={requestDismiss}
              type="button"
            >
              Cancel
            </button>
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? "Submitting…" : "Submit ticket"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MyTicketsPanel({
  dashboard,
  onOpenRaiseTicket,
  refreshNonce = 0,
  focusTicketId = "",
}) {
  const session = getCustomerSession();
  const organizationId = session?.organizationId || null;
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("30");
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  const productFilterOptions = useMemo(() => {
    const uniqueProducts = new Map();
    uniqueProducts.set("all", "All products");
    uniqueProducts.set("account", "Account & billing");

    for (const entry of dashboard?.activeProducts || []) {
      uniqueProducts.set(entry.productId, entry.productName);
    }

    return [...uniqueProducts.entries()].map(([value, label]) => ({ value, label }));
  }, [dashboard?.activeProducts]);

  const loadTickets = useCallback(async ({ silent = false, preferTicketId = "" } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");
    try {
      const rows = await listMySupportTickets({
        status: statusFilter,
        productId: productFilter,
        days: dateFilter,
      });
      setTickets(rows);
      setSelectedId((current) => {
        if (!rows.length) {
          return "";
        }
        if (preferTicketId && rows.some((entry) => entry.id === preferTicketId)) {
          return preferTicketId;
        }
        if (rows.some((entry) => entry.id === current)) {
          return current;
        }
        return rows[0].id;
      });
      if (!rows.length) {
        setDetail(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tickets.");
      setTickets([]);
      setDetail(null);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [statusFilter, productFilter, dateFilter]);

  useEffect(() => {
    void loadTickets({ preferTicketId: focusTicketId });
  }, [loadTickets, refreshNonce, focusTicketId]);

  useEffect(() => {
    return subscribeToAppEvents({
      channels: ["tickets"],
      onEvent: (payload) => {
        if (
          organizationId &&
          payload.organizationId &&
          String(payload.organizationId) !== String(organizationId)
        ) {
          return;
        }
        if (
          payload.event === "ticket.created" ||
          payload.event === "ticket.message.created" ||
          payload.event === "ticket.status.changed"
        ) {
          void loadTickets({ silent: true, preferTicketId: focusTicketId });
          const ticketId = payload.ticketId;
          if (ticketId && ticketId === selectedId) {
            void getMySupportTicket(ticketId)
              .then((next) => {
                if (next?.ticket?.id === selectedId) {
                  setDetail(next);
                }
              })
              .catch(() => {});
          }
        }
      },
    });
  }, [focusTicketId, loadTickets, organizationId, selectedId]);

  useEffect(() => {
    let active = true;
    const requestId = selectedId;

    async function loadDetail() {
      if (!requestId) {
        setDetail(null);
        return;
      }

      setDetail(null);
      setDetailLoading(true);
      setReply("");
      setReplyError("");
      try {
        const next = await getMySupportTicket(requestId);
        if (active && next?.ticket?.id === requestId) {
          setDetail(next);
        }
      } catch {
        if (active && selectedId === requestId) {
          setDetail(null);
        }
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    }

    loadDetail();
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function handleReply(event) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) {
      return;
    }

    setReplyLoading(true);
    setReplyError("");
    try {
      const next = await replyToSupportTicket(selectedId, reply.trim());
      if (next?.ticket?.id === selectedId) {
        setDetail(next);
      }
      setReply("");
      await loadTickets();
    } catch (replyFailure) {
      setReplyError(replyFailure instanceof Error ? replyFailure.message : "Could not send reply.");
    } finally {
      setReplyLoading(false);
    }
  }

  return (
    <div className="customer-support-page">
      <div className="customer-support-filters">
        <label className="field">
          <span>Status</span>
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            {SUPPORT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Product</span>
          <select onChange={(event) => setProductFilter(event.target.value)} value={productFilter}>
            {productFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <select onChange={(event) => setDateFilter(event.target.value)} value={dateFilter}>
            {SUPPORT_DATE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="form-error-banner">{error}</div> : null}

      {loading ? <p className="customer-support-loading" role="status">Loading tickets...</p> : null}

      {!loading && tickets.length === 0 ? (
        <div className="onboarding-card customer-support-empty">
          <div className="lead-dashboard-empty-state__icon">
            <Ticket size={28} strokeWidth={1.5} />
          </div>
          <h3>No tickets yet</h3>
          <p>Raise your first support request and track progress here.</p>
          <button className="primary-button" onClick={onOpenRaiseTicket} type="button">
            Raise ticket
          </button>
        </div>
      ) : null}

      {!loading && tickets.length > 0 ? (
        <div className="customer-support-queue">
          <div className="customer-support-list">
            {tickets.map((ticket) => (
              <button
                className={`customer-support-list__item ${
                  selectedId === ticket.id ? "is-active" : ""
                }`}
                key={ticket.id}
                onClick={() => setSelectedId(ticket.id)}
                type="button"
              >
                <div className="customer-support-list__top">
                  <strong>{ticket.ticketNumber}</strong>
                  <div className="customer-support-list__badges">
                    <span className={supportPriorityClassName(ticket.priority)}>
                      {getSupportPriorityLabel(ticket.priority)}
                    </span>
                    <span className={supportStatusClassName(ticket.status)}>
                      {getSupportStatusLabel(ticket.status)}
                    </span>
                  </div>
                </div>
                <p className="customer-support-list__subject">{ticket.subject}</p>
                <small className="customer-support-list__meta">
                  {ticket.productLabel || "Account & billing"} ·{" "}
                  {formatTicketDate(ticket.createdAt)}
                </small>
              </button>
            ))}
          </div>

          <div className="customer-support-detail onboarding-card" key={selectedId || "empty"}>
            {detailLoading ? (
              <p className="customer-support-loading" role="status">
                Loading ticket...
              </p>
            ) : null}
            {!detailLoading && detail?.ticket?.id === selectedId ? (
              <>
                <div className="customer-support-detail__header">
                  <div className="customer-support-detail__intro">
                    <p className="page-eyebrow">{detail.ticket.ticketNumber}</p>
                    <h2>{detail.ticket.subject}</h2>
                    <p className="customer-support-detail__meta">
                      {detail.ticket.productLabel || "Account & billing"} ·{" "}
                      {getCategoryLabel(
                        detail.ticket.productId
                          ? detail.ticket.subscriptionKey
                          : ACCOUNT_PRODUCT_VALUE,
                        detail.ticket.category,
                      )}
                    </p>
                  </div>
                  <div className="customer-support-detail__badges">
                    <span className={supportPriorityClassName(detail.ticket.priority)}>
                      {getSupportPriorityLabel(detail.ticket.priority)}
                    </span>
                    <span className={supportStatusClassName(detail.ticket.status)}>
                      {getSupportStatusLabel(detail.ticket.status)}
                    </span>
                  </div>
                </div>

                <dl className="customer-support-detail__facts">
                  <div>
                    <dt>Created</dt>
                    <dd>{formatTicketDate(detail.ticket.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Tenant ID</dt>
                    <dd>{detail.ticket.tenantId || "—"}</dd>
                  </div>
                  {detail.ticket.subscriptionKey ? (
                    <div className="customer-support-detail__facts-wide">
                      <dt>Subscription key</dt>
                      <dd>{detail.ticket.subscriptionKey}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="customer-support-thread">
                  {(detail.messages || []).map((message) => (
                    <article
                      className={`customer-support-message customer-support-message--${message.authorType}`}
                      key={message.id}
                    >
                      <header>
                        <strong>{message.authorLabel || message.authorType}</strong>
                        <small>{formatTicketDate(message.createdAt)}</small>
                      </header>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>

                {detail.ticket.status !== "closed" ? (
                  <form className="customer-support-reply" onSubmit={handleReply}>
                    {replyError ? <div className="form-error-banner">{replyError}</div> : null}
                    <label className="field field--full">
                      <span>Reply</span>
                      <textarea
                        onChange={(event) => setReply(event.target.value)}
                        placeholder="Add more details for the support team"
                        rows={4}
                        value={reply}
                      />
                    </label>
                    <button
                      className="primary-button customer-support-reply__button"
                      disabled={replyLoading}
                      type="submit"
                    >
                      {replyLoading ? "Sending..." : "Send reply"}
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CustomerSupportPage() {
  const { dashboard, lead, loading, error } = useCustomerDashboard();
  const [raiseOverlayOpen, setRaiseOverlayOpen] = useState(false);
  const [ticketsRefreshNonce, setTicketsRefreshNonce] = useState(0);
  const [focusTicketId, setFocusTicketId] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  if (loading) {
    return <p className="route-loading" role="status">Loading support...</p>;
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  if (!dashboard) {
    return null;
  }

  return (
    <section className="lead-dashboard-page customer-support-shell">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>
            <Headphones size={24} />
            Support
          </h1>
          <p className="page-header__copy">
            Raise requests and track tickets for your account and products.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button"
            onClick={() => setRaiseOverlayOpen(true)}
            type="button"
          >
            Raise ticket
          </button>
        </div>
      </header>

      <MyTicketsPanel
        dashboard={dashboard}
        focusTicketId={focusTicketId}
        onOpenRaiseTicket={() => setRaiseOverlayOpen(true)}
        refreshNonce={ticketsRefreshNonce}
      />

      {raiseOverlayOpen ? (
        <RaiseTicketOverlay
          dashboard={dashboard}
          lead={lead}
          onClose={() => setRaiseOverlayOpen(false)}
          onCreated={(ticket) => {
            setFocusTicketId(ticket?.id || "");
            setTicketsRefreshNonce((current) => current + 1);
            setRaiseOverlayOpen(false);
            setPageSuccess(
              ticket?.ticketNumber
                ? `Ticket ${ticket.ticketNumber} created successfully.`
                : "Ticket created successfully.",
            );
          }}
        />
      ) : null}

      <AdminPageToast
        onDismiss={() => setPageSuccess("")}
        success={pageSuccess}
      />
    </section>
  );
}
