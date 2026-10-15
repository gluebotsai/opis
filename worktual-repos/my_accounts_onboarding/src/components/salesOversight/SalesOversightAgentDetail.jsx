import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  Copy,
  Crosshair,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  MoreHorizontal,
  Settings2,
  Users,
} from "lucide-react";

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
  reassignLead,
} from "../../lib/salesOversight.js";

const EXPORT_FORMAT_ICONS = {
  excel: FileSpreadsheet,
  csv: FileText,
  pdf: FileText,
  docs: FileText,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const EMPTY_FILTERS = {
  purchased: "all",
  status: "all",
  product: "all",
  activityFrom: "",
  activityTo: "",
  revenueMin: "",
  revenueMax: "",
};

function StatusBadge({ status }) {
  const tone =
    status === "Paid" || status === "Approved"
      ? "qualified"
      : status === "Rejected"
        ? "inactive"
        : status === "Pending Finance Review"
          ? "in-progress"
          : "new";

  return (
    <span className={`lead-status lead-status--${tone}`}>
      <span className="lead-status__dot" />
      {status}
    </span>
  );
}

function ProductTags({ products }) {
  if (!products?.length) {
    return <span className="sa-agent-detail__empty-cell">—</span>;
  }

  return (
    <div className="sa-agent-detail__tags">
      {products.map((product) => (
        <span className="sa-agent-detail__tag" key={product}>
          {product}
        </span>
      ))}
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
          Move <strong>{lead.companyName || lead.domainId}</strong> to another sales agent.
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

export function SalesOversightAgentDetail({ basePath, readOnly = false, userId }) {
  const navigate = useNavigate();
  const session = getSession();
  const roleKey = session?.role || "default";

  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reassignTarget, setReassignTarget] = useState(null);
  const [menuLeadId, setMenuLeadId] = useState(null);
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
    if (readOnly) {
      return;
    }

    fetchOversightAgents()
      .then((data) => setAgents(data.agents || []))
      .catch(() => setAgents([]));
  }, [readOnly]);

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
  const filterCount = activeFilterCount(filters);
  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

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
      case "company":
        return (
          <div className="sa-agent-detail-table__company">
            <strong>{lead.companyName || lead.domainId}</strong>
            <small>{lead.domainId}</small>
          </div>
        );
      case "status":
        return <StatusBadge status={lead.status} />;
      case "assigned":
        return formatOversightDate(lead.assignedAt);
      case "lastActivity":
        return (
          <span className="sa-agent-detail-table__activity">
            {formatOversightDate(lead.lastActivityAt)}
            {isLeadStale(lead) ? (
              <span className="sa-agent-detail__stale-pill">Stale {STALE_LEAD_DAYS}d+</span>
            ) : null}
          </span>
        );
      case "quotedProducts":
        return <ProductTags products={lead.quotedProducts} />;
      case "purchased":
        return <PurchasedBadge purchased={lead.purchased} />;
      case "productsBought":
        return <ProductTags products={lead.purchasedProducts} />;
      case "revenue":
        return lead.revenue ? formatOversightCurrency(lead.revenue) : "—";
      case "actions":
        return (
          <div className="sa-agent-detail-table__actions">
            <button
              className="sa-agent-detail-table__view"
              onClick={() => navigate(`${basePath}/leads/${lead.id}`)}
              type="button"
            >
              <Eye size={15} />
              View
            </button>
            {!readOnly ? (
              <div className="sa-agent-detail-table__menu">
                <button
                  aria-label="More actions"
                  className="sa-agent-detail-table__menu-trigger"
                  onClick={() =>
                    setMenuLeadId((current) => (current === lead.id ? null : lead.id))
                  }
                  type="button"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuLeadId === lead.id ? (
                  <div className="sa-agent-detail-table__menu-panel">
                    <button
                      onClick={() => {
                        setMenuLeadId(null);
                        setReassignTarget(lead);
                      }}
                      type="button"
                    >
                      Reassign
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="sa-agent-detail-page">
      <button
        className="sa-agent-detail-page__back"
        onClick={() => navigate(`${basePath}/agents`)}
        type="button"
      >
        <ArrowLeft size={16} />
        Back to agents
      </button>

      <header className="sa-agent-detail-page__header">
        <div className="sa-agent-detail-page__identity">
          <div className="sa-agent-detail-page__title-row">
            <h1>{agent?.displayName || (loading ? "Loading..." : "Sales agent")}</h1>
            {agent ? (
              <span
                className={`sa-agent-detail-page__status ${agent.isActive === false ? "is-inactive" : "is-active"}`}
              >
                <span className="sa-agent-detail-page__status-dot" />
                {agent.isActive === false ? "Inactive" : "Active"}
              </span>
            ) : null}
          </div>
          {agent?.email ? (
            <div className="sa-agent-detail-page__email-row">
              <span>{agent.email}</span>
              <button
                aria-label="Copy email"
                className="sa-agent-detail-page__copy"
                onClick={handleCopyEmail}
                type="button"
              >
                <Copy size={14} />
              </button>
              {copyFeedback ? (
                <span className="sa-agent-detail-page__copy-feedback">Copied</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <label className="sa-agents-page__period">
          <span className="sa-agents-page__period-label">
            <Calendar size={16} />
            Period
          </span>
          <label className="sa-agents-page__period-control">
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
            <ChevronDown aria-hidden="true" size={16} />
          </label>
        </label>
      </header>

      {error ? <div className="form-error-banner">{error}</div> : null}
      {loading ? (
        <p className="sa-agent-detail-page__loading" role="status">
          Loading agent...
        </p>
      ) : null}

      {!loading && detail ? (
        <>
          <section className="sa-agent-detail-metrics" aria-label="Agent metrics">
            <article className="sa-agent-detail-metric">
              <span className="sa-agent-detail-metric__icon" aria-hidden="true">
                <Users size={18} />
              </span>
              <div>
                <span className="sa-agent-detail-metric__label">Assigned leads</span>
                <strong className="sa-agent-detail-metric__value">{metrics.assignedLeads}</strong>
              </div>
            </article>

            <article className="sa-agent-detail-metric sa-agent-detail-metric--mix">
              <span className="sa-agent-detail-metric__label">Product mix (Total)</span>
              <div className="sa-agent-detail-metric__split">
                <div>
                  <span>Quoted</span>
                  <strong>{productMixTotals.quoted}</strong>
                </div>
                <div>
                  <span>Purchased</span>
                  <strong>{productMixTotals.purchased}</strong>
                </div>
              </div>
            </article>

            <article className="sa-agent-detail-metric">
              <span className="sa-agent-detail-metric__icon" aria-hidden="true">
                <IndianRupee size={18} />
              </span>
              <div>
                <span className="sa-agent-detail-metric__label">Revenue</span>
                <strong className="sa-agent-detail-metric__value">
                  {formatOversightCurrency(metrics.revenue)}
                </strong>
              </div>
            </article>

            <article className="sa-agent-detail-metric">
              <span className="sa-agent-detail-metric__icon" aria-hidden="true">
                <Crosshair size={18} />
              </span>
              <div>
                <span className="sa-agent-detail-metric__label">Conversion</span>
                <strong className="sa-agent-detail-metric__value sa-agent-detail-metric__value--percent">
                  {metrics.conversionRate}%
                </strong>
              </div>
            </article>
          </section>

          <section className="sa-agents-panel sa-agent-detail-leads">
            <div className="sa-agent-detail-leads__header">
              <div>
                <h2>Assigned leads</h2>
                <p>
                  Pipeline, purchases, and products per lead. Stale leads have no activity for{" "}
                  {STALE_LEAD_DAYS}+ days.
                </p>
              </div>
              <div className="sa-agent-detail-leads__actions">
                <div className="sa-agent-detail-export" ref={filterMenuRef}>
                  <button
                    aria-expanded={filterOpen}
                    className="sa-agent-detail-leads__toolbar-btn"
                    onClick={() => {
                      setFilterOpen((current) => !current);
                      setExportOpen(false);
                      setColumnsOpen(false);
                    }}
                    type="button"
                  >
                    <Filter size={15} />
                    Filter
                    {filterCount ? (
                      <span className="sa-agent-detail-leads__badge">{filterCount}</span>
                    ) : null}
                    <ChevronDown size={14} />
                  </button>
                  {filterOpen ? (
                    <div className="sa-agent-detail-panel-menu sa-agent-detail-panel-menu--wide">
                      <p className="sa-agent-detail-export__title">Filter leads</p>
                      <div className="sa-agent-detail-filters">
                        <label>
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
                        <label>
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
                        <label>
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
                        <label>
                          <span>Activity from</span>
                          <input
                            onChange={(event) => updateFilter("activityFrom", event.target.value)}
                            type="date"
                            value={filters.activityFrom}
                          />
                        </label>
                        <label>
                          <span>Activity to</span>
                          <input
                            onChange={(event) => updateFilter("activityTo", event.target.value)}
                            type="date"
                            value={filters.activityTo}
                          />
                        </label>
                        <label>
                          <span>Revenue min</span>
                          <input
                            min="0"
                            onChange={(event) => updateFilter("revenueMin", event.target.value)}
                            placeholder="0"
                            type="number"
                            value={filters.revenueMin}
                          />
                        </label>
                        <label>
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
                      <div className="sa-agent-detail-panel-menu__footer">
                        <button
                          className="ghost-button"
                          onClick={() => setFilters(EMPTY_FILTERS)}
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

                <div className="sa-agent-detail-export" ref={exportMenuRef}>
                  <button
                    aria-expanded={exportOpen}
                    aria-haspopup="menu"
                    className="sa-agent-detail-leads__toolbar-btn"
                    onClick={() => {
                      setExportOpen((current) => !current);
                      setFilterOpen(false);
                      setColumnsOpen(false);
                    }}
                    type="button"
                  >
                    <Download size={15} />
                    Export
                    <ChevronDown size={14} />
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

                <div className="sa-agent-detail-export" ref={columnsMenuRef}>
                  <button
                    aria-expanded={columnsOpen}
                    aria-label="Table settings"
                    className="sa-agent-detail-leads__icon-btn"
                    onClick={() => {
                      setColumnsOpen((current) => !current);
                      setExportOpen(false);
                      setFilterOpen(false);
                    }}
                    type="button"
                  >
                    <Settings2 size={16} />
                  </button>
                  {columnsOpen ? (
                    <div className="sa-agent-detail-panel-menu">
                      <p className="sa-agent-detail-export__title">Visible columns</p>
                      <p className="sa-agent-detail-panel-menu__hint">
                        Saved for {roleKey === "admin" ? "Admin" : "Sales Admin"} role
                      </p>
                      {LEAD_TABLE_COLUMNS.map((column) => (
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
            </div>

            <div className="sa-table-wrap sa-agent-detail-leads__table-wrap">
              <table className="sa-table sa-agent-detail-table">
                <thead>
                  <tr>
                    {LEAD_TABLE_COLUMNS.filter((column) => visibleColumnSet.has(column.id)).map(
                      (column) => (
                        <th key={column.id}>
                          {column.id === "assigned" || column.id === "lastActivity" ? (
                            <button
                              className="sa-agent-detail-table__sort"
                              onClick={() =>
                                toggleSort(column.id === "assigned" ? "assigned" : "activity")
                              }
                              type="button"
                            >
                              {column.label}
                              <ArrowUpDown size={13} />
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((lead) => (
                    <tr
                      className={isLeadStale(lead) ? "sa-agent-detail-table__row--stale" : ""}
                      key={lead.id}
                    >
                      {LEAD_TABLE_COLUMNS.filter((column) => visibleColumnSet.has(column.id)).map(
                        (column) => (
                          <td key={column.id}>{renderLeadCell(lead, column.id)}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredLeads.length === 0 ? (
              <p className="sa-agents-panel__empty">No leads match the current filters.</p>
            ) : (
              <footer className="sa-agents-panel__footer sa-agent-detail-leads__footer">
                <span>
                  Showing {pageStart} to {pageEnd} of {filteredLeads.length} leads
                </span>
                <div className="sa-agent-detail-leads__pager">
                  <label className="sa-agent-detail-leads__page-size">
                    <span>Rows per page</span>
                    <select
                      onChange={(event) => setPageSize(Number(event.target.value))}
                      value={pageSize}
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <nav aria-label="Leads pagination" className="sa-agents-panel__pagination">
                    <button
                      aria-label="Previous page"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <span className="sa-agents-panel__page-indicator">{currentPage}</span>
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
            )}
          </section>
        </>
      ) : null}

      {reassignTarget ? (
        <ReassignModal
          agents={agents.filter((entry) => entry.id !== userId)}
          lead={reassignTarget}
          onClose={() => setReassignTarget(null)}
          onSuccess={loadDetail}
        />
      ) : null}
    </div>
  );
}
