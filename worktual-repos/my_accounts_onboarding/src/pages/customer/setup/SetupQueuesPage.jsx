import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleAlert, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  SetupPageHeader,
  SetupStatCard,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import { getPurchasedProductCatalog } from "../../../lib/productCatalog.js";
import {
  createQueue,
  deleteQueue,
  listCcaasEligibleAgents,
  listQueues,
  listTeams,
} from "../../../lib/setup/setupApi.js";

const EMPTY_FORM = {
  name: "",
  teamId: "",
  status: "active",
  agentIds: [],
};

function userDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.workEmail || "Untitled user";
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="setup-field-error" role="alert">
      <CircleAlert aria-hidden size={14} />
      <span>{message}</span>
    </p>
  );
}

export function SetupQueuesPage() {
  const navigate = useNavigate();
  const { dashboard, loading: dashboardLoading } = useCustomerDashboard();
  const hasCcaas = useMemo(() => {
    const purchased = getPurchasedProductCatalog(dashboard?.activeProducts);
    return purchased.some((product) => product.id === "contact-center");
  }, [dashboard?.activeProducts]);

  const [queues, setQueues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [eligibleAgents, setEligibleAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (dashboardLoading) return;
    if (!hasCcaas) {
      navigate("/customer/setup/business-profile", { replace: true });
    }
  }, [dashboardLoading, hasCcaas, navigate]);

  async function refresh() {
    const [queueRows, teamRows, agentRows] = await Promise.all([
      listQueues(),
      listTeams(),
      listCcaasEligibleAgents(),
    ]);
    setQueues(queueRows);
    setTeams(teamRows);
    setEligibleAgents(agentRows);
  }

  useEffect(() => {
    if (!hasCcaas) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load queues.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasCcaas]);

  const teamsById = useMemo(() => {
    const map = new Map();
    for (const team of teams) map.set(team.id, team);
    return map;
  }, [teams]);

  const agentsForSelectedTeam = useMemo(() => {
    if (!form.teamId) return [];
    const team = teamsById.get(form.teamId);
    const memberIds = new Set((team?.memberIds || []).map(String));
    return eligibleAgents.filter(
      (agent) =>
        String(agent.teamId || "") === String(form.teamId) || memberIds.has(String(agent.id)),
    );
  }, [eligibleAgents, form.teamId, teamsById]);

  const nameError = useMemo(() => {
    if (!form.name.trim()) {
      return attemptedSubmit ? "Queue name is required." : "";
    }
    return "";
  }, [attemptedSubmit, form.name]);

  const teamError = useMemo(() => {
    if (!form.teamId) {
      return attemptedSubmit ? "Select a team for this queue." : "";
    }
    return "";
  }, [attemptedSubmit, form.teamId]);

  function resetFormState() {
    setForm(EMPTY_FORM);
    setAttemptedSubmit(false);
    setError("");
  }

  function closeForm() {
    resetFormState();
    setShowForm(false);
  }

  function openCreateForm() {
    resetFormState();
    setShowForm(true);
  }

  function handleEdit(queue) {
    navigate(`/customer/setup/queues/${queue.id}`);
  }

  function toggleAgent(agentId) {
    setForm((current) => {
      const set = new Set(current.agentIds);
      if (set.has(agentId)) set.delete(agentId);
      else set.add(agentId);
      return { ...current, agentIds: [...set] };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setAttemptedSubmit(true);
    if (!form.name.trim() || !form.teamId) return;

    setSaving(true);
    setError("");
    try {
      const created = await createQueue({
        name: form.name.trim(),
        teamId: form.teamId,
        status: form.status,
        agents: form.agentIds.map((userId) => ({
          userId,
          handlesCalls: true,
          callType: "both",
          handlesEmail: true,
          handlesChat: true,
          handlesWhatsapp: false,
          handlesInstagram: false,
          handlesFacebook: false,
          emailConcurrency: 1,
          chatConcurrency: 1,
          whatsappConcurrency: 1,
          instagramConcurrency: 1,
          facebookConcurrency: 1,
        })),
      });
      closeForm();
      await refresh();
      navigate(`/customer/setup/queues/${created.id}`);
    } catch (err) {
      setError(err.message || "Failed to save queue.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(queue) {
    if (!window.confirm(`Delete queue “${queue.name}”? Agents will be unassigned.`)) return;
    try {
      await deleteQueue(queue.id);
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to delete queue.");
    }
  }

  if (!hasCcaas && !dashboardLoading) {
    return null;
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button className="primary-button" onClick={openCreateForm} type="button">
            <Plus size={16} />
            Add queue
          </button>
        }
        copy="Create Contact Centre queues, pick one team per queue, and assign CCaaS agents. Each agent can belong to only one queue."
        title="Queues"
      />

      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {showForm ? (
            <form className="setup-form-panel" onSubmit={handleSubmit}>
              <div className="setup-entity-card__top">
                <h2 style={{ margin: 0 }}>Add queue</h2>
                <button className="secondary-button" onClick={closeForm} type="button">
                  <X size={16} />
                  Cancel
                </button>
              </div>
              <div className="setup-form-grid">
                <label className={`field${nameError ? " field--invalid" : ""}`}>
                  <span>Queue name</span>
                  <input
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="e.g. Support inbound"
                    value={form.name}
                  />
                  <FieldError message={nameError} />
                </label>
                <label className={`field${teamError ? " field--invalid" : ""}`}>
                  <span>Team</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teamId: event.target.value,
                        agentIds: [],
                      }))
                    }
                    value={form.teamId}
                  >
                    <option value="">Select a team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <FieldError message={teamError} />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => ({ ...current, status: event.target.value }))
                    }
                    value={form.status}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              {form.teamId ? (
                <div className="field field--full">
                  <span>Assign agents from {teamsById.get(form.teamId)?.name || "team"}</span>
                  {agentsForSelectedTeam.length ? (
                    <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                      {agentsForSelectedTeam.map((agent) => {
                        const assignedElsewhere = Boolean(agent.assignedQueueId);
                        const selected = form.agentIds.includes(agent.id);
                        return (
                          <button
                            className={`setup-chip ${selected ? "setup-chip--active" : ""}`}
                            disabled={assignedElsewhere}
                            key={agent.id}
                            onClick={() => toggleAgent(agent.id)}
                            title={
                              assignedElsewhere
                                ? `Already on queue “${agent.assignedQueueName}”`
                                : undefined
                            }
                            type="button"
                          >
                            {userDisplayName(agent)}
                            {assignedElsewhere ? ` · ${agent.assignedQueueName}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="field__hint" style={{ margin: "8px 0 0" }}>
                      No Contact Centre agents on this team yet. Add CCaaS access under User
                      details.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="setup-form-actions">
                <button className="primary-button" disabled={saving} type="submit">
                  {saving ? "Saving…" : "Create queue"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading queues…</p>
          ) : (
            <div className="setup-table-wrap">
              <table className="setup-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Agents</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((queue) => (
                    <tr
                      className="setup-table-row--clickable"
                      key={queue.id}
                      onClick={() => navigate(`/customer/setup/queues/${queue.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/customer/setup/queues/${queue.id}`);
                        }
                      }}
                      role="link"
                      tabIndex={0}
                    >
                      <td>
                        <strong>{queue.name}</strong>
                      </td>
                      <td>{queue.teamName || "—"}</td>
                      <td>{queue.agentCount ?? 0}</td>
                      <td>
                        <SetupStatusBadge
                          status={queue.status === "active" ? "Active" : "Inactive"}
                          tone={queue.status === "active" ? "success" : "neutral"}
                        />
                      </td>
                      <td>
                        <div className="setup-row-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            aria-label={`Edit ${queue.name}`}
                            className="icon-button"
                            onClick={() => handleEdit(queue)}
                            type="button"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            aria-label={`Delete ${queue.name}`}
                            className="icon-button"
                            onClick={() => handleDelete(queue)}
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!queues.length ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--text-caption)" }}>
                        No queues yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Queues" value={queues.length} />
          <SetupStatCard
            label="Agents assigned"
            value={queues.reduce((sum, queue) => sum + (queue.agentCount || 0), 0)}
          />
        </aside>
      </div>
    </section>
  );
}
