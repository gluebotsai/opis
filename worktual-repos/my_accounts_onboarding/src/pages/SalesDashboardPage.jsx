import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Filter,
  Package,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  formatCurrency,
  formatDashboardDate,
} from "../lib/leadDashboard.js";
import { formatLeadCreatedDate } from "../lib/leads.js";
import { getCustomerPortfolio } from "../lib/organizations.js";
import { getProductName } from "../lib/productCatalog.js";
import { brandColors, chartPalette } from "../lib/brandColors.js";

const EMPTY_PORTFOLIO = {
  summary: {
    totalCustomers: 0,
    activeCustomers: 0,
    totalActiveProducts: 0,
    totalMonthlyRecurring: 0,
    portfolioMrr: 0,
    currency: "INR",
    renewalsSoon: 0,
    pendingFinanceReview: 0,
  },
  customers: [],
  statusRows: [],
  productAdoptionRows: [],
  renewals: [],
};

function normalizePortfolio(portfolio) {
  if (!portfolio) {
    return EMPTY_PORTFOLIO;
  }

  const productAdoptionRows = (
    portfolio.productAdoptionRows ||
    portfolio.productAdoption ||
    []
  ).map((row) => ({
    ...row,
    productName: row.productName || getProductName(row.productId),
  }));

  const summary = portfolio.summary || {};

  return {
    ...portfolio,
    summary: {
      ...summary,
      totalMonthlyRecurring:
        summary.totalMonthlyRecurring ?? summary.portfolioMrr ?? 0,
      portfolioMrr: summary.portfolioMrr ?? summary.totalMonthlyRecurring ?? 0,
    },
    productAdoptionRows,
    customers: portfolio.customers || [],
    statusRows: portfolio.statusRows || [],
    renewals: portfolio.renewals || [],
  };
}

const STATUS_COLORS = {
  Approved: brandColors.success,
  "Pending Finance Review": brandColors.warning,
  Rejected: brandColors.danger,
};

const DASHBOARD_TABLE_LIMIT = 5;

function StatusBadge({ status }) {
  const tone =
    status === "Approved"
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

function DonutChart({ rows = [] }) {
  const [hoveredStatus, setHoveredStatus] = useState(null);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const hoveredRow = rows.find((row) => row.status === hoveredStatus);

  if (total === 0) {
    return <p className="sales-dashboard-empty">No customers yet.</p>;
  }

  let cumulative = 0;

  return (
    <div className="sales-dashboard-donut">
      <div
        className="sales-dashboard-donut__chart"
        onMouseLeave={() => setHoveredStatus(null)}
      >
        <svg aria-hidden="true" className="sales-dashboard-donut__svg" viewBox="0 0 140 140">
          <circle
            cx="70"
            cy="70"
            fill="none"
            r={radius}
            stroke={chartPalette.track}
            strokeWidth="20"
          />
          {rows.map((row) => {
            const fraction = row.count / total;
            const dash = fraction * circumference;
            const rotation = cumulative * 360 - 90;
            cumulative += fraction;
            const isHovered = hoveredStatus === row.status;
            const isDimmed = hoveredStatus && hoveredStatus !== row.status;

            return (
              <circle
                className={`sales-dashboard-donut__segment ${
                  isHovered ? "is-hovered" : ""
                } ${isDimmed ? "is-dimmed" : ""}`}
                cx="70"
                cy="70"
                fill="none"
                key={row.status}
                onMouseEnter={() => setHoveredStatus(row.status)}
                r={radius}
                stroke={STATUS_COLORS[row.status] || chartPalette.primaryMuted}
                strokeDasharray={`${dash} ${circumference}`}
                strokeLinecap="round"
                strokeWidth="20"
                transform={`rotate(${rotation} 70 70)`}
              />
            );
          })}
        </svg>
        <div className="sales-dashboard-donut__center">
          <strong>{hoveredRow ? hoveredRow.count : total}</strong>
          <span>{hoveredRow ? hoveredRow.status : "Total"}</span>
        </div>
      </div>
      <ul className="sales-dashboard-donut__legend">
        {rows.map((row) => (
          <li
            className={hoveredStatus === row.status ? "is-hovered" : ""}
            key={row.status}
            onMouseEnter={() => setHoveredStatus(row.status)}
            onMouseLeave={() => setHoveredStatus(null)}
          >
            <span
              className="sales-dashboard-donut__swatch"
              style={{ background: STATUS_COLORS[row.status] || chartPalette.primaryMuted }}
            />
            <span className="sales-dashboard-donut__label">{row.status}</span>
            <strong>{row.count}</strong>
            <span className="sales-dashboard-donut__pct">
              {Math.round((row.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdoptionChart({ rows = [] }) {
  if (rows.length === 0) {
    return (
      <div className="sales-dashboard-adoption">
        <svg
          aria-hidden="true"
          className="sales-dashboard-adoption__wave"
          preserveAspectRatio="none"
          viewBox="0 0 400 120"
        >
          <defs>
            <linearGradient id="adoptionGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={chartPalette.primary} stopOpacity="0.32" />
              <stop offset="100%" stopColor={chartPalette.primary} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,82 C40,58 90,96 140,68 C190,40 240,88 290,52 C340,24 370,44 400,36 L400,120 L0,120 Z"
            fill="url(#adoptionGrad)"
          />
          <path
            d="M0,82 C40,58 90,96 140,68 C190,40 240,88 290,52 C340,24 370,44 400,36"
            fill="none"
            stroke={chartPalette.primary}
            strokeOpacity="0.55"
            strokeWidth="2"
          />
        </svg>
        <p className="sales-dashboard-adoption__empty">
          No active products across customers yet.
        </p>
      </div>
    );
  }

  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="sales-dashboard-adoption sales-dashboard-adoption--active">
      <div className="sales-dashboard-adoption__bars">
        {rows.map((row) => (
          <div
            className="sales-dashboard-adoption__bar-group"
            key={row.productId}
            title={`${row.productName}: ${row.count}`}
          >
            <div
              className={
                row.count === 0
                  ? "sales-dashboard-adoption__bar sales-dashboard-adoption__bar--zero"
                  : "sales-dashboard-adoption__bar"
              }
              style={{
                height:
                  row.count === 0 ? "8px" : `${(row.count / maxCount) * 100}%`,
              }}
            />
            <span className="sales-dashboard-adoption__bar-label">{row.productName}</span>
            <strong>{row.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RenewalsPanel({ renewals, onCreateRenewalQuote }) {
  if (renewals.length === 0) {
    return (
      <div className="sales-dashboard-renewals-empty">
        <div className="sales-dashboard-renewals-empty__icon">
          <CalendarClock size={28} strokeWidth={1.5} />
        </div>
        <p>No renewals due in the next 30 days.</p>
      </div>
    );
  }

  return (
    <ul className="sales-dashboard-renewals">
      {renewals.map((entry) => (
        <li key={entry.subscriptionId || entry.id}>
          <div>
            <strong>{entry.companyName}</strong>
            <small>
              {entry.productName} · {entry.branchLabel}
            </small>
          </div>
          <div className="sales-dashboard-renewals__actions">
            <span>
              {entry.daysRemaining} days · {formatDashboardDate(entry.renewsAt)}
            </span>
            <button
              className="secondary-button sales-dashboard-renewals__cta"
              disabled={!entry.leadId}
              onClick={() => onCreateRenewalQuote?.(entry)}
              type="button"
            >
              Create quote
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SUMMARY_STATS = [
  {
    key: "totalCustomers",
    label: "Total customers",
    hint: "All active accounts",
    icon: Users,
    tone: "customers",
    getValue: (summary) => summary.totalCustomers,
  },
  {
    key: "activeSubscriptions",
    label: "Active subscriptions",
    hint: "Currently running",
    icon: Package,
    tone: "subscriptions",
    getValue: (summary) => summary.totalActiveProducts,
  },
  {
    key: "portfolioMrr",
    label: "Portfolio MRR",
    hint: "Monthly recurring revenue",
    icon: TrendingUp,
    tone: "mrr",
    getValue: (summary, format) =>
      format(summary.totalMonthlyRecurring ?? summary.portfolioMrr ?? 0, summary.currency),
  },
  {
    key: "pendingFinance",
    label: "Pending finance review",
    hint: "Requires attention",
    icon: AlertTriangle,
    tone: "finance",
    getValue: (summary) => summary.pendingFinanceReview,
  },
  {
    key: "renewalsSoon",
    label: "Renewals in 30 days",
    hint: "Upcoming renewals",
    icon: CalendarClock,
    tone: "renewals",
    getValue: (summary) => summary.renewalsSoon,
  },
];

export function SalesDashboardPage({
  headerDescription = "Real-time portfolio insights across customers, subscriptions, usage, renewals, and financial health.",
  headerEyebrow = null,
  headerTitle = "Sales overview",
  hideDefaultTitle = false,
  leadScope,
} = {}) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(EMPTY_PORTFOLIO);
  const [statusSyncError, setStatusSyncError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const refreshCustomers = useCallback(async () => {
    try {
      const portfolio = await getCustomerPortfolio(leadScope ? { scope: leadScope } : undefined);
      setDashboard(normalizePortfolio(portfolio));
      setStatusSyncError("");
    } catch (error) {
      setStatusSyncError(
        error instanceof Error ? error.message : "Could not load customers.",
      );
    }
  }, [leadScope]);

  const syncQuotationStatuses = useCallback(async () => {
    await refreshCustomers();
  }, [refreshCustomers]);

  useEffect(() => {
    refreshCustomers();
    syncQuotationStatuses();
  }, [refreshCustomers, syncQuotationStatuses]);

  const handleCreateRenewalQuote = useCallback(
    (entry) => {
      if (!entry?.leadId) {
        return;
      }

      navigate(`/products/${entry.leadId}/workflow`, {
        state: {
          freshQuote: true,
          renewal: true,
          subscriptionId: entry.subscriptionId,
        },
      });
    },
    [navigate],
  );

  const statusOptions = useMemo(
    () => ["all", ...dashboard.statusRows.map((row) => row.status)],
    [dashboard.statusRows],
  );

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return dashboard.customers.filter((customer) => {
      const companyName = String(customer.companyName || "").toLowerCase();
      const contactName = String(customer.contactName || "").toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        companyName.includes(query) ||
        contactName.includes(query);
      const matchesStatus = statusFilter === "all" || customer.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [dashboard.customers, searchQuery, statusFilter]);

  const visibleCustomers = filteredCustomers.slice(0, DASHBOARD_TABLE_LIMIT);

  return (
    <section className="sales-dashboard-page">
      <header className="page-header">
        <div>
          {headerEyebrow ? <p className="eyebrow">{headerEyebrow}</p> : null}
          <h1 className={hideDefaultTitle ? "page-header__title-select" : undefined}>
            {headerTitle}
          </h1>
          <p className="page-header__copy">{headerDescription}</p>
        </div>
        {/* <div className="page-header__actions">
          <button className="secondary-button" onClick={() => navigate("/products")} type="button">
            View all leads
            <ArrowRight size={16} />
          </button>
          <button className="primary-button" onClick={() => navigate("/onboarding")} type="button">
            New customer
          </button> 
        </div> */}
      </header>

      {statusSyncError ? <p className="form-error">{statusSyncError}</p> : null}

      <div className="sales-dashboard-summary">
        {SUMMARY_STATS.map((stat) => {
          const Icon = stat.icon;
          const value =
            stat.key === "portfolioMrr"
              ? stat.getValue(dashboard.summary, formatCurrency)
              : stat.getValue(dashboard.summary);

          return (
            <article key={stat.key} className="sales-dashboard-stat-card onboarding-card">
              <div className={`sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--${stat.tone}`}>
                <Icon size={20} strokeWidth={2} />
              </div>
              <div className="sales-dashboard-stat-card__body">
                <span className="sales-dashboard-stat-card__label">{stat.label}</span>
                <strong className="sales-dashboard-stat-card__value">{value}</strong>
                <span className="sales-dashboard-stat-card__hint">{stat.hint}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="sales-dashboard-grid">
        <section className="onboarding-card sales-dashboard-panel sales-dashboard-panel--insights">
          <h2>Customers by status</h2>
          <div className="sales-dashboard-panel__content">
            {dashboard.statusRows.length === 0 ? (
              <p className="sales-dashboard-empty">No customers yet.</p>
            ) : (
              <DonutChart rows={dashboard.statusRows} />
            )}
          </div>
        </section>

        <section className="onboarding-card sales-dashboard-panel sales-dashboard-panel--insights">
          <h2>Product adoption</h2>
          <div className="sales-dashboard-panel__content">
            <AdoptionChart rows={dashboard.productAdoptionRows} />
          </div>
        </section>

        <section className="onboarding-card sales-dashboard-panel sales-dashboard-panel--insights">
          <h2>Upcoming renewals</h2>
          <div className="sales-dashboard-panel__content sales-dashboard-panel__content--renewals">
            <RenewalsPanel
              onCreateRenewalQuote={handleCreateRenewalQuote}
              renewals={dashboard.renewals}
            />
          </div>
        </section>
      </div>

      <section className="onboarding-card sales-dashboard-panel">
        <div className="sales-dashboard-panel__header">
          <div>
            <h2>All customers</h2>
            <p>Click a row to open the account overview and start a new quote.</p>
          </div>
          <div className="sales-dashboard-table-tools">
            <label className="sales-dashboard-table-tools__search">
              <Search size={16} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search customers..."
                type="search"
                value={searchQuery}
              />
            </label>
            <button
              aria-expanded={showFilters}
              className={`sales-dashboard-table-tools__filter ${showFilters ? "is-active" : ""}`}
              onClick={() => setShowFilters((current) => !current)}
              type="button"
            >
              <Filter size={16} />
            </button>
            <button
              className="sales-dashboard-table-tools__view-all"
              onClick={() => navigate("/products")}
              type="button"
            >
              View all
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {showFilters ? (
          <div className="sales-dashboard-table-filters">
            <label className="field">
              <span>Status</span>
              <select
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? "All statuses" : status}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {dashboard.customers.length === 0 ? (
          <p className="sales-dashboard-empty">
            No customers yet. Create a lead to populate the dashboard.
          </p>
        ) : filteredCustomers.length === 0 ? (
          <p className="sales-dashboard-empty">No customers match your search or filters.</p>
        ) : (
          <div className="sales-dashboard-table-wrap">
            <table className="sales-dashboard-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th>Locations</th>
                  <th>Avg usage</th>
                  <th>Next renewal</th>
                  <th>MRR</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {visibleCustomers.map((customer) => (
                  <tr
                    key={customer.leadId}
                    className={customer.isActive ? "" : "is-inactive"}
                    onClick={() => navigate(`/products/${customer.leadId}`)}
                  >
                    <td className="sales-dashboard-table__company">
                      <span className="sales-dashboard-table__company-icon">
                        <Building2 size={15} />
                      </span>
                      {customer.companyName}
                    </td>
                    <td>{customer.contactName}</td>
                    <td>
                      <StatusBadge status={customer.status} />
                    </td>
                    <td>{customer.activeProductCount}</td>
                    <td>{customer.locationCount}</td>
                    <td>
                      <div className="sales-dashboard-mini-usage">
                        <div
                          className="sales-dashboard-mini-usage__fill"
                          style={{ width: `${customer.avgUsagePercent}%` }}
                        />
                      </div>
                      <span className="sales-dashboard-mini-usage__label">
                        {customer.avgUsagePercent}%
                      </span>
                    </td>
                    <td>
                      {customer.nextRenewalDays === null
                        ? "—"
                        : `${customer.nextRenewalDays} days`}
                    </td>
                    <td>
                      {formatCurrency(customer.monthlyRecurring, dashboard.summary.currency)}
                    </td>
                    <td>{formatLeadCreatedDate(customer.customerSince)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
