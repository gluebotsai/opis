// @ts-nocheck
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";

import { AdminPageToast } from "../admin/AdminPageToast.tsx";
import {
  fetchOversightAgents,
  fetchUnassignedLeads,
  reassignLead,
} from "../../lib/salesOversight.js";

import "../../styles/admin-users-light.css";
import "../../styles/sa-unassigned-leads.css";

export function UnassignedPartnerLeadsPanel() {
  const [leads, setLeads] = useState([]);
  const [agents, setAgents] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loadingId, setLoadingId] = useState("");

  async function loadData() {
    const [leadRows, agentRows] = await Promise.all([
      fetchUnassignedLeads(),
      fetchOversightAgents(30),
    ]);
    setLeads((leadRows.leads || leadRows || []).filter((lead) => lead.sourceType === "partner"));
    setAgents(agentRows.agents || agentRows || []);
  }

  useEffect(() => {
    loadData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load unassigned leads.");
    });
  }, []);

  async function handleAssign(leadId) {
    const toUserId = assignments[leadId];
    if (!toUserId) {
      setError("Select a sales executive before assigning.");
      return;
    }

    setLoadingId(leadId);
    setError("");
    setMessage("");
    try {
      await reassignLead(leadId, {
        toUserId,
        reason: "Assigned partner referral from oversight queue",
      });
      setMessage("Lead assigned to sales executive.");
      await loadData();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Could not assign lead.");
    } finally {
      setLoadingId("");
    }
  }

  const salesAgents = agents.filter((agent) => agent.role === "sales");

  return (
    <section className="admin-users-panel sa-unassigned-leads">
      <header className="admin-users-panel__section-header">
        <div>
          <h2>Partner referrals awaiting assignment</h2>
          <p>
            {leads.length
              ? `${leads.length} referral${leads.length === 1 ? "" : "s"} · assign to a sales executive`
              : "No partner referrals waiting for assignment"}
          </p>
        </div>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
        success={message}
      />

      <div className="admin-users-panel__body">
        {leads.length === 0 ? (
          <div className="sa-unassigned-leads__empty" role="status">
            <Inbox size={28} aria-hidden="true" />
            <h3>No referrals waiting</h3>
            <p>Partner referrals that need a sales owner appear here.</p>
          </div>
        ) : (
          <div className="admin-users-panel__table-wrap sa-unassigned-leads__table-wrap">
            <table className="admin-users-table sa-unassigned-leads__table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Tenant ID</th>
                  <th>Status</th>
                  <th className="sa-unassigned-leads__col--assign">Assign to</th>
                  <th className="sa-unassigned-leads__col--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td title={lead.companyName || "—"}>
                      <div className="sa-unassigned-leads__company">
                        <strong>{lead.companyName || "—"}</strong>
                        <span className="sa-unassigned-leads__pill">Partner referral</span>
                      </div>
                    </td>
                    <td title={lead.tenantId || "—"}>{lead.tenantId || "—"}</td>
                    <td title={lead.status || "—"}>{lead.status || "—"}</td>
                    <td className="sa-unassigned-leads__col--assign">
                      <label className="sa-unassigned-leads__select">
                        <span className="sr-only">Assign {lead.companyName} to</span>
                        <select
                          aria-label={`Assign ${lead.companyName || "lead"} to sales executive`}
                          onChange={(event) =>
                            setAssignments((current) => ({
                              ...current,
                              [lead.id]: event.target.value,
                            }))
                          }
                          value={assignments[lead.id] || ""}
                        >
                          <option value="">Select sales executive</option>
                          {salesAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.displayName || agent.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="sa-unassigned-leads__col--actions">
                      <button
                        className="sa-unassigned-leads__assign"
                        disabled={loadingId === lead.id}
                        onClick={() => handleAssign(lead.id)}
                        type="button"
                      >
                        {loadingId === lead.id ? "Assigning…" : "Assign"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
