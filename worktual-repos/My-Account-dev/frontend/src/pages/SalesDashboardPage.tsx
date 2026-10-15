// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Package,
  Search,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import {
  formatCurrency,
  formatDashboardDate,
} from "../lib/leadDashboard.js";
import { formatLeadCreatedDate } from "../lib/leads.js";
import { getCustomerPortfolio } from "../lib/organizations.js";
import {
  listSalesOpenProductRequests,
  productRequestDisplayStatus,
  productRequestDisplayStatusTone,
  productRequestListTitle,
  productRequestStatusLabel,
  productRequestTypeLabel,
} from "../lib/customerProductRequests.js";
import { getProductName, PRODUCT_CATALOG } from "../lib/productCatalog.js";
import { chartPalette } from "../lib/brandColors.js";
import { subscribeToAppEventsWithReconnect } from "../lib/eventStream.js";
import "../styles/sales-dashboard.css";

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

  const adoptionCounts = Object.fromEntries(
    (portfolio.productAdoptionRows || portfolio.productAdoption || []).map((row) => [
      row.productId,
      Number(row.count) || 0,
    ]),
  );

  // Always show every catalog product, including zero-count bars.
  const productAdoptionRows = PRODUCT_CATALOG.map((product) => ({
    productId: product.id,
    productName: getProductName(product.id),
    count: adoptionCounts[product.id] || 0,
  }));

  const summary = portfolio.summary || {};
  const customers = portfolio.customers || [];

  return {
    ...portfolio,
    summary: {
      ...summary,
      // KPI must match Customers module / table rows (includes Partially paid).
      totalCustomers: customers.length,
      totalMonthlyRecurring:
        summary.totalMonthlyRecurring ?? summary.portfolioMrr ?? 0,
      portfolioMrr: summary.portfolioMrr ?? summary.totalMonthlyRecurring ?? 0,
    },
    productAdoptionRows,
    customers,
    statusRows: portfolio.statusRows || [],
    renewals: portfolio.renewals || [],
  };
}

/** Customer-by-status donut — accent palette only (no black/grey series). */
const STATUS_COLORS = {
  Paid: "#098F6A",
  "Partially paid": "#3A9EE0",
  Approved: "#653AE0",
  "Pending Finance Review": "#E0B73A",
  Rejected: "#E06E3A",
  Qualified: "#3A3FE0",
  "In Progress": "#D83AE0",
  New: "#653AE0",
};

const STATUS_COLOR_FALLBACK = [
  "#653AE0",
  "#3A9EE0",
  "#098F6A",
  "#E0B73A",
  "#D83AE0",
  "#3A3FE0",
  "#E06E3A",
];

function statusChartColor(status, index = 0) {
  return STATUS_COLORS[status] || STATUS_COLOR_FALLBACK[index % STATUS_COLOR_FALLBACK.length];
}

const DASHBOARD_TABLE_LIMIT = 5;

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
          {rows.map((row, index) => {
            const fraction = row.count / total;
            const dash = fraction * circumference;
            const rotation = cumulative * 360 - 90;
            cumulative += fraction;
            const isHovered = hoveredStatus === row.status;
            const isDimmed = hoveredStatus && hoveredStatus !== row.status;
            const color = statusChartColor(row.status, index);

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
                stroke={color}
                strokeDasharray={`${dash} ${circumference}`}
                strokeLinecap="butt"
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
        {rows.map((row, index) => (
          <li
            className={hoveredStatus === row.status ? "is-hovered" : ""}
            key={row.status}
            onMouseEnter={() => setHoveredStatus(row.status)}
            onMouseLeave={() => setHoveredStatus(null)}
          >
            <span
              className="sales-dashboard-donut__swatch"
              style={{ background: statusChartColor(row.status, index) }}
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
            <div className="sales-dashboard-adoption__bar-track" aria-hidden="true">
              <div
                className={
                  row.count === 0
                    ? "sales-dashboard-adoption__bar sales-dashboard-adoption__bar--zero"
                    : "sales-dashboard-adoption__bar"
                }
                style={{
                  height:
                    row.count === 0 ? "6px" : `${(row.count / maxCount) * 100}%`,
                }}
              />
            </div>
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
              disabled={!entry.leadId || entry.canCreateRenewalQuote === false}
              onClick={() => onCreateRenewalQuote?.(entry)}
              title={
                entry.canCreateRenewalQuote === false
                  ? "Available after payment is confirmed and the product is active"
                  : undefined
              }
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

function ProductRequestsPanel({ requests, onOpenLead }) {
  if (requests.length === 0) {
    return (
      <p className="sales-dashboard-empty">No open customer product requests.</p>
    );
  }

  return (
    <ul className="sales-dashboard-product-requests">
      {requests.map((request) => {
        const displayStatus = productRequestDisplayStatus(request);
        const leadId = request.sourceLeadId;
        const company =
          String(request.companyName || "").trim() || "Customer";

        return (
          <li key={request.id}>
            <div className="sales-dashboard-product-requests__main">
              <strong>{company}</strong>
              <small>
                {productRequestListTitle(request)}
                {" · "}
                {productRequestTypeLabel(request.requestType)}
                {request.createdAt
                  ? ` · ${formatDashboardDate(request.createdAt)}`
                  : ""}
              </small>
            </div>
            <div className="sales-dashboard-product-requests__meta">
              <span
                className={`lead-dashboard-badge lead-dashboard-badge--${productRequestDisplayStatusTone(displayStatus)}`}
              >
                {productRequestStatusLabel(displayStatus)}
              </span>
              <button
                className="secondary-button sales-dashboard-product-requests__cta"
                disabled={!leadId}
                onClick={() => onOpenLead?.(leadId)}
                type="button"
              >
                <ShoppingCart size={16} />
                Open customer
              </button>
            </div>
          </li>
        );
      })}
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
  headerTitle = "Sales overview",
  hideDefaultTitle = false,
  leadScope,
} = {}) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(EMPTY_PORTFOLIO);
  const [productRequests, setProductRequests] = useState([]);
  const [statusSyncError, setStatusSyncError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const refreshCustomers = useCallback(async () => {
    try {
      const scopeOpts = leadScope ? { scope: leadScope } : undefined;
      const [portfolio, requests] = await Promise.all([
        getCustomerPortfolio(scopeOpts),
        listSalesOpenProductRequests(scopeOpts),
      ]);
      setDashboard(normalizePortfolio(portfolio));
      setProductRequests(Array.isArray(requests) ? requests : []);
      setStatusSyncError("");
    } catch (error) {
      setStatusSyncError(
        error instanceof Error ? error.message : "Could not load customers.",
      );
    }
  }, [leadScope]);

  useEffect(() => {
    void refreshCustomers();
  }, [refreshCustomers]);

  useEffect(() => {
    let reloadTimer = null;

    const unsubscribe = subscribeToAppEventsWithReconnect({
      channels: ["quotations", "payments", "cancellations", "requests"],
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        const shouldRefresh =
          eventName.startsWith("quotation.") ||
          eventName.startsWith("payment.") ||
          eventName.startsWith("cancellation.") ||
          eventName.startsWith("product_request.") ||
          eventName.startsWith("branch_add.");

        if (!shouldRefresh) {
          return;
        }

        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        // Debounce bursts (approve + pay + welcome) into one portfolio reload.
        reloadTimer = window.setTimeout(() => {
          void refreshCustomers();
        }, 500);
      },
    });

    function handleFocus() {
      void refreshCustomers();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [refreshCustomers]);

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
          productId: entry.productId,
        },
      });
    },
    [navigate],
  );

  const handleOpenProductRequestLead = useCallback(
    (leadId) => {
      if (!leadId) {
        return;
      }
      navigate(`/customers/${leadId}`);
    },
    [navigate],
  );

  const visibleProductRequests = useMemo(
    () => productRequests.slice(0, DASHBOARD_TABLE_LIMIT),
    [productRequests],
  );

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return dashboard.customers.filter((customer) => {
      const companyName = String(customer.companyName || "").toLowerCase();
      const contactName = String(customer.contactName || "").toLowerCase();
      return (
        query.length === 0 ||
        companyName.includes(query) ||
        contactName.includes(query)
      );
    });
  }, [dashboard.customers, searchQuery]);

  const visibleCustomers = filteredCustomers.slice(0, DASHBOARD_TABLE_LIMIT);

  return (
    <section className="sales-dashboard-page">
      <header className="page-header">
        <div>
          <h1 className={hideDefaultTitle ? "page-header__title-select" : undefined}>
            {headerTitle}
          </h1>
          <p className="page-header__copy">{headerDescription}</p>
        </div>
      </header>

      <AdminPageToast error={statusSyncError} onDismiss={() => setStatusSyncError("")} />

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
                <Icon size={18} strokeWidth={2} />
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
            <h2>Product requests</h2>
            <p>
              Open inquiries, upgrades, and new product requests from your customers.
              {productRequests.length > 0
                ? ` ${productRequests.length} open.`
                : ""}
            </p>
          </div>
        </div>
        <div className="sales-dashboard-panel__content sales-dashboard-panel__content--product-requests">
          <ProductRequestsPanel
            onOpenLead={handleOpenProductRequestLead}
            requests={visibleProductRequests}
          />
          {productRequests.length > DASHBOARD_TABLE_LIMIT ? (
            <p className="sales-dashboard-product-requests__more">
              Showing {DASHBOARD_TABLE_LIMIT} of {productRequests.length}. Open a
              customer to see all requests on their account.
            </p>
          ) : null}
        </div>
      </section>

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
              className="sales-dashboard-table-tools__view-all"
              onClick={() => navigate("/customers")}
              type="button"
            >
              View all
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

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
                  <th>Products</th>
                  {/* Hidden for now — single-location UI.
                  <th>Locations</th>
                  */}
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
                    className={`is-clickable${customer.isActive ? "" : " is-inactive"}`}
                    onClick={() => navigate(`/customers/${customer.leadId}`)}
                  >
                    <td>
                      <div className="sales-dashboard-table__company">
                        <span className="sales-dashboard-table__company-icon">
                          <Building2 size={15} />
                        </span>
                        {customer.companyName}
                      </div>
                    </td>
                    <td>{customer.contactName}</td>
                    <td>{customer.activeProductCount}</td>
                    {/* Hidden for now — single-location UI.
                    <td>{customer.locationCount}</td>
                    */}
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
