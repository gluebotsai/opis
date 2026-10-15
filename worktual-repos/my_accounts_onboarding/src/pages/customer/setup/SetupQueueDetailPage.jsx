import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleAlert, Loader2 } from "lucide-react";

import {
  SetupPageHeader,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import { getPurchasedProductCatalog } from "../../../lib/productCatalog.js";
import {
  getQueue,
  listCcaasEligibleAgents,
  listTeams,
  replaceQueueAgents,
  updateQueue,
} from "../../../lib/setup/setupApi.js";

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

function defaultAgentRow(userId) {
  return {
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
  };
}

const CALL_TYPE_OPTIONS = [
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
  { value: "both", label: "Both" },
];

function ChannelToggle({
  checked,
  concurrency,
  label,
  onToggle,
  onConcurrencyChange,
  showConcurrency = true,
  hint,
  callType,
  onCallTypeChange,
  showCallType = false,
}) {
  return (
    <div className="queue-channel-cell">
      <input
        aria-label={label}
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        type="checkbox"
      />
      {hint && !showCallType ? <span className="queue-channel-cell__hint">{hint}</span> : null}
      {showCallType && checked ? (
        <select
          aria-label="Call type"
          className="queue-channel-cell__call-type"
          onChange={(event) => onCallTypeChange(event.target.value)}
          title="Call type"
          value={callType || "both"}
        >
          {CALL_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {showConcurrency && checked ? (
        <input
          aria-label={`${label} concurrency`}
          className="queue-channel-cell__concurrency"
          min={1}
          onChange={(event) => onConcurrencyChange(Number(event.target.value) || 1)}
          title={`${label} concurrency`}
          type="number"
          value={concurrency ?? 1}
        />
      ) : null}
    </div>
  );
}

export function SetupQueueDetailPage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const { dashboard, loading: dashboardLoading } = useCustomerDashboard();
  const hasCcaas = useMemo(() => {
    const purchased = getPurchasedProductCatalog(dashboard?.activeProducts);
    return purchased.some((product) => product.id === "contact-center");
  }, [dashboard?.activeProducts]);

  const [queue, setQueue] = useState(null);
  const [teams, setTeams] = useState([]);
  const [eligibleAgents, setEligibleAgents] = useState([]);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [status, setStatus] = useState("active");
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (dashboardLoading) return;
    if (!hasCcaas) {
      navigate("/customer/setup/business-profile", { replace: true });
    }
  }, [dashboardLoading, hasCcaas, navigate]);

  async function refresh() {
    const [queueRow, teamRows, agentRows] = await Promise.all([
      getQueue(queueId),
      listTeams(),
      listCcaasEligibleAgents(),
    ]);
    setQueue(queueRow);
    setTeams(teamRows);
    setEligibleAgents(agentRows);
    setName(queueRow.name || "");
    setTeamId(queueRow.teamId || "");
    setStatus(queueRow.status || "active");
    setAgents(
      (queueRow.agents || []).map((agent) => ({
        userId: agent.userId,
        handlesCalls: Boolean(agent.handlesCalls),
        callType: agent.callType || "both",
        handlesEmail: Boolean(agent.handlesEmail),
        handlesChat: Boolean(agent.handlesChat),
        handlesWhatsapp: Boolean(agent.handlesWhatsapp),
        handlesInstagram: Boolean(agent.handlesInstagram),
        handlesFacebook: Boolean(agent.handlesFacebook),
        emailConcurrency: agent.emailConcurrency || 1,
        chatConcurrency: agent.chatConcurrency || 1,
        whatsappConcurrency: agent.whatsappConcurrency || 1,
        instagramConcurrency: agent.instagramConcurrency || 1,
        facebookConcurrency: agent.facebookConcurrency || 1,
      })),
    );
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
        if (!cancelled) {
          setQueue(null);
          setError(err.message || "Failed to load queue.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasCcaas, queueId]);

  const teamsById = useMemo(() => {
    const map = new Map();
    for (const team of teams) map.set(team.id, team);
    return map;
  }, [teams]);

  const agentsForTeam = useMemo(() => {
    if (!teamId) return [];
    const team = teamsById.get(teamId);
    const memberIds = new Set((team?.memberIds || []).map(String));
    return eligibleAgents.filter(
      (agent) =>
        String(agent.teamId || "") === String(teamId) || memberIds.has(String(agent.id)),
    );
  }, [eligibleAgents, teamId, teamsById]);

  const selectedIds = useMemo(() => new Set(agents.map((agent) => agent.userId)), [agents]);

  const nameError = attemptedSubmit && !name.trim() ? "Queue name is required." : "";
  const teamError = attemptedSubmit && !teamId ? "Select a team for this queue." : "";

  function toggleAgent(agentId) {
    setAgents((current) => {
      if (current.some((agent) => agent.userId === agentId)) {
        return current.filter((agent) => agent.userId !== agentId);
      }
      return [...current, defaultAgentRow(agentId)];
    });
  }

  function updateAgentField(userId, key, value) {
    setAgents((current) =>
      current.map((agent) => (agent.userId === userId ? { ...agent, [key]: value } : agent)),
    );
  }

  async function handleSave(event) {
    event?.preventDefault?.();
    setAttemptedSubmit(true);
    setSuccess("");
    if (!name.trim() || !teamId) {
      setError("Fill in the required queue name and team before saving.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateQueue(queueId, {
        name: name.trim(),
        teamId,
        status,
      });
      await replaceQueueAgents(queueId, agents);
      await refresh();
      setSuccess(`Queue saved with ${agents.length} agent${agents.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err.message || "Failed to save queue.");
    } finally {
      setSaving(false);
    }
  }

  if (!hasCcaas && !dashboardLoading) {
    return null;
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="secondary-button"
            onClick={() => navigate("/customer/setup/queues")}
            type="button"
          >
            <ArrowLeft size={16} />
            Back to queues
          </button>
        }
        copy="Assign Contact Centre agents from this queue’s team. An agent can only belong to one queue."
        title={queue?.name || "Queue details"}
      />

      {error ? (
        <div className="form-error-banner" role="alert">
          <CircleAlert aria-hidden size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {success ? <div className="form-success-banner">{success}</div> : null}

      {loading ? (
        <p style={{ fontSize: "13px" }}>Loading queue…</p>
      ) : queue ? (
        <form className="setup-form-panel" noValidate onSubmit={handleSave}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <SetupStatusBadge
              status={status === "active" ? "Active" : "Inactive"}
              tone={status === "active" ? "success" : "neutral"}
            />
          </div>

          <div className="setup-form-grid">
            <label className={`field${nameError ? " field--invalid" : ""}`}>
              <span>Queue name</span>
              <input onChange={(event) => setName(event.target.value)} value={name} />
              <FieldError message={nameError} />
            </label>
            <label className={`field${teamError ? " field--invalid" : ""}`}>
              <span>Team</span>
              <select
                onChange={(event) => {
                  const nextTeamId = event.target.value;
                  setTeamId(nextTeamId);
                  const team = teamsById.get(nextTeamId);
                  const memberIds = new Set((team?.memberIds || []).map(String));
                  setAgents((current) =>
                    current.filter((agent) => {
                      const user = eligibleAgents.find((row) => row.id === agent.userId);
                      return (
                        String(user?.teamId || "") === String(nextTeamId) ||
                        memberIds.has(String(agent.userId))
                      );
                    }),
                  );
                }}
                value={teamId}
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
              <select onChange={(event) => setStatus(event.target.value)} value={status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <div className="field field--full">
            <span>Agents — {teamsById.get(teamId)?.name || "select a team"}</span>
            {teamId && agentsForTeam.length ? (
              <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                {agentsForTeam.map((agent) => {
                  const assignedElsewhere =
                    agent.assignedQueueId && agent.assignedQueueId !== queueId;
                  const selected = selectedIds.has(agent.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`setup-chip ${selected ? "setup-chip--active" : ""}`}
                      disabled={Boolean(assignedElsewhere)}
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
                {teamId
                  ? "No Contact Centre agents on this team."
                  : "Select a team to list eligible agents."}
              </p>
            )}
          </div>

          {agents.length ? (
            <div className="setup-table-wrap">
              <table className="setup-table setup-table--queue-channels">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Call</th>
                    <th>Email</th>
                    <th>Chat</th>
                    <th>WhatsApp</th>
                    <th>Instagram</th>
                    <th>Facebook</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => {
                    const user =
                      eligibleAgents.find((row) => row.id === agent.userId) ||
                      queue.agents?.find((row) => row.userId === agent.userId);
                    return (
                      <tr key={agent.userId}>
                        <td>
                          <strong>{user ? userDisplayName(user) : agent.userId}</strong>
                        </td>
                        <td>
                          <ChannelToggle
                            callType={agent.callType}
                            checked={agent.handlesCalls}
                            label="Call"
                            onCallTypeChange={(value) =>
                              updateAgentField(agent.userId, "callType", value)
                            }
                            onToggle={(value) => updateAgentField(agent.userId, "handlesCalls", value)}
                            showCallType
                            showConcurrency={false}
                          />
                        </td>
                        <td>
                          <ChannelToggle
                            checked={agent.handlesEmail}
                            concurrency={agent.emailConcurrency}
                            label="Email"
                            onConcurrencyChange={(value) =>
                              updateAgentField(agent.userId, "emailConcurrency", value)
                            }
                            onToggle={(value) => updateAgentField(agent.userId, "handlesEmail", value)}
                          />
                        </td>
                        <td>
                          <ChannelToggle
                            checked={agent.handlesChat}
                            concurrency={agent.chatConcurrency}
                            label="Chat"
                            onConcurrencyChange={(value) =>
                              updateAgentField(agent.userId, "chatConcurrency", value)
                            }
                            onToggle={(value) => updateAgentField(agent.userId, "handlesChat", value)}
                          />
                        </td>
                        <td>
                          <ChannelToggle
                            checked={agent.handlesWhatsapp}
                            concurrency={agent.whatsappConcurrency}
                            label="WhatsApp"
                            onConcurrencyChange={(value) =>
                              updateAgentField(agent.userId, "whatsappConcurrency", value)
                            }
                            onToggle={(value) =>
                              updateAgentField(agent.userId, "handlesWhatsapp", value)
                            }
                          />
                        </td>
                        <td>
                          <ChannelToggle
                            checked={agent.handlesInstagram}
                            concurrency={agent.instagramConcurrency}
                            label="Instagram"
                            onConcurrencyChange={(value) =>
                              updateAgentField(agent.userId, "instagramConcurrency", value)
                            }
                            onToggle={(value) =>
                              updateAgentField(agent.userId, "handlesInstagram", value)
                            }
                          />
                        </td>
                        <td>
                          <ChannelToggle
                            checked={agent.handlesFacebook}
                            concurrency={agent.facebookConcurrency}
                            label="Facebook"
                            onConcurrencyChange={(value) =>
                              updateAgentField(agent.userId, "facebookConcurrency", value)
                            }
                            onToggle={(value) =>
                              updateAgentField(agent.userId, "handlesFacebook", value)
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="field__hint" style={{ marginTop: "10px" }}>
                Enable a channel to set its options. Call is max 1 — choose Inbound, Outbound, or
                Both.
              </p>
            </div>
          ) : null}

          <div className="setup-form-actions">
            {error ? (
              <p className="setup-field-error" role="alert" style={{ flex: "1 1 100%", margin: 0 }}>
                <CircleAlert aria-hidden size={14} />
                <span>{error}</span>
              </p>
            ) : null}
            {success ? (
              <p className="setup-form-success" role="status" style={{ flex: "1 1 100%", margin: 0 }}>
                {success}
              </p>
            ) : null}
            <button
              className="primary-button"
              disabled={saving}
              onClick={handleSave}
              type="button"
            >
              {saving ? <Loader2 className="spin" size={16} /> : null}
              {saving ? "Saving…" : "Save queue"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
