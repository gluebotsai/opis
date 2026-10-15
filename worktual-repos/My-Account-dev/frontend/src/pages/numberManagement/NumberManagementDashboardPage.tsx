// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Hash,
  Inbox,
  Phone,
  Search,
  Users,
} from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { fetchNumberManagementDashboard } from "../../lib/numberManagement.js";
import "../../styles/admin-users-light.css";

const KPI_CARDS = [
  {
    id: "total",
    label: "Mapped numbers",
    icon: Phone,
    iconClass: "nm-dashboard-kpi__icon--mapped",
    valueKey: "totalMappedNumbers",
  },
  {
    id: "active",
    label: "Active mappings",
    icon: Hash,
    iconClass: "nm-dashboard-kpi__icon--active",
    valueKey: "activeMappings",
  },
  {
    id: "tenants",
    label: "Tenants with numbers",
    icon: Users,
    iconClass: "nm-dashboard-kpi__icon--tenants",
    valueKey: "tenantsWithMappings",
  },
  {
    id: "usage",
    label: "Usage rows",
    icon: Activity,
    iconClass: "nm-dashboard-kpi__icon--usage",
    valueKey: "usageRowsThisMonth",
  },
  {
    id: "unmapped",
    label: "Customers without mapping",
    icon: AlertCircle,
    iconClass: "nm-dashboard-kpi__icon--unmapped",
    valueKey: "customersWithoutMapping",
  },
];

export function NumberManagementDashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchNumberManagementDashboard();
        if (active) {
          setDashboard(data);
          setError("");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load dashboard.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const allCustomers = dashboard?.customers || [];

  const customers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return allCustomers;
    }
    return allCustomers.filter((row) =>
      [row.companyName, row.tenantId, row.contactName, row.workEmail]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [allCustomers, search]);

  const yearMonth = dashboard?.yearMonth || "this month";
  const customerCountLabel =
    customers.length === 1 ? "1 customer" : `${customers.length} customers`;

  return (
    <section className="admin-users-page nm-dashboard-page">
      <header className="page-header admin-users-page__header nm-dashboard-page__header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Customers with a number entitlement on Contact Center, CRM, or Campaign
            (agents, licensed users, or purchased numbers) — map numbers and review
            monthly agent/DID usage.
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <div
        aria-label="Number management summary"
        className="admin-users-kpi-grid nm-dashboard-kpi"
      >
        {KPI_CARDS.map((card) => {
          const Icon = card.icon;
          const raw = dashboard?.cards?.[card.valueKey];
          const value = loading ? "…" : raw ?? "—";
          const label =
            card.id === "usage" ? `Usage rows (${yearMonth})` : card.label;

          return (
            <article className="admin-users-kpi-card" key={card.id}>
              <div
                aria-hidden="true"
                className={`admin-users-kpi-card__icon ${card.iconClass}`}
              >
                <Icon size={18} strokeWidth={1.75} />
              </div>
              <div>
                <span title={label}>{label}</span>
                <strong title={String(value)}>{value}</strong>
              </div>
            </article>
          );
        })}
      </div>

      <section aria-busy={loading} className="admin-users-panel nm-dashboard-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Customers</h2>
            <p>
              {loading
                ? "Loading…"
                : `${customerCountLabel} · open a row to view mappings and usage`}
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search customers"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search company, tenant, contact…"
                type="search"
                value={search}
              />
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading customers…
            </p>
          ) : null}

          {!loading && customers.length === 0 ? (
            <div className="nm-dashboard-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>{allCustomers.length === 0 ? "No customers yet" : "No matching customers"}</h3>
              <p>
                {allCustomers.length === 0
                  ? "Customers appear here when Contact Center, CRM, or Campaign includes agents, licensed users, or purchased numbers."
                  : "Try a different search term."}
              </p>
              {search.trim() ? (
                <button className="secondary-button" onClick={() => setSearch("")} type="button">
                  Clear search
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && customers.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table nm-dashboard-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant ID</th>
                    <th>Contact</th>
                    <th>Mappings</th>
                    <th>Last usage month</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const company = customer.companyName || "—";
                    const tenant = customer.tenantId || "—";
                    const contact = customer.contactName || "—";
                    const email = customer.workEmail || "";
                    const mappings = String(customer.mappingCount ?? "—");
                    const lastUsage = customer.lastUsageMonth || "—";

                    return (
                      <tr
                        className="is-clickable"
                        key={customer.id}
                        onClick={() => navigate(`/number-management/customers/${customer.id}`)}
                      >
                        <td title={company}>
                          <strong className="nm-dashboard-table__company">{company}</strong>
                        </td>
                        <td title={tenant}>
                          <span className="nm-dashboard-table__tenant">{tenant}</span>
                        </td>
                        <td
                          className="nm-dashboard-table__contact-cell"
                          title={[contact, email].filter(Boolean).join(" · ")}
                        >
                          <span className="nm-dashboard-table__contact">{contact}</span>
                          {email ? (
                            <span className="nm-dashboard-table__email">{email}</span>
                          ) : null}
                        </td>
                        <td title={mappings}>{mappings}</td>
                        <td title={lastUsage}>{lastUsage}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
