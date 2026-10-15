// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock3, Inbox, Plus, Users } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { usePortalLeadCreate } from "../../components/leads/PortalLeadCreateProvider.tsx";
import { fetchPartnerLeads } from "../../lib/partnerAuth.js";
import { partnerQuotationStatusLabel } from "../../lib/partnerQuotations.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-dashboard.css";

const RECENT_LIMIT = 8;

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function assignmentLabel(lead) {
  return lead.assignedUserId ? "Assigned" : "Awaiting assignment";
}

export function PartnerDashboardPage() {
  const navigate = useNavigate();
  const { startCreateLead } = usePortalLeadCreate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLeads = useCallback(() => {
    setLoading(true);
    fetchPartnerLeads()
      .then((rows) => {
        setLeads(rows);
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
    loadLeads();

    function handleLeadUpdated() {
      loadLeads();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => {
      window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
    };
  }, [loadLeads]);

  usePortalLiveDataReload(loadLeads);

  const activeLeads = leads.filter((lead) => lead.status !== "Rejected").length;
  const unassigned = leads.filter((lead) => !lead.assignedUserId).length;

  const recentLeads = useMemo(() => {
    return [...leads]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, RECENT_LIMIT);
  }, [leads]);

  const recentCountLabel =
    recentLeads.length === 1 ? "1 recent referral" : `${recentLeads.length} recent referrals`;

  return (
    <section className="admin-users-page partner-dashboard-page">
      <header className="page-header admin-users-page__header partner-dashboard-page__header">
        <div>
          <h1>Partner dashboard</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Submit customer referrals and track progress. Sales will assign an executive and create
            quotes — you cannot quote from this portal.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button admin-users-page__create"
            onClick={startCreateLead}
            type="button"
          >
            <Plus size={18} strokeWidth={1.75} />
            Lead creation
          </button>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <div aria-label="Referral summary" className="admin-users-kpi-grid partner-dashboard-kpi">
        <article className="admin-users-kpi-card">
          <div
            aria-hidden="true"
            className="admin-users-kpi-card__icon partner-dashboard-kpi__icon--active"
          >
            <Users size={18} strokeWidth={1.75} />
          </div>
          <div>
            <span title="Active referrals">Active referrals</span>
            <strong title={String(loading ? "…" : activeLeads)}>
              {loading ? "…" : activeLeads}
            </strong>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div
            aria-hidden="true"
            className="admin-users-kpi-card__icon partner-dashboard-kpi__icon--awaiting"
          >
            <Clock3 size={18} strokeWidth={1.75} />
          </div>
          <div>
            <span title="Awaiting assignment">Awaiting assignment</span>
            <strong title={String(loading ? "…" : unassigned)}>
              {loading ? "…" : unassigned}
            </strong>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel partner-dashboard-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Recent referrals</h2>
            <p>
              {loading
                ? "Loading…"
                : leads.length === 0
                  ? "No referrals yet"
                  : `${recentCountLabel} · open a row for details`}
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            {leads.length === 0 ? (
              <button
                className="secondary-button partner-dashboard-view-all"
                disabled
                type="button"
              >
                View all
              </button>
            ) : (
              <Link className="secondary-button partner-dashboard-view-all" to="/partner/leads">
                View all
              </Link>
            )}
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading referrals…
            </p>
          ) : null}

          {!loading && leads.length === 0 ? (
            <div className="partner-dashboard-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No referrals yet</h3>
              <p>
                Submit a customer referral using Lead creation above. Sales will assign an executive
                and handle quoting.
              </p>
            </div>
          ) : null}

          {!loading && recentLeads.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table partner-dashboard-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Lead status</th>
                    <th>Quotation</th>
                    <th>Assignment</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map((lead) => {
                    const company = lead.companyName || "—";
                    const contact = lead.contactName || "—";
                    const status = lead.status || "—";
                    const quotation =
                      lead.latestQuotationStatusLabel ||
                      partnerQuotationStatusLabel(lead.latestQuotationStatus);
                    const assignment = assignmentLabel(lead);
                    const created = formatDate(lead.createdAt);

                    return (
                      <tr
                        className="is-clickable"
                        key={lead.id}
                        onClick={() => navigate(`/partner/leads/${lead.id}`)}
                      >
                        <td title={company}>
                          <strong className="partner-dashboard-table__company">{company}</strong>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={status}>{status}</td>
                        <td title={quotation}>{quotation}</td>
                        <td title={assignment}>{assignment}</td>
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
