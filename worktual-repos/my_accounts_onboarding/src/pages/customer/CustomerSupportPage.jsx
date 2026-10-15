import { useCallback, useEffect, useMemo, useState } from "react";
import { Headphones, MessageSquarePlus, Send, Ticket } from "lucide-react";

import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import {
  ACCOUNT_PRODUCT_VALUE,
  SUPPORT_DATE_FILTERS,
  SUPPORT_PRIORITIES,
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
import {
  createSupportTicket,
  getMySupportTicket,
  listMySupportTickets,
  replyToSupportTicket,
} from "../../lib/supportTickets.js";
import { getCustomerSession } from "../../lib/customerAuth.js";

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

function SupportTabs({ activeTab, onChange }) {
  return (
    <div className="customer-support-tabs" role="tablist">
      <button
        className={`customer-support-tabs__item ${activeTab === "tickets" ? "is-active" : ""}`}
        onClick={() => onChange("tickets")}
        role="tab"
        type="button"
      >
        My tickets
      </button>
      <button
        className={`customer-support-tabs__item ${activeTab === "raise" ? "is-active" : ""}`}
        onClick={() => onChange("raise")}
        role="tab"
        type="button"
      >
        Raise ticket
      </button>
    </div>
  );
}

function RaiseTicketForm({ dashboard, lead, onCreated }) {
  const session = getCustomerSession();
  const productOptions = useMemo(
    () => buildSupportProductOptions(dashboard?.activeProducts || []),
    [dashboard?.activeProducts],
  );

  const [productSelection, setProductSelection] = useState(ACCOUNT_PRODUCT_VALUE);
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [unableToUse, setUnableToUse] = useState(false);
  const [startedAfterChange, setStartedAfterChange] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const categories = useMemo(
    () => getSupportCategories(productSelection, dashboard?.activeProducts || []),
    [productSelection, dashboard?.activeProducts],
  );

  useEffect(() => {
    if (!categories.some((entry) => entry.value === category)) {
      setCategory(categories[0]?.value || "");
    }
  }, [categories, category]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const selectedProduct = findSupportProductOption(productOptions, productSelection);

    if (!subject.trim() || !description.trim() || !category) {
      setError("Please complete all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSupportTicket({
        subscriptionId: selectedProduct?.subscriptionId || null,
        productId: selectedProduct?.productId || null,
        subscriptionKey: selectedProduct?.subscriptionKey || null,
        productLabel: selectedProduct?.label || "Account & billing",
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
        unableToUse,
        startedAfterChange,
        domainId: dashboard?.contact?.domainId || lead?.domainId || "",
        companyName: dashboard?.contact?.companyName || "",
        contactEmail: dashboard?.contact?.workEmail || session?.email || "",
      });

      setSuccess(`Ticket ${result.ticket.ticketNumber} created successfully.`);
      setSubject("");
      setDescription("");
      setUnableToUse(false);
      setStartedAfterChange(false);
      onCreated?.(result.ticket);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="customer-support-layout">
      <form className="onboarding-card customer-support-form" onSubmit={handleSubmit}>
        <div className="customer-support-form__header">
          <div className="lead-dashboard-panel__heading-icon">
            <MessageSquarePlus size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Raise a support ticket</h2>
            <p>Tell us which product needs help and describe the issue.</p>
          </div>
        </div>

        {error ? <div className="form-error-banner">{error}</div> : null}
        {success ? <div className="form-success-banner">{success}</div> : null}

        <div className="form-grid">
          <label className="field field--full">
            <span>Product *</span>
            <select
              onChange={(event) => setProductSelection(event.target.value)}
              value={productSelection}
            >
              {productOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--full">
            <span>Category *</span>
            <select onChange={(event) => setCategory(event.target.value)} value={category}>
              {categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field field--full">
            <span>Priority *</span>
            <div className="customer-support-priority">
              {SUPPORT_PRIORITIES.map((option) => (
                <button
                  className={`customer-support-priority__item ${
                    priority === option.value ? "is-active" : ""
                  }`}
                  key={option.value}
                  onClick={() => setPriority(option.value)}
                  title={option.hint}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <small className="field__hint">Urgent is for complete outage only.</small>
          </div>

          <label className="field field--full">
            <span>Subject *</span>
            <input
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Short summary of the issue"
              value={subject}
            />
          </label>

          <label className="field field--full">
            <span>Description *</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Include steps to reproduce, error messages, and when it started."
              rows={6}
              value={description}
            />
          </label>

          <div className="customer-support-checkboxes field--full">
            <label className="checkbox-field">
              <input
                checked={unableToUse}
                onChange={(event) => setUnableToUse(event.target.checked)}
                type="checkbox"
              />
              <span>I am unable to use the product</span>
            </label>
            <label className="checkbox-field">
              <input
                checked={startedAfterChange}
                onChange={(event) => setStartedAfterChange(event.target.checked)}
                type="checkbox"
              />
              <span>This started after a recent change</span>
            </label>
          </div>
        </div>

        <div className="customer-support-form__actions">
          <button className="primary-button" disabled={submitting} type="submit">
            <Send size={16} />
            {submitting ? "Submitting..." : "Submit ticket"}
          </button>
        </div>
      </form>

      <aside className="onboarding-card customer-support-context">
        <h3>Your account context</h3>
        <dl className="customer-support-context__details">
          <div>
            <dt>Company</dt>
            <dd>{dashboard?.contact?.companyName || "—"}</dd>
          </div>
          <div>
            <dt>Domain ID</dt>
            <dd>{dashboard?.contact?.domainId || "—"}</dd>
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
  );
}

function MyTicketsPanel({ dashboard, onSwitchToRaise }) {
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

  const loadTickets = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [statusFilter, productFilter, dateFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    let active = true;

    async function loadDetail() {
      if (!selectedId) {
        setDetail(null);
        return;
      }

      setDetailLoading(true);
      try {
        const next = await getMySupportTicket(selectedId);
        if (active) {
          setDetail(next);
        }
      } catch {
        if (active) {
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
  }, [selectedId, tickets]);

  async function handleReply(event) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) {
      return;
    }

    setReplyLoading(true);
    setReplyError("");
    try {
      const next = await replyToSupportTicket(selectedId, reply.trim());
      setDetail(next);
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
          <button className="primary-button" onClick={onSwitchToRaise} type="button">
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

          <div className="customer-support-detail onboarding-card">
            {detailLoading ? (
              <p className="customer-support-loading" role="status">
                Loading ticket...
              </p>
            ) : null}
            {!detailLoading && detail?.ticket ? (
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
                    <dt>Domain ID</dt>
                    <dd>{detail.ticket.domainId || "—"}</dd>
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
                      className="secondary-button customer-support-reply__button"
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
  const [activeTab, setActiveTab] = useState("tickets");

  if (loading) {
    return <p className="route-loading" role="status">Loading support...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
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
      </header>

      <SupportTabs
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab)}
      />

      {activeTab === "tickets" ? (
        <MyTicketsPanel dashboard={dashboard} onSwitchToRaise={() => setActiveTab("raise")} />
      ) : (
        <RaiseTicketForm
          dashboard={dashboard}
          lead={lead}
          onCreated={() => setActiveTab("tickets")}
        />
      )}
    </section>
  );
}
