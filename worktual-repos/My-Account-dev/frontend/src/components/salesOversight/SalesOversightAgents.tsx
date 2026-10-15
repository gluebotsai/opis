// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Filter, Inbox, Search } from "lucide-react";

import {
  DATE_RANGE_OPTIONS,
  fetchOversightAgents,
  formatOversightCurrency,
} from "../../lib/salesOversight.js";
import { ProfileAvatar } from "../ProfileAvatar.tsx";
import { AdminPageToast } from "../admin/AdminPageToast.tsx";
import "../../styles/admin-users-light.css";
import "../../styles/sa-agents.css";

const SORT_OPTIONS = [
  { value: "revenue-desc", label: "Revenue (High to Low)" },
  { value: "revenue-asc", label: "Revenue (Low to High)" },
  { value: "pipeline-desc", label: "Pipeline (High to Low)" },
  { value: "leads-desc", label: "Assigned leads (High to Low)" },
  { value: "conversion-desc", label: "Conversion (High to Low)" },
  { value: "name-asc", label: "Name (A to Z)" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const ACTIVITY_OPTIONS = [
  { value: "all", label: "All activity" },
  { value: "with-leads", label: "Has assigned leads" },
  { value: "no-leads", label: "No assigned leads" },
];

const DEALS_OPTIONS = [
  { value: "all", label: "All deals" },
  { value: "with-deals", label: "Has paid deals" },
  { value: "no-deals", label: "No paid deals" },
];

function sortAgents(agents, sortKey) {
  const sorted = [...agents];

  sorted.sort((left, right) => {
    const leftMetrics = left.metrics || {};
    const rightMetrics = right.metrics || {};

    switch (sortKey) {
      case "revenue-asc":
        return leftMetrics.revenue - rightMetrics.revenue;
      case "pipeline-desc":
        return rightMetrics.pipelineValue - leftMetrics.pipelineValue;
      case "leads-desc":
        return rightMetrics.assignedLeads - leftMetrics.assignedLeads;
      case "conversion-desc":
        return rightMetrics.conversionRate - leftMetrics.conversionRate;
      case "name-asc":
        return String(left.displayName || left.email).localeCompare(
          String(right.displayName || right.email),
        );
      case "revenue-desc":
      default:
        return rightMetrics.revenue - leftMetrics.revenue;
    }
  });

  return sorted;
}

function AgentsFilterDropdown({
  activityFilter,
  containerRef,
  days,
  dealsFilter,
  departmentFilter,
  departmentOptions,
  onActivityChange,
  onClose,
  onDaysChange,
  onDealsChange,
  onDepartmentChange,
  onReset,
  onSortChange,
  sortBy,
}) {
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
    <div className="admin-users-filter-dropdown sa-agents-filter-dropdown" role="dialog" aria-label="Filter agents">
      <div className="sa-agents-filter-dropdown__scroll">
        <div className="admin-users-filter-dropdown__section">
          <p className="admin-users-filter-dropdown__title">Period & sort</p>
          <div className="admin-users-filter-dropdown__field">
            <span>Period</span>
            <select
              aria-label="Period"
              onChange={(event) => onDaysChange(Number(event.target.value))}
              value={days}
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-users-filter-dropdown__field">
            <span>Sort by</span>
            <select
              aria-label="Sort agents"
              onChange={(event) => onSortChange(event.target.value)}
              value={sortBy}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="admin-users-filter-dropdown__section">
          <p className="admin-users-filter-dropdown__title">Filter by</p>
          {departmentOptions.length > 1 ? (
            <div className="admin-users-filter-dropdown__field">
              <span>Department</span>
              <select
                aria-label="Filter by department"
                onChange={(event) => onDepartmentChange(event.target.value)}
                value={departmentFilter}
              >
                {departmentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="admin-users-filter-dropdown__field">
            <span>Activity</span>
            <select
              aria-label="Filter by activity"
              onChange={(event) => onActivityChange(event.target.value)}
              value={activityFilter}
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-users-filter-dropdown__field">
            <span>Deals</span>
            <select
              aria-label="Filter by deals"
              onChange={(event) => onDealsChange(event.target.value)}
              value={dealsFilter}
            >
              {DEALS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button className="secondary-button" onClick={onReset} type="button">
          Reset
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Apply
        </button>
      </div>
    </div>
  );
}

export function SalesOversightAgents({ basePath }) {
  const navigate = useNavigate();
  const filterAnchorRef = useRef(null);
  const [days, setDays] = useState(30);
  const [agents, setAgents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("revenue-desc");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [dealsFilter, setDealsFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchOversightAgents(days);
      setAgents(data.agents || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load agents.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortBy, days, pageSize, departmentFilter, activityFilter, dealsFilter]);

  const departmentOptions = useMemo(() => {
    const departments = [
      ...new Set(
        agents
          .map((agent) => String(agent.department || "").trim())
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right));

    return [
      { value: "all", label: "All departments" },
      ...departments.map((department) => ({ value: department, label: department })),
    ];
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortAgents(
      agents.filter((agent) => {
        const metrics = agent.metrics || {};
        const department = String(agent.department || "").trim();

        if (departmentFilter !== "all" && department !== departmentFilter) {
          return false;
        }

        if (activityFilter === "with-leads" && !(metrics.assignedLeads > 0)) {
          return false;
        }
        if (activityFilter === "no-leads" && metrics.assignedLeads > 0) {
          return false;
        }

        if (dealsFilter === "with-deals" && !(metrics.paidDeals > 0)) {
          return false;
        }
        if (dealsFilter === "no-deals" && metrics.paidDeals > 0) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = `${agent.displayName} ${agent.email} ${department}`.toLowerCase();
        return haystack.includes(query);
      }),
      sortBy,
    );
  }, [activityFilter, agents, dealsFilter, departmentFilter, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredAgents.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredAgents.length);
  const visibleAgents = filteredAgents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const hasActiveFilters =
    departmentFilter !== "all" ||
    activityFilter !== "all" ||
    dealsFilter !== "all" ||
    Boolean(searchQuery.trim());

  const countLabel =
    filteredAgents.length === 1
      ? "1 agent in view"
      : `${filteredAgents.length} agents in view`;

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  function openAgent(agentId) {
    navigate(`${basePath}/agents/${agentId}`);
  }

  function resetFilters() {
    setDepartmentFilter("all");
    setActivityFilter("all");
    setDealsFilter("all");
    setDays(30);
    setSortBy("revenue-desc");
  }

  function clearAllFilters() {
    resetFilters();
    setSearchQuery("");
  }

  const filtersActive =
    departmentFilter !== "all" ||
    activityFilter !== "all" ||
    dealsFilter !== "all" ||
    days !== 30 ||
    sortBy !== "revenue-desc";

  return (
    <section className="admin-users-page sa-agents-page">
      <div className="sa-agents-page__chrome">
        <button
          className="sa-agents-page__back"
          onClick={() => navigate(basePath)}
          type="button"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <header className="admin-users-page__header sa-agents-page__header">
          <div>
            <h1>Sales agents</h1>
            <p className="admin-users-page__subtitle">
              Compare performance across your sales team.
            </p>
          </div>
        </header>
      </div>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <section aria-busy={loading} className="admin-users-panel sa-agents-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All agents</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar sa-agents-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} aria-hidden="true" />
              <input
                aria-label="Search agents"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search agents…"
                type="search"
                value={searchQuery}
              />
            </label>

            <div className="admin-users-panel__filter-anchor" ref={filterAnchorRef}>
              <button
                className={`admin-users-panel__tool-button ${
                  showFilters || filtersActive ? "is-active" : ""
                }`}
                onClick={() => setShowFilters((current) => !current)}
                type="button"
              >
                <Filter size={16} aria-hidden="true" />
                Filters
              </button>
              {showFilters ? (
                <AgentsFilterDropdown
                  activityFilter={activityFilter}
                  containerRef={filterAnchorRef}
                  days={days}
                  dealsFilter={dealsFilter}
                  departmentFilter={departmentFilter}
                  departmentOptions={departmentOptions}
                  onActivityChange={setActivityFilter}
                  onClose={() => setShowFilters(false)}
                  onDaysChange={setDays}
                  onDealsChange={setDealsFilter}
                  onDepartmentChange={setDepartmentFilter}
                  onReset={resetFilters}
                  onSortChange={setSortBy}
                  sortBy={sortBy}
                />
              ) : null}
            </div>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading agents…
            </p>
          ) : null}

          {!loading && agents.length === 0 ? (
            <div className="sa-agents-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No sales agents yet</h3>
              <p>Agents appear here once they are assigned leads in this period.</p>
            </div>
          ) : null}

          {!loading && agents.length > 0 && filteredAgents.length === 0 ? (
            <div className="sa-agents-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching agents</h3>
              <p>Try a different search or clear the filters.</p>
              {hasActiveFilters ? (
                <button className="secondary-button" onClick={clearAllFilters} type="button">
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && visibleAgents.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table sa-agents-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Email</th>
                    <th>Assigned leads</th>
                    <th>Paid deals</th>
                    <th>Pipeline</th>
                    <th>Conversion</th>
                    <th>Revenue</th>
                    <th>Quotes submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAgents.map((agent) => {
                    const name = agent.displayName || agent.email;
                    const email = agent.email || "—";
                    const pipeline = formatOversightCurrency(agent.metrics.pipelineValue);
                    const revenue = formatOversightCurrency(agent.metrics.revenue);
                    const conversion = `${agent.metrics.conversionRate}%`;

                    return (
                      <tr
                        className="is-clickable"
                        key={agent.id}
                        onClick={() => openAgent(agent.id)}
                      >
                        <td title={name}>
                          <div className="sa-agent-cell">
                            <ProfileAvatar
                              className="sa-agent-cell__avatar"
                              email={email}
                              name={name}
                              seed={agent.id}
                            />
                            <strong className="sa-agents-table__name">{name}</strong>
                          </div>
                        </td>
                        <td className="sa-agents-table__email" title={email}>
                          {email}
                        </td>
                        <td>{agent.metrics.assignedLeads}</td>
                        <td>{agent.metrics.paidDeals}</td>
                        <td title={pipeline}>{pipeline}</td>
                        <td>{conversion}</td>
                        <td title={revenue}>{revenue}</td>
                        <td>{agent.metrics.quotationsSubmitted}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {!loading && filteredAgents.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {filteredAgents.length}
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
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <nav aria-label="Agents pagination" className="admin-users-panel__pagination">
                <button
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <ArrowLeft size={16} />
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button
                    className={pageNumber === currentPage ? "is-active" : ""}
                    key={pageNumber}
                    onClick={() => setPage(pageNumber)}
                    type="button"
                  >
                    {pageNumber}
                  </button>
                ))}
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
    </section>
  );
}
