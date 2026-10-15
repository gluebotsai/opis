// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  Copy,
  Crosshair,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Layers,
  Settings2,
  Users,
} from "lucide-react";

import { AdminPageToast } from "../admin/AdminPageToast.tsx";
import { getSession } from "../../lib/auth.js";
import {
  exportLeadsTable,
  isLeadStale,
  LEAD_EXPORT_FORMATS,
  LEAD_EXPORT_SCOPES,
  LEAD_TABLE_COLUMNS,
  loadVisibleColumns,
  saveVisibleColumns,
  STALE_LEAD_DAYS,
} from "../../lib/exportLeadsTable.js";
import {
  DATE_RANGE_OPTIONS,
  fetchOversightAgentDetail,
  fetchOversightAgents,
  formatOversightCurrency,
  formatOversightDate,
  logOversightExportAudit,
  reassignAllLeadsFromAgent,
  reassignLead,
} from "../../lib/salesOversight.js";

import "../../styles/admin-users-light.css";
import "../../styles/sa-agents.css";
import "../../styles/sa-agent-detail.css";

const EXPORT_FORMAT_ICONS = {
  excel: FileSpreadsheet,
  csv: FileText,
  pdf: FileText,
  docs: FileText,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const EMPTY_FILTERS = {
  purchased: "all",
  status: "all",
  product: "all",
  activityFrom: "",
  activityTo: "",
  revenueMin: "",
  revenueMax: "",
};

function ProductTags({ products }) {
  if (!products?.length) {
    return <span className="sa-agent-detail__empty-cell">—</span>;
  }

  const visible = products.slice(0, 2);
  const overflow = products.length - visible.length;
  const fullLabel = products.join(", ");

  return (
    <div className="sa-agent-detail__tags" title={fullLabel}>
      {visible.map((product) => (
        <span className="sa-agent-detail__tag" key={product}>
          {product}
        </span>
      ))}
      {overflow > 0 ? <span className="sa-agent-detail__tag is-more">+{overflow}</span> : null}
    </div>
  );
}

function PurchasedBadge({ purchased }) {
  return (
    <span className={`sa-agent-detail__purchased ${purchased ? "is-yes" : "is-no"}`}>
      {purchased ? "Yes" : "No"}
    </span>
  );
}

function ReassignModal({ agents, lead, onClose, onSuccess }) {
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!toUserId) {
      setError("Select a sales agent.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await reassignLead(lead.id, { toUserId, reason });
      onSuccess();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not reassign lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="confirm-modal-overlay" onClick={onClose} role="presentation">
      <div className="confirm-modal-overlay__backdrop" />
      <form
        className="confirm-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Reassign lead</h2>
        <p>
          Move <strong>{lead.companyName || lead.tenantId}</strong> to another sales agent.
        </p>
        <label className="admin-users-field">
          <span>New agent *</span>
          <select onChange={(event) => setToUserId(event.target.value)} value={toUserId}>
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName || agent.email}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-users-field">
          <span>Reason</span>
          <input onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="confirm-modal__footer">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Reassigning..." : "Reassign lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReassignAllModal({ agents, fromUser, onClose, onSuccess }) {
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("Sales executive left / account transfer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!toUserId) {
      setError("Select a sales agent.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await reassignAllLeadsFromAgent(fromUser.id, { toUserId, reason });
      onSuccess(result);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not reassign customers.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="confirm-modal-overlay" onClick={onClose} role="presentation">
      <div className="confirm-modal-overlay__backdrop" />
      <form
        className="confirm-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Reassign all customers</h2>
        <p>
          Move every customer owned by{" "}
          <strong>{fromUser.displayName || fromUser.email}</strong> to another active sales
          executive. Assignee and creator are both updated.
        </p>
        <label className="admin-users-field">
          <span>New agent *</span>
          <select onChange={(event) => setToUserId(event.target.value)} value={toUserId}>
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName || agent.email}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-users-field">
          <span>Reason</span>
          <input onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="confirm-modal__footer">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Reassigning..." : "Reassign all"}
          </button>
        </div>
      </form>
    </div>
  );
}

function sortLeads(leads, sortKey) {
  const sorted = [...leads];

  sorted.sort((left, right) => {
    if (sortKey === "assigned-asc") {
      return String(left.assignedAt || "").localeCompare(String(right.assignedAt || ""));
    }
    if (sortKey === "assigned-desc") {
      return String(right.assignedAt || "").localeCompare(String(left.assignedAt || ""));
    }
    if (sortKey === "activity-asc") {
      return String(left.lastActivityAt || "").localeCompare(String(right.lastActivityAt || ""));
    }
    return String(right.lastActivityAt || "").localeCompare(String(left.lastActivityAt || ""));
  });

  return sorted;
}

function parseDayStart(value) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function parseDayEnd(value) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function leadMatchesFilters(lead, filters) {
  if (filters.purchased === "yes" && !lead.purchased) {
    return false;
  }
  if (filters.purchased === "no" && lead.purchased) {
    return false;
  }
  if (filters.status !== "all" && lead.status !== filters.status) {
    return false;
  }
  if (filters.product !== "all") {
    const products = [...(lead.quotedProducts || []), ...(lead.purchasedProducts || [])];
    if (!products.includes(filters.product)) {
      return false;
    }
  }

  const activityTime = new Date(lead.lastActivityAt || lead.assignedAt || 0).getTime();
  const fromTime = parseDayStart(filters.activityFrom);
  const toTime = parseDayEnd(filters.activityTo);
  if (fromTime != null && (!Number.isFinite(activityTime) || activityTime < fromTime)) {
    return false;
  }
  if (toTime != null && (!Number.isFinite(activityTime) || activityTime > toTime)) {
    return false;
  }

  const revenue = Number(lead.revenue) || 0;
  const minRevenue = filters.revenueMin === "" ? null : Number(filters.revenueMin);
  const maxRevenue = filters.revenueMax === "" ? null : Number(filters.revenueMax);
  if (minRevenue != null && Number.isFinite(minRevenue) && revenue < minRevenue) {
    return false;
  }
  if (maxRevenue != null && Number.isFinite(maxRevenue) && revenue > maxRevenue) {
    return false;
  }

  return true;
}

function activeFilterCount(filters) {
  let count = 0;
  if (filters.purchased !== "all") count += 1;
  if (filters.status !== "all") count += 1;
  if (filters.product !== "all") count += 1;
  if (filters.activityFrom) count += 1;
  if (filters.activityTo) count += 1;
  if (filters.revenueMin !== "") count += 1;
  if (filters.revenueMax !== "") count += 1;
  return count;
}

export function SalesOversightAgentDetail({
  basePath,
  readOnly = false,
  allowReassign = false,
  userId,
}) {
  const navigate = useNavigate();
  const session = getSession();
  const roleKey = session?.role || "default";
  const canReassign = allowReassign || !readOnly;

  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignAllOpen, setReassignAllOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [sortKey, setSortKey] = useState("activity-desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [exportScope, setExportScope] = useState("filtered");
  const [visibleColumns, setVisibleColumns] = useState(() => loadVisibleColumns(roleKey));
  const exportMenuRef = useRef(null);
  const filterMenuRef = useRef(null);
  const columnsMenuRef = useRef(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchOversightAgentDetail(userId, days);
      setDetail(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load agent detail.");
    } finally {
      setLoading(false);
    }
  }, [days, userId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!canReassign) {
      return;
    }

    fetchOversightAgents()
      .then((data) => setAgents(data.agents || []))
      .catch(() => setAgents([]));
  }, [canReassign]);

  useEffect(() => {
    setPage(1);
  }, [days, filters, pageSize, sortKey]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (exportOpen && exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setExportOpen(false);
      }
      if (filterOpen && filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setFilterOpen(false);
      }
      if (columnsOpen && columnsMenuRef.current && !columnsMenuRef.current.contains(event.target)) {
        setColumnsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setExportOpen(false);
        setFilterOpen(false);
        setColumnsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [exportOpen, filterOpen, columnsOpen]);

  const metrics = detail?.metrics;
  const agent = detail?.agent;
  const allLeads = detail?.leads || [];

  const statusOptions = useMemo(() => {
    const values = new Set(allLeads.map((lead) => lead.status).filter(Boolean));
    return [...values].sort();
  }, [allLeads]);

  const productOptions = useMemo(() => {
    const values = new Set();
    for (const lead of allLeads) {
      for (const product of lead.quotedProducts || []) values.add(product);
      for (const product of lead.purchasedProducts || []) values.add(product);
    }
    return [...values].sort();
  }, [allLeads]);

  const productMixTotals = useMemo(() => {
    const rows = detail?.productMix || [];
    return rows.reduce(
      (totals, row) => ({
        quoted: totals.quoted + (row.quotedCount || 0),
        purchased: totals.purchased + (row.purchasedCount || 0),
      }),
      { quoted: 0, purchased: 0 },
    );
  }, [detail?.productMix]);

  const filteredLeads = useMemo(() => {
    const filtered = allLeads.filter((lead) => leadMatchesFilters(lead, filters));
    return sortLeads(filtered, sortKey);
  }, [allLeads, filters, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredLeads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredLeads.length);
  const visibleLeads = filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const filterCount = activeFilterCount(filters) + (days !== 30 ? 1 : 0);
  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

  const displayColumns = useMemo(
    () =>
      LEAD_TABLE_COLUMNS.filter((column) => {
        if (column.id === "actions") {
          return canReassign;
        }
        return visibleColumnSet.has(column.id);
      }),
    [canReassign, visibleColumnSet],
  );

  function columnCellClass(columnId) {
    if (columnId === "purchased") {
      return "sa-agent-detail-table__col--purchased";
    }
    if (columnId === "revenue") {
      return "sa-agent-detail-table__col--revenue";
    }
    if (columnId === "actions") {
      return "sa-agent-detail-table__col--actions";
    }
    return undefined;
  }

  async function handleCopyEmail() {
    if (!agent?.email) {
      return;
    }

    try {
      await navigator.clipboard.writeText(agent.email);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 1500);
    } catch {
      setCopyFeedback(false);
    }
  }

  function toggleSort(column) {
    if (column === "assigned") {
      setSortKey((current) => (current === "assigned-desc" ? "assigned-asc" : "assigned-desc"));
      return;
    }

    setSortKey((current) => (current === "activity-desc" ? "activity-asc" : "activity-desc"));
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function toggleColumn(columnId) {
    const column = LEAD_TABLE_COLUMNS.find((entry) => entry.id === columnId);
    if (!column || column.alwaysVisible) {
      return;
    }

    setVisibleColumns((current) => {
      const next = current.includes(columnId)
        ? current.filter((id) => id !== columnId)
        : [...current, columnId];
      return saveVisibleColumns(roleKey, next);
    });
  }

  function leadsForExportScope() {
    if (exportScope === "page") {
      return visibleLeads;
    }
    if (exportScope === "all") {
      return allLeads;
    }
    return filteredLeads;
  }

  async function handleExport(formatId) {
    const leads = leadsForExportScope();
    const result = exportLeadsTable(formatId, leads, {
      agentName: agent?.displayName || agent?.email || "agent",
      visibleColumnIds: visibleColumns,
    });

    try {
      await logOversightExportAudit({
        agentUserId: agent?.id || userId,
        agentEmail: agent?.email || "",
        agentName: agent?.displayName || agent?.email || "",
        format: formatId,
        scope: exportScope,
        rowCount: result.rowCount,
        fileName: result.fileName,
      });
    } catch {
      // Export still succeeds even if audit logging fails.
    }

    setExportOpen(false);
  }

  function renderLeadCell(lead, columnId) {
    switch (columnId) {
      case "company": {
        const name = lead.companyName || lead.tenantId || "—";
        const subtitle = lead.companyName && lead.tenantId ? lead.tenantId : "";
        return (
          <span
            className="sa-agent-detail-table__company"
            title={subtitle ? `${name} · ${subtitle}` : name}
          >
            {name}
          </span>
        );
      }
      case "assigned":
        return formatOversightDate(lead.assignedAt) || "—";
      case "lastActivity": {
        const stale = isLeadStale(lead);
        const dateLabel = formatOversightDate(lead.lastActivityAt) || "—";
        return (
          <span
            className={`sa-agent-detail-table__activity${stale ? " is-stale" : ""}`}
            title={stale ? `${dateLabel} · Stale ${STALE_LEAD_DAYS}d+` : dateLabel}
          >
            {dateLabel}
          </span>
        );
      }
      case "quotedProducts":
        return <ProductTags products={lead.quotedProducts} />;
      case "purchased":
        return <PurchasedBadge purchased={lead.purchased} />;
      case "productsBought":
        return <ProductTags products={lead.purchasedProducts} />;
      case "revenue":
        return lead.revenue ? formatOversightCurrency(lead.revenue) : "—";
      case "actions":
        if (!canReassign) {
          return null;
        }
        return (
          <button
            className="sa-agent-detail-table__reassign"
            onClick={(event) => {
              event.stopPropagation();
              setSuccess("");
              setReassignTarget(lead);
            }}
            type="button"
          >
            Reassign
          </button>
        );
      default:
        return null;
    }
  }

  return (
    <section className="admin-users-page sa-agent-detail-page">
      <div className="sa-agent-detail-page__chrome">
        <button
          className="sa-agent-detail-page__back"
          onClick={() => navigate(`${basePath}/agents`)}
          type="button"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <header className="admin-users-page__header sa-agent-detail-page__header">
          <div className="sa-agent-detail-page__identity">
            <div className="sa-agent-detail-page__title-row">
              <h1>{agent?.displayName || (loading ? "Loading…" : "Sales agent")}</h1>
              {agent ? (
                <span
                  className={`sa-agent-detail-page__status ${agent.isActive === false ? "is-inactive" : "is-active"}`}
                >
                  <span className="sa-agent-detail-page__status-dot" aria-hidden="true" />
                  {agent.isActive === false ? "Inactive" : "Active"}
                </span>
              ) : null}
            </div>
            <div className="sa-agent-detail-page__meta">
              {agent?.email ? (
                <div className="sa-agent-detail-page__email-row">
                  <span>{agent.email}</span>
                  <button
                    aria-label="Copy email"
                    className="sa-agent-detail-page__copy"
                    onClick={handleCopyEmail}
                    type="button"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                  {copyFeedback ? (
                    <span className="sa-agent-detail-page__copy-feedback">Copied</span>
                  ) : null}
                </div>
              ) : null}
              {canReassign && agent ? (
                <button
                  className="primary-button sa-agent-detail-page__reassign"
                  onClick={() => {
                    setSuccess("");
                    setReassignAllOpen(true);
                  }}
                  type="button"
                >
                  Reassign all customers
                </button>
              ) : null}
            </div>
          </div>
        </header>
      </div>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setSuccess("");
        }}
        success={success}
      />
      {loading ? (
        <p className="admin-users-panel__loading" role="status">
          Loading agent…
        </p>
      ) : null}

      {!loading && detail ? (
        <>
          <section className="admin-users-kpi-grid sa-agent-detail-kpi" aria-label="Agent metrics">
            <article className="admin-users-kpi-card">
              <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--total" aria-hidden="true">
                <Users size={18} />
              </div>
              <div>
                <span>Assigned leads</span>
                <strong>{metrics.assignedLeads}</strong>
              </div>
            </article>

            <article className="admin-users-kpi-card">
              <div
                className="admin-users-kpi-card__icon sa-agent-detail-kpi__icon--mix"
                aria-hidden="true"
              >
                <Layers size={18} />
              </div>
              <div>
                <span>Product mix</span>
                <div className="sa-agent-detail-kpi__split" aria-label="Product mix totals">
                  <div>
                    <span>Quoted</span>
                    <strong>{productMixTotals.quoted}</strong>
                  </div>
                  <div>
                    <span>Purchased</span>
                    <strong>{productMixTotals.purchased}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article className="admin-users-kpi-card">
              <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active" aria-hidden="true">
                <IndianRupee size={18} />
              </div>
              <div>
                <span>Revenue</span>
                <strong title={formatOversightCurrency(metrics.revenue)}>
                  {formatOversightCurrency(metrics.revenue)}
                </strong>
              </div>
            </article>

            <article className="admin-users-kpi-card">
              <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--updated" aria-hidden="true">
                <Crosshair size={18} />
              </div>
              <div>
                <span>Conversion</span>
                <strong>{metrics.conversionRate}%</strong>
              </div>
            </article>
          </section>

          <section className="admin-users-panel sa-agent-detail-leads">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Assigned leads</h2>
                <p>
                  Pipeline, purchases, and products per lead. Stale leads have no activity for{" "}
                  {STALE_LEAD_DAYS}+ days.
                </p>
              </div>
              <div className="admin-users-panel__toolbar sa-agent-detail-leads__toolbar">
                <div className="admin-users-panel__filter-anchor" ref={filterMenuRef}>
                  <button
                    aria-expanded={filterOpen}
                    className={`admin-users-panel__tool-button ${
                      filterOpen || filterCount ? "is-active" : ""
                    }`}
                    onClick={() => {
                      setFilterOpen((current) => !current);
                      setExportOpen(false);
                      setColumnsOpen(false);
                    }}
                    type="button"
                  >
                    <Filter size={16} aria-hidden="true" />
                    Filters
                    {filterCount ? (
                      <span className="sa-agent-detail-leads__badge">{filterCount}</span>
                    ) : null}
                  </button>
                  {filterOpen ? (
                    <div
                      className="admin-users-filter-dropdown sa-agent-detail-panel-menu--wide sa-agent-detail-filter-dropdown"
                      role="dialog"
                      aria-label="Filter leads"
                    >
                      <div className="sa-agent-detail-filter-dropdown__scroll">
                        <div className="admin-users-filter-dropdown__section">
                          <p className="admin-users-filter-dropdown__title">Filter by</p>
                          <label className="admin-users-filter-dropdown__field">
                            <span>Period</span>
                            <select
                              aria-label="Period"
                              onChange={(event) => setDays(Number(event.target.value))}
                              value={days}
                            >
                              {DATE_RANGE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="sa-agent-detail-filters">
                            <label className="admin-users-filter-dropdown__field">
                              <span>Purchased</span>
                              <select
                                onChange={(event) => updateFilter("purchased", event.target.value)}
                                value={filters.purchased}
                              >
                                <option value="all">All</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Status</span>
                              <select
                                onChange={(event) => updateFilter("status", event.target.value)}
                                value={filters.status}
                              >
                                <option value="all">All statuses</option>
                                {statusOptions.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Product</span>
                              <select
                                onChange={(event) => updateFilter("product", event.target.value)}
                                value={filters.product}
                              >
                                <option value="all">All products</option>
                                {productOptions.map((product) => (
                                  <option key={product} value={product}>
                                    {product}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Activity from</span>
                              <input
                                onChange={(event) => updateFilter("activityFrom", event.target.value)}
                                type="date"
                                value={filters.activityFrom}
                              />
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Activity to</span>
                              <input
                                onChange={(event) => updateFilter("activityTo", event.target.value)}
                                type="date"
                                value={filters.activityTo}
                              />
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Revenue min</span>
                              <input
                                min="0"
                                onChange={(event) => updateFilter("revenueMin", event.target.value)}
                                placeholder="0"
                                type="number"
                                value={filters.revenueMin}
                              />
                            </label>
                            <label className="admin-users-filter-dropdown__field">
                              <span>Revenue max</span>
                              <input
                                min="0"
                                onChange={(event) => updateFilter("revenueMax", event.target.value)}
                                placeholder="Any"
                                type="number"
                                value={filters.revenueMax}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="admin-users-filter-dropdown__actions">
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setFilters(EMPTY_FILTERS);
                            setDays(30);
                          }}
                          type="button"
                        >
                          Clear
                        </button>
                        <button
                          className="primary-button"
                          onClick={() => setFilterOpen(false)}
                          type="button"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="admin-users-panel__filter-anchor" ref={exportMenuRef}>
                  <button
                    aria-expanded={exportOpen}
                    aria-haspopup="menu"
                    className={`admin-users-panel__tool-button ${exportOpen ? "is-active" : ""}`}
                    onClick={() => {
                      setExportOpen((current) => !current);
                      setFilterOpen(false);
                      setColumnsOpen(false);
                    }}
                    type="button"
                  >
                    <Download size={16} aria-hidden="true" />
                    Export
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {exportOpen ? (
                    <div className="sa-agent-detail-export__menu" role="menu">
                      <p className="sa-agent-detail-export__title">Export scope</p>
                      {LEAD_EXPORT_SCOPES.map((scope) => (
                        <label className="sa-agent-detail-export__scope" key={scope.id}>
                          <input
                            checked={exportScope === scope.id}
                            name="export-scope"
                            onChange={() => setExportScope(scope.id)}
                            type="radio"
                          />
                          <span>{scope.label}</span>
                        </label>
                      ))}
                      <p className="sa-agent-detail-export__title">Export as</p>
                      {LEAD_EXPORT_FORMATS.map((format) => {
                        const Icon = EXPORT_FORMAT_ICONS[format.id] || FileText;
                        return (
                          <button
                            key={format.id}
                            onClick={() => handleExport(format.id)}
                            role="menuitem"
                            type="button"
                          >
                            <Icon size={15} />
                            <span>{format.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="admin-users-panel__filter-anchor" ref={columnsMenuRef}>
                  <button
                    aria-expanded={columnsOpen}
                    aria-label="Table settings"
                    className={`admin-users-panel__icon-button ${columnsOpen ? "is-active" : ""}`}
                    onClick={() => {
                      setColumnsOpen((current) => !current);
                      setExportOpen(false);
                      setFilterOpen(false);
                    }}
                    type="button"
                  >
                    <Settings2 size={16} aria-hidden="true" />
                  </button>
                  {columnsOpen ? (
                    <div className="sa-agent-detail-export__menu" role="dialog" aria-label="Visible columns">
                      <p className="sa-agent-detail-export__title">Visible columns</p>
                      <p className="sa-agent-detail-panel-menu__hint">
                        Saved for {roleKey === "admin" ? "Admin" : "Sales Admin"} role
                      </p>
                      {LEAD_TABLE_COLUMNS.filter((column) => column.id !== "actions").map((column) => (
                        <label className="sa-agent-detail-export__scope" key={column.id}>
                          <input
                            checked={visibleColumnSet.has(column.id)}
                            disabled={column.alwaysVisible}
                            onChange={() => toggleColumn(column.id)}
                            type="checkbox"
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="admin-users-panel__body">
              {filteredLeads.length === 0 ? (
                <p className="admin-users-panel__empty" role="status">
                  No leads match the current filters.
                </p>
              ) : (
                <div className="admin-users-panel__table-wrap">
                  <table className="admin-users-table sa-agent-detail-table">
                    <thead>
                      <tr>
                        {displayColumns.map((column) => (
                          <th className={columnCellClass(column.id)} key={column.id}>
                            {column.id === "assigned" || column.id === "lastActivity" ? (
                              <button
                                className="sa-agent-detail-table__sort"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSort(column.id === "assigned" ? "assigned" : "activity");
                                }}
                                type="button"
                              >
                                {column.label}
                                <ArrowUpDown size={13} aria-hidden="true" />
                              </button>
                            ) : (
                              column.label
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLeads.map((lead) => (
                        <tr
                          className={`is-clickable${
                            isLeadStale(lead) ? " sa-agent-detail-table__row--stale" : ""
                          }`}
                          key={lead.id}
                          onClick={() => navigate(`${basePath}/leads/${lead.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigate(`${basePath}/leads/${lead.id}`);
                            }
                          }}
                          role="link"
                          tabIndex={0}
                        >
                          {displayColumns.map((column) => (
                            <td className={columnCellClass(column.id)} key={column.id}>
                              {renderLeadCell(lead, column.id)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {filteredLeads.length > 0 ? (
              <footer className="admin-users-panel__footer">
                <span>
                  Showing {pageStart} – {pageEnd} of {filteredLeads.length}
                </span>
                <div className="admin-users-panel__footer-controls">
                  <label className="admin-users-panel__page-size">
                    <span>Rows</span>
                    <span className="admin-users-panel__page-size-control">
                      <select
                        aria-label="Rows per page"
                        onChange={(event) => setPageSize(Number(event.target.value))}
                        value={pageSize}
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <nav aria-label="Leads pagination" className="admin-users-panel__pagination">
                    <button
                      aria-label="Previous page"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <button className="is-active" disabled type="button">
                      {currentPage}
                    </button>
                    <button
                      aria-label="Next page"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      type="button"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </nav>
                </div>
              </footer>
            ) : null}
          </section>
        </>
      ) : null}

      {reassignTarget ? (
        <ReassignModal
          agents={agents.filter(
            (entry) => entry.id !== userId && entry.isActive !== false,
          )}
          lead={reassignTarget}
          onClose={() => setReassignTarget(null)}
          onSuccess={() => {
            setSuccess("Lead reassigned.");
            void loadDetail();
          }}
        />
      ) : null}

      {reassignAllOpen && agent ? (
        <ReassignAllModal
          agents={agents.filter(
            (entry) => entry.id !== userId && entry.isActive !== false,
          )}
          fromUser={agent}
          onClose={() => setReassignAllOpen(false)}
          onSuccess={(result) => {
            setSuccess(
              `Reassigned ${result?.transferred ?? 0} customer${
                (result?.transferred ?? 0) === 1 ? "" : "s"
              }.`,
            );
            void loadDetail();
          }}
        />
      ) : null}
    </section>
  );
}
