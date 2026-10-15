// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Inbox, LayoutDashboard, Plus, RefreshCw, Users } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { usePortalLeadCreate } from "../../components/leads/PortalLeadCreateProvider.tsx";
import { fetchResellerLeads, fetchResellerRenewals } from "../../lib/resellerAuth.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/reseller-portal.css";

const RECENT_LIMIT = 8;

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function ResellerDashboardPage() {
  const navigate = useNavigate();
  const { startCreateLead } = usePortalLeadCreate();
  const [leads, setLeads] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(() => {
    setLoading(true);
    Promise.all([fetchResellerLeads(), fetchResellerRenewals({ withinDays: 30 })])
      .then(([nextLeads, nextRenewals]) => {
        setLeads(nextLeads);
        setRenewals(nextRenewals);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load dashboard.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadDashboard();

    function handleLeadUpdated() {
      loadDashboard();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => {
      window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
    };
  }, [loadDashboard]);

  usePortalLiveDataReload(loadDashboard);

  const activeLeads = leads.filter((lead) => lead.status !== "Rejected").length;

  const recentLeads = useMemo(() => {
    return [...leads]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, RECENT_LIMIT);
  }, [leads]);

  const recentCountLabel =
    recentLeads.length === 1 ? "1 recent lead" : `${recentLeads.length} recent leads`;

  return (
    <section className="admin-users-page reseller-dashboard-page">
      <header className="page-header admin-users-page__header reseller-dashboard-page__header">
        <div>
          <h1>Reseller dashboard</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Submit customer leads, track renewals, and view billing. Sales admin creates quotes for
            your leads.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button admin-users-page__create"
            onClick={startCreateLead}
            type="button"
          >
            <Plus size={18} strokeWidth={1.75} />
            Create lead
          </button>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <div aria-label="Reseller summary" className="admin-users-kpi-grid reseller-dashboard-kpi">
        <article className="admin-users-kpi-card">
          <div
            aria-hidden="true"
            className="admin-users-kpi-card__icon reseller-dashboard-kpi__icon--active"
          >
            <Users size={18} strokeWidth={1.75} />
          </div>
          <div>
            <span title="Active leads">Active leads</span>
            <strong title={String(loading ? "…" : activeLeads)}>
              {loading ? "…" : activeLeads}
            </strong>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div
            aria-hidden="true"
            className="admin-users-kpi-card__icon reseller-dashboard-kpi__icon--renewals"
          >
            <RefreshCw size={18} strokeWidth={1.75} />
          </div>
          <div>
            <span title="Renewals due (30d)">Renewals due (30d)</span>
            <strong title={String(loading ? "…" : renewals.length)}>
              {loading ? "…" : renewals.length}
            </strong>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div
            aria-hidden="true"
            className="admin-users-kpi-card__icon reseller-dashboard-kpi__icon--total"
          >
            <LayoutDashboard size={18} strokeWidth={1.75} />
          </div>
          <div>
            <span title="Total leads">Total leads</span>
            <strong title={String(loading ? "…" : leads.length)}>
              {loading ? "…" : leads.length}
            </strong>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel reseller-dashboard-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Recent leads</h2>
            <p>
              {loading
                ? "Loading…"
                : leads.length === 0
                  ? "No leads yet"
                  : `${recentCountLabel} · open a row for details`}
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            {leads.length === 0 ? (
              <button
                className="secondary-button reseller-dashboard-view-all"
                disabled
                type="button"
              >
                View all
              </button>
            ) : (
              <Link className="secondary-button reseller-dashboard-view-all" to="/reseller/leads">
                View all
              </Link>
            )}
            <Link className="secondary-button reseller-dashboard-view-all" to="/reseller/renewals">
              Renewals
            </Link>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading leads…
            </p>
          ) : null}

          {!loading && leads.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No leads yet</h3>
              <p>
                Create your first customer lead using Create lead above. Sales admin will create the
                quote and billing.
              </p>
            </div>
          ) : null}

          {!loading && recentLeads.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table reseller-dashboard-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map((lead) => {
                    const company = lead.companyName || "—";
                    const contact = lead.contactName || "—";
                    const status = lead.status || "—";
                    const created = formatDate(lead.createdAt);

                    return (
                      <tr
                        className="is-clickable"
                        key={lead.id}
                        onClick={() => navigate(`/reseller/leads/${lead.id}`)}
                      >
                        <td title={company}>
                          <strong className="reseller-table__company">{company}</strong>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={status}>{status}</td>
                        <td title={created}>{created}</td>
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
