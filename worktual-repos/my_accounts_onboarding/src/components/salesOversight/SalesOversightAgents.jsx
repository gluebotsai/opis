import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Search,
} from "lucide-react";

import {
  DATE_RANGE_OPTIONS,
  agentInitials,
  fetchOversightAgents,
  formatOversightCurrency,
} from "../../lib/salesOversight.js";

const SORT_OPTIONS = [
  { value: "revenue-desc", label: "Revenue (High to Low)" },
  { value: "revenue-asc", label: "Revenue (Low to High)" },
  { value: "pipeline-desc", label: "Pipeline (High to Low)" },
  { value: "leads-desc", label: "Assigned leads (High to Low)" },
  { value: "conversion-desc", label: "Conversion (High to Low)" },
  { value: "name-asc", label: "Name (A to Z)" },
];

const PAGE_SIZE = 10;

const AVATAR_TONES = ["purple", "teal", "amber", "rose", "blue", "indigo"];

function getAvatarTone(id = "") {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = id.charCodeAt(index) + ((hash << 5) - hash);
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

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

export function SalesOversightAgents({ basePath }) {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [agents, setAgents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("revenue-desc");
  const [viewMode, setViewMode] = useState("list");
  const [page, setPage] = useState(1);
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
  }, [searchQuery, sortBy, days, viewMode]);

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortAgents(
      agents.filter((agent) => {
        if (!query) {
          return true;
        }

        const haystack = `${agent.displayName} ${agent.email} ${agent.department}`.toLowerCase();
        return haystack.includes(query);
      }),
      sortBy,
    );
  }, [agents, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredAgents.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredAgents.length);
  const visibleAgents = filteredAgents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="sa-agents-page">
      <header className="sa-agents-page__header">
        <div>
          <p className="sa-agents-page__eyebrow">Sales oversight</p>
          <h1>Sales agents</h1>
          <p className="sa-agents-page__subtitle">Compare performance across your sales team.</p>
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

      <section aria-busy={loading} className="sa-agents-panel">
        <div className="sa-agents-panel__toolbar">
          <label className="sa-agents-panel__search">
            <Search size={18} />
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search agents..."
              type="search"
              value={searchQuery}
            />
          </label>

          <div className="sa-agents-panel__toolbar-actions">
            <label className="sa-agents-panel__sort">
              <span>Sort by</span>
              <span className="sa-agents-panel__sort-control">
                <select
                  aria-label="Sort agents"
                  onChange={(event) => setSortBy(event.target.value)}
                  value={sortBy}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={16} />
              </span>
            </label>

            <div aria-label="View mode" className="sa-agents-panel__view-toggle" role="group">
              <button
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                className={viewMode === "list" ? "is-active" : ""}
                onClick={() => setViewMode("list")}
                type="button"
              >
                <LayoutList size={18} />
              </button>
              <button
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                className={viewMode === "grid" ? "is-active" : ""}
                onClick={() => setViewMode("grid")}
                type="button"
              >
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>
        </div>

        {loading ? <p className="sa-agents-panel__loading">Loading agents...</p> : null}

        {!loading && viewMode === "list" ? (
          <>
            <div className="sa-table-wrap sa-agents-panel__table-wrap">
              <table className="sa-table sa-agents-table">
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAgents.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <div className="sa-agent-cell">
                          <span
                            className={`sa-agent-cell__avatar sa-agent-cell__avatar--${getAvatarTone(agent.id)}`}
                          >
                            {agentInitials(agent.displayName || agent.email)}
                          </span>
                          <span className="sa-agents-table__name">
                            {agent.displayName || agent.email}
                          </span>
                        </div>
                      </td>
                      <td className="sa-agents-table__email">{agent.email}</td>
                      <td>{agent.metrics.assignedLeads}</td>
                      <td>{agent.metrics.paidDeals}</td>
                      <td>{formatOversightCurrency(agent.metrics.pipelineValue)}</td>
                      <td>{agent.metrics.conversionRate}%</td>
                      <td>{formatOversightCurrency(agent.metrics.revenue)}</td>
                      <td>{agent.metrics.quotationsSubmitted}</td>
                      <td>
                        <button
                          className="sa-agents-table__action"
                          onClick={() => navigate(`${basePath}/agents/${agent.id}`)}
                          type="button"
                        >
                          View details
                          <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!visibleAgents.length ? (
              <p className="sa-agents-panel__empty">No sales agents match your search.</p>
            ) : null}
          </>
        ) : null}

        {!loading && viewMode === "grid" ? (
          <div className="sa-agents-grid">
            {visibleAgents.map((agent) => (
              <article className="sa-agents-grid__card" key={agent.id}>
                <div className="sa-agents-grid__header">
                  <span
                    className={`sa-agent-cell__avatar sa-agent-cell__avatar--${getAvatarTone(agent.id)}`}
                  >
                    {agentInitials(agent.displayName || agent.email)}
                  </span>
                  <div>
                    <h2>{agent.displayName || agent.email}</h2>
                    <p>{agent.email}</p>
                  </div>
                </div>
                <dl className="sa-agents-grid__metrics">
                  <div>
                    <dt>Assigned leads</dt>
                    <dd>{agent.metrics.assignedLeads}</dd>
                  </div>
                  <div>
                    <dt>Paid deals</dt>
                    <dd>{agent.metrics.paidDeals}</dd>
                  </div>
                  <div>
                    <dt>Pipeline</dt>
                    <dd>{formatOversightCurrency(agent.metrics.pipelineValue)}</dd>
                  </div>
                  <div>
                    <dt>Revenue</dt>
                    <dd>{formatOversightCurrency(agent.metrics.revenue)}</dd>
                  </div>
                </dl>
                <button
                  className="sa-agents-table__action"
                  onClick={() => navigate(`${basePath}/agents/${agent.id}`)}
                  type="button"
                >
                  View details
                  <ArrowRight size={15} />
                </button>
              </article>
            ))}

            {!visibleAgents.length ? (
              <p className="sa-agents-panel__empty">No sales agents match your search.</p>
            ) : null}
          </div>
        ) : null}

        {!loading && filteredAgents.length > 0 ? (
          <footer className="sa-agents-panel__footer">
            <span>
              Showing {pageStart} to {pageEnd} of {filteredAgents.length} agents
            </span>
            <nav aria-label="Agents pagination" className="sa-agents-panel__pagination">
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
          </footer>
        ) : null}
      </section>
    </div>
  );
}
