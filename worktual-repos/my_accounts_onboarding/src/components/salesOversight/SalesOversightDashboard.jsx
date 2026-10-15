import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CircleDollarSign,
  Filter,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

import {
  DATE_RANGE_OPTIONS,
  agentInitials,
  fetchOversightDashboard,
  formatCompactInr,
  formatOversightCurrency,
  formatRelativeTime,
  getPeriodComparisonLabel,
} from "../../lib/salesOversight.js";
import { brandColors, chartGreys, chartPalette } from "../../lib/brandColors.js";

const FUNNEL_COLORS = chartGreys.slice(0, 4);

function TrendBadge({ delta, suffix = "%" }) {
  const numeric = Number(delta) || 0;
  const isUp = numeric >= 0;

  return (
    <span className={`sa-trend ${isUp ? "sa-trend--up" : "sa-trend--down"}`}>
      {isUp ? "▲" : "▼"} {Math.abs(numeric)}
      {suffix}
    </span>
  );
}

function RevenueTrendChart({ rows }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const chart = useMemo(() => {
    if (!rows.length) {
      return { points: [], labels: [], max: 1 };
    }

    const max = Math.max(...rows.map((row) => row.revenue), 1);
    const width = 560;
    const height = 220;
    const padding = { top: 16, right: 12, bottom: 28, left: 44 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const points = rows.map((row, index) => {
      const x = padding.left + (index / Math.max(rows.length - 1, 1)) * innerWidth;
      const y = padding.top + innerHeight - (row.revenue / max) * innerHeight;
      return { ...row, x, y };
    });

    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`;

    return { points, linePath, areaPath, max, width, height, padding, innerHeight };
  }, [rows]);

  if (!rows.length) {
    return <p className="sa-empty">No revenue recorded in this period.</p>;
  }

  const hovered = hoverIndex !== null ? chart.points[hoverIndex] : null;

  return (
    <div className="sa-revenue-chart">
      <svg aria-hidden="true" className="sa-revenue-chart__svg" viewBox={`0 0 ${chart.width} ${chart.height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = chart.padding.top + chart.innerHeight - tick * chart.innerHeight;
          const value = chart.max * tick;
          return (
            <g key={tick}>
              <line
                stroke={chartPalette.grid}
                strokeDasharray="4 4"
                x1={chart.padding.left}
                x2={chart.width - chart.padding.right}
                y1={y}
                y2={y}
              />
              <text className="sa-revenue-chart__axis" x={8} y={y + 4}>
                {value >= 100000 ? `${(value / 100000).toFixed(1)}L` : value >= 1000 ? `${Math.round(value / 1000)}K` : Math.round(value)}
              </text>
            </g>
          );
        })}
        <path d={chart.areaPath} fill="url(#saRevenueGradient)" />
        <path d={chart.linePath} fill="none" stroke={chartPalette.primary} strokeWidth="2.5" />
        {chart.points.map((point, index) => (
          <circle
            cx={point.x}
            cy={point.y}
            fill={chartPalette.primary}
            key={point.day}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
            r={hoverIndex === index ? 5 : 3}
          />
        ))}
        <defs>
          <linearGradient id="saRevenueGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.primary} stopOpacity="0.28" />
            <stop offset="100%" stopColor={chartPalette.primary} stopOpacity="0.02" />
          </linearGradient>
        </defs>
      </svg>
      {hovered ? (
        <div className="sa-revenue-chart__tooltip">
          <strong>{new Date(hovered.day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</strong>
          <span>{formatCompactInr(hovered.revenue)}</span>
        </div>
      ) : null}
      <div className="sa-revenue-chart__labels">
        {chart.points.filter((_, index) => index % Math.ceil(chart.points.length / 6) === 0 || index === chart.points.length - 1).map((point) => (
          <span key={point.day}>
            {new Date(point.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
}

function PipelineFunnelChart({ rows }) {
  if (!rows.length) {
    return <p className="sa-empty">No pipeline data yet.</p>;
  }

  return (
    <div className="sa-funnel-chart">
      {rows.map((row, index) => (
        <div className="sa-funnel-chart__row" key={row.status}>
          <div
            className="sa-funnel-chart__bar"
            style={{
              width: `${Math.max(row.percentage, 8)}%`,
              background: FUNNEL_COLORS[index] || FUNNEL_COLORS[FUNNEL_COLORS.length - 1],
            }}
          />
          <div className="sa-funnel-chart__meta">
            <strong>{row.status}</strong>
            <span>
              {formatOversightCurrency(row.value)} ({row.percentage}%)
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityIcon({ type }) {
  if (type === "payment_received") {
    return <CircleDollarSign size={16} />;
  }
  if (type === "lead_assigned") {
    return <UserPlus size={16} />;
  }
  if (type === "proposal_approved") {
    return <Filter size={16} />;
  }
  return <Users size={16} />;
}

export function SalesOversightDashboard({
  basePath,
  readOnly = false,
  headerDescription = "Monitor sales performance, pipeline health, and agent workload.",
  headerEyebrow = "Sales Admin",
  headerTitle = "Team dashboard",
  hideDefaultTitle = false,
}) {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchOversightDashboard(days);
      setDashboard(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = dashboard?.summary;
  const trends = summary?.trends;
  const periodComparisonLabel = getPeriodComparisonLabel(days);

  return (
    <div className="sa-dashboard">
      <header className="sa-dashboard__header">
        <div>
          <p className="sa-dashboard__eyebrow">{readOnly ? "Admin · Read only" : headerEyebrow}</p>
          <h1 className={hideDefaultTitle ? "page-header__title-select" : undefined}>
            {headerTitle}
          </h1>
          <p>{headerDescription}</p>
        </div>
        <label className="sa-dashboard__period">
          <span>Period</span>
          <select onChange={(event) => setDays(Number(event.target.value))} value={days}>
            {DATE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? <div className="form-error-banner">{error}</div> : null}
      {loading ? <p className="route-loading" role="status">Loading dashboard...</p> : null}

      {!loading && dashboard ? (
        <>
          <section className="sa-kpi-grid">
            <article className="sa-kpi-card">
              <div className="sa-kpi-card__icon sa-kpi-card__icon--primary">
                <TrendingUp size={18} strokeWidth={1.75} />
              </div>
              <div>
                <span>Revenue</span>
                <strong>{formatOversightCurrency(summary.revenue)}</strong>
                <small>
                  <TrendBadge delta={trends.revenue} /> vs {periodComparisonLabel}
                </small>
              </div>
            </article>
            <article className="sa-kpi-card">
              <div className="sa-kpi-card__icon sa-kpi-card__icon--secondary">
                <Filter size={18} strokeWidth={1.75} />
              </div>
              <div>
                <span>Pipeline value</span>
                <strong>{formatOversightCurrency(summary.pipelineValue)}</strong>
                <small>
                  <TrendBadge delta={trends.pipelineValue} /> vs {periodComparisonLabel}
                </small>
              </div>
            </article>
            <article className="sa-kpi-card">
              <div className="sa-kpi-card__icon sa-kpi-card__icon--info">
                <Users size={18} strokeWidth={1.75} />
              </div>
              <div>
                <span>Total leads</span>
                <strong>{summary.totalLeads}</strong>
                <small>
                  <TrendBadge delta={trends.totalLeads} suffix="" /> vs {periodComparisonLabel}
                </small>
              </div>
            </article>
            <article className="sa-kpi-card">
              <div className="sa-kpi-card__icon sa-kpi-card__icon--success">
                <Target size={18} strokeWidth={1.75} />
              </div>
              <div>
                <span>Conversion rate</span>
                <strong className="sa-kpi-card__value--percent">{summary.conversionRate}%</strong>
                <small>
                  <TrendBadge delta={trends.conversionRate} suffix=" pts" /> vs {periodComparisonLabel}
                </small>
              </div>
            </article>
          </section>

          <section className="sa-dashboard__charts">
            <article className="sa-panel">
              <div className="sa-panel__header">
                <div>
                  <h2>Revenue trend</h2>
                </div>
                <span className="sa-panel__chip">Daily</span>
              </div>
              <RevenueTrendChart rows={dashboard.revenueTrend} />
            </article>

            <article className="sa-panel">
              <div className="sa-panel__header">
                <div>
                  <h2>Pipeline funnel</h2>
                </div>
                <span className="sa-panel__chip">By value</span>
              </div>
              <PipelineFunnelChart rows={dashboard.pipelineFunnel} />
            </article>
          </section>

          <section className="sa-dashboard__tables">
            <article className="sa-panel">
              <div className="sa-panel__header">
                <h2>Agent performance</h2>
              </div>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Assigned leads</th>
                      <th>Conversion</th>
                      <th>Pipeline value</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.agentPerformance.map((agent) => (
                      <tr
                        className="sa-table__clickable"
                        key={agent.userId}
                        onClick={() => navigate(`${basePath}/agents/${agent.userId}`)}
                      >
                        <td>
                          <div className="sa-agent-cell">
                            <span className="sa-agent-cell__avatar">{agentInitials(agent.displayName)}</span>
                            <span>{agent.displayName}</span>
                          </div>
                        </td>
                        <td>{agent.assignedLeads}</td>
                        <td>
                          <div className="sa-conversion-cell">
                            <div className="sa-conversion-cell__track">
                              <div
                                className="sa-conversion-cell__bar"
                                style={{ width: `${Math.min(agent.conversionRate, 100)}%` }}
                              />
                            </div>
                            <span>{agent.conversionRate}%</span>
                          </div>
                        </td>
                        <td>{formatOversightCurrency(agent.pipelineValue)}</td>
                        <td>{formatOversightCurrency(agent.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="sa-panel__link"
                onClick={() => navigate(`${basePath}/agents`)}
                type="button"
              >
                View all agents
                <ArrowRight size={15} />
              </button>
            </article>

            <article className="sa-panel">
              <div className="sa-panel__header">
                <h2>Top quoted products</h2>
              </div>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Quotes</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.topQuotedProducts.map((product) => (
                      <tr key={product.productId}>
                        <td>{product.productId}</td>
                        <td>{product.quoteCount}</td>
                        <td>{formatOversightCurrency(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="sa-panel sa-panel--activity">
            <div className="sa-panel__header">
              <h2>Recent activity</h2>
            </div>
            <div className="sa-activity-row">
              {dashboard.recentActivity.map((item, index) => (
                <article className="sa-activity-card" key={`${item.type}-${item.timestamp}-${index}`}>
                  <div className="sa-activity-card__icon">
                    <ActivityIcon type={item.type} />
                  </div>
                  <div>
                    <p>{item.label}</p>
                    {item.amount ? (
                      <strong>{formatOversightCurrency(item.amount, item.currency || "INR")}</strong>
                    ) : null}
                    <small>{formatRelativeTime(item.timestamp)}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
