import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Headphones, Search, Send, Ticket } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  ACCOUNT_PRODUCT_VALUE,
  SUPPORT_DATE_FILTERS,
  SUPPORT_STATUS_OPTIONS,
  getCategoryLabel,
  getSupportPriorityLabel,
  getSupportStatusLabel,
  supportPriorityClassName,
  supportStatusClassName,
} from "../lib/productSupport.js";
import {
  getSalesSupportTicket,
  listSalesSupportTickets,
  replyToSalesSupportTicket,
  updateSalesSupportTicketStatus,
} from "../lib/supportTickets.js";

const SALES_STATUS_OPTIONS = SUPPORT_STATUS_OPTIONS.map((option) =>
  option.value === "waiting_on_customer"
    ? { ...option, label: "Waiting on customer" }
    : option,
);

const STATUS_UPDATE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_customer", label: "Waiting on customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

function getSalesSupportStatusLabel(value) {
  if (value === "waiting_on_customer") {
    return "Waiting on customer";
  }
  return getSupportStatusLabel(value);
}

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

function SupportFilterDropdown({
  containerRef,
  dateFilter,
  onClose,
  onDateChange,
  onProductChange,
  onReset,
  onStatusChange,
  productFilter,
  productFilterOptions,
  statusFilter,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      const container = containerRef?.current;
      if (container && !container.contains(event.target)) {
        onClose();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [containerRef, onClose]);

  return (
    <div
      className="leads-filter-dropdown"
      ref={menuRef}
      role="dialog"
      aria-label="Filter support tickets"
    >
      <div className="leads-filter-dropdown__section">
        <p className="leads-filter-dropdown__title">Filter by</p>
        <label className="leads-filter-dropdown__field">
          <span>Status</span>
          <select onChange={(event) => onStatusChange(event.target.value)} value={statusFilter}>
            {SALES_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="leads-filter-dropdown__field">
          <span>Product</span>
          <select onChange={(event) => onProductChange(event.target.value)} value={productFilter}>
            {productFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="leads-filter-dropdown__field">
          <span>Date</span>
          <select onChange={(event) => onDateChange(event.target.value)} value={dateFilter}>
            {SUPPORT_DATE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="leads-filter-dropdown__reset" onClick={onReset} type="button">
        Clear filters
      </button>
    </div>
  );
}

export function SalesSupportPage() {
  const navigate = useNavigate();
  const filterAnchorRef = useRef(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("30");
  const [productFilter, setProductFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const productFilterOptions = useMemo(() => {
    const uniqueProducts = new Map();
    uniqueProducts.set("all", "All products");
    uniqueProducts.set("account", "Account & billing");

    for (const ticket of tickets) {
      if (ticket.productId && ticket.productLabel) {
        uniqueProducts.set(ticket.productId, ticket.productLabel);
      }
    }

    return [...uniqueProducts.entries()].map(([value, label]) => ({ value, label }));
  }, [tickets]);

  const hasActiveFilters =
    statusFilter !== "all" || productFilter !== "all" || dateFilter !== "30";

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listSalesSupportTickets({
        status: statusFilter,
        productId: productFilter,
        days: dateFilter,
        search,
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
  }, [statusFilter, productFilter, dateFilter, search]);

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
        const next = await getSalesSupportTicket(selectedId);
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

  function resetFilters() {
    setStatusFilter("all");
    setProductFilter("all");
    setDateFilter("30");
    setShowFilters(false);
  }

  async function handleReply(event) {
    event.preventDefault();
    if (!selectedId) {
      return;
    }

    if (!reply.trim()) {
      setReplyError("Enter a reply before sending.");
      return;
    }

    setReplyLoading(true);
    setReplyError("");
    try {
      const next = await replyToSalesSupportTicket(
        selectedId,
        reply.trim(),
        detail?.ticket?.status === "open" || detail?.ticket?.status === "in_progress"
          ? "waiting_on_customer"
          : detail?.ticket?.status,
      );
      setDetail(next);
      setReply("");
      await loadTickets();
    } catch (replyFailure) {
      setReplyError(replyFailure instanceof Error ? replyFailure.message : "Could not send reply.");
    } finally {
      setReplyLoading(false);
    }
  }

  async function handleStatusChange(event) {
    const nextStatus = event.target.value;
    if (!selectedId || !nextStatus || nextStatus === detail?.ticket?.status) {
      return;
    }

    setStatusUpdating(true);
    setReplyError("");
    try {
      const next = await updateSalesSupportTicketStatus(selectedId, nextStatus);
      setDetail(next);
      await loadTickets();
    } catch (statusFailure) {
      setReplyError(
        statusFailure instanceof Error ? statusFailure.message : "Could not update status.",
      );
    } finally {
      setStatusUpdating(false);
    }
  }

  return (
    <section className="lead-dashboard-page customer-support-shell">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Sales workspace</p>
          <h1>
            <Headphones size={24} strokeWidth={1.75} />
            Support
          </h1>
          <p className="page-header__copy">
            Tickets raised by customers you onboarded or invoiced. Reply and update status here.
          </p>
        </div>
      </header>

      <div className="customer-support-page">
        <div className="customer-support-toolbar">
          <label className="sales-dashboard-table-tools__search customer-support-toolbar__search">
            <Search size={16} strokeWidth={1.75} />
            <input
              onChange={(event) => {
                const value = event.target.value;
                setSearchInput(value);
                setSearch(value.trim());
              }}
              placeholder="Search tickets, company, domain, email"
              type="search"
              value={searchInput}
            />
          </label>
          <div className="leads-filter-anchor" ref={filterAnchorRef}>
            <button
              aria-expanded={showFilters}
              aria-label="Filter tickets"
              className={`sales-dashboard-table-tools__filter ${showFilters || hasActiveFilters ? "is-active" : ""}`}
              onClick={() => setShowFilters((current) => !current)}
              type="button"
            >
              <Filter size={16} strokeWidth={1.75} />
            </button>
            {showFilters ? (
              <SupportFilterDropdown
                containerRef={filterAnchorRef}
                dateFilter={dateFilter}
                onClose={() => setShowFilters(false)}
                onDateChange={setDateFilter}
                onProductChange={setProductFilter}
                onReset={resetFilters}
                onStatusChange={setStatusFilter}
                productFilter={productFilter}
                productFilterOptions={productFilterOptions}
                statusFilter={statusFilter}
              />
            ) : null}
          </div>
        </div>

        {error ? <div className="form-error-banner">{error}</div> : null}

        {loading ? (
          <p className="customer-support-loading" role="status">
            Loading tickets...
          </p>
        ) : null}

        {!loading && tickets.length === 0 ? (
          <div className="onboarding-card customer-support-empty">
            <div className="lead-dashboard-empty-state__icon">
              <Ticket size={28} strokeWidth={1.5} />
            </div>
            <h3>No support tickets</h3>
            <p>
              When a customer you own raises a ticket in their portal, it will appear here.
            </p>
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
                  <strong className="customer-support-list__id">{ticket.ticketNumber}</strong>
                  <div className="customer-support-list__badges">
                    <span className={supportPriorityClassName(ticket.priority)}>
                      {getSupportPriorityLabel(ticket.priority)}
                    </span>
                    <span className={supportStatusClassName(ticket.status)}>
                      {getSalesSupportStatusLabel(ticket.status)}
                    </span>
                  </div>
                  <p className="customer-support-list__subject">{ticket.subject}</p>
                  <small className="customer-support-list__meta">
                    {ticket.companyName || "Customer"} · {ticket.productLabel || "Account & billing"}{" "}
                    · {formatTicketDate(ticket.createdAt)}
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
                        {detail.ticket.companyName || "Customer"} ·{" "}
                        {detail.ticket.productLabel || "Account & billing"} ·{" "}
                        {getCategoryLabel(
                          detail.ticket.productId
                            ? detail.ticket.subscriptionKey || detail.ticket.productId
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
                        {getSalesSupportStatusLabel(detail.ticket.status)}
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
                    <div>
                      <dt>Contact</dt>
                      <dd>{detail.ticket.contactEmail || "—"}</dd>
                    </div>
                    {detail.ticket.sourceLeadId ? (
                      <div>
                        <dt>Lead</dt>
                        <dd>
                          <button
                            className="link-button customer-support-detail__account-link"
                            onClick={() => navigate(`/products/${detail.ticket.sourceLeadId}`)}
                            type="button"
                          >
                            Open account
                          </button>
                        </dd>
                      </div>
                    ) : null}
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
                          <strong>
                            {message.authorLabel ||
                              (message.authorType === "sales" ? "Sales" : "Customer")}
                          </strong>
                          <small>{formatTicketDate(message.createdAt)}</small>
                        </header>
                        <p>{message.body}</p>
                      </article>
                    ))}
                  </div>

                  {detail.ticket.status !== "closed" ? (
                    <form className="customer-support-reply" onSubmit={handleReply}>
                      <label className="field customer-support-reply__status">
                        <span>Ticket status</span>
                        <select
                          disabled={statusUpdating}
                          onChange={handleStatusChange}
                          value={detail.ticket.status}
                        >
                          {STATUS_UPDATE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field field--full">
                        <span>Your reply</span>
                        <textarea
                          onChange={(event) => setReply(event.target.value)}
                          placeholder="Reply to the customer..."
                          rows={4}
                          value={reply}
                        />
                      </label>
                      {replyError ? <p className="form-error">{replyError}</p> : null}
                      <button
                        className="secondary-button customer-support-reply__button"
                        disabled={replyLoading}
                        type="submit"
                      >
                        <Send size={16} strokeWidth={1.75} />
                        {replyLoading ? "Sending..." : "Send reply"}
                      </button>
                    </form>
                  ) : (
                    <p className="customer-support-closed-note">This ticket is closed.</p>
                  )}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
