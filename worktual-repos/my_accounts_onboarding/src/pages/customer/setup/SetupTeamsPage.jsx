import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleAlert, Pencil, Plus, Trash2, Users, X } from "lucide-react";

import {
  SetupEntityName,
  SetupPageHeader,
  SetupStatCard,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import {
  createTeam,
  deleteTeam,
  listSetupUsers,
  listTeams,
  updateTeam,
} from "../../../lib/setup/setupApi.js";

const EMPTY_FORM = {
  name: "",
  description: "",
  memberIds: [],
  status: "active",
};

function userDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.workEmail || "Untitled user";
}

export function SetupTeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [memberError, setMemberError] = useState("");

  const usersById = useMemo(() => {
    const map = new Map();
    for (const user of users) map.set(user.id, user);
    return map;
  }, [users]);

  const teamsById = useMemo(() => {
    const map = new Map();
    for (const team of teams) map.set(team.id, team);
    return map;
  }, [teams]);

  /** userId -> team they already belong to (excluding the team being edited) */
  const assignedTeamByUserId = useMemo(() => {
    const map = new Map();
    for (const team of teams) {
      if (team.id === editingId) continue;
      for (const userId of team.memberIds || []) {
        if (!map.has(userId)) map.set(userId, team);
      }
    }
    for (const user of users) {
      if (!user.teamId || user.teamId === editingId || map.has(user.id)) continue;
      const team = teamsById.get(user.teamId);
      if (team) map.set(user.id, team);
    }
    return map;
  }, [editingId, teams, teamsById, users]);

  const availableMembers = useMemo(
    () =>
      users.filter(
        (user) => !form.memberIds.includes(user.id) && !assignedTeamByUserId.has(user.id),
      ),
    [assignedTeamByUserId, form.memberIds, users],
  );

  async function refresh() {
    const [teamRows, userRows] = await Promise.all([listTeams(), listSetupUsers()]);
    setTeams(teamRows);
    setUsers(userRows);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load teams.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetFormState() {
    setForm(EMPTY_FORM);
    setMemberToAdd("");
    setEditingId(null);
    setError("");
    setMemberError("");
  }

  function closeForm() {
    resetFormState();
    setShowForm(false);
  }

  function openCreateForm() {
    resetFormState();
    setShowForm(true);
  }

  function handleEdit(team) {
    setEditingId(team.id);
    setForm({
      name: team.name || "",
      description: team.description || "",
      memberIds: Array.isArray(team.memberIds) ? team.memberIds : [],
      status: team.status || "active",
    });
    setMemberToAdd("");
    setShowForm(true);
    setError("");
    setMemberError("");
  }

  function addMember(userId) {
    if (!userId) return;
    const otherTeam = assignedTeamByUserId.get(userId);
    if (otherTeam) {
      const user = usersById.get(userId);
      const label = user ? userDisplayName(user) : "This user";
      setMemberError(
        `${label} is already on team “${otherTeam.name}”. A user can only belong to one team.`,
      );
      setMemberToAdd("");
      return;
    }
    setMemberError("");
    setForm((current) => {
      if (current.memberIds.includes(userId)) return current;
      return { ...current, memberIds: [...current.memberIds, userId] };
    });
    setMemberToAdd("");
  }

  function removeMember(userId) {
    setMemberError("");
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.filter((id) => id !== userId),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      memberIds: form.memberIds,
      availableProducts: [],
      status: form.status,
    };
    try {
      setSaving(true);
      setError("");
      if (editingId) {
        await updateTeam(editingId, payload);
      } else {
        await createTeam(payload);
      }
      await refresh();
      closeForm();
    } catch (err) {
      setError(err.message || (editingId ? "Failed to update team." : "Failed to create team."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(team) {
    if (!window.confirm(`Delete team “${team.name}”?`)) return;
    try {
      setError("");
      await deleteTeam(team.id);
      if (editingId === team.id) {
        closeForm();
      }
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to delete team.");
    }
  }

  function membersCountLabel(memberIds = []) {
    const count = Array.isArray(memberIds) ? memberIds.length : 0;
    if (!count) return "0 members";
    return `${count} ${count === 1 ? "member" : "members"}`;
  }

  function openTeamDetails(teamId) {
    navigate(`/customer/setup/teams/${encodeURIComponent(teamId)}`);
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="primary-button"
            onClick={() => {
              if (showForm) {
                closeForm();
                return;
              }
              openCreateForm();
            }}
            type="button"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close form" : "Add team"}
          </button>
        }
        copy="Group onboarded users into teams."
        title="Teams"
      />

      {error ? (
        <div className="form-error-banner" role="alert">
          <CircleAlert aria-hidden size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {showForm ? (
            <form className="setup-form-panel" onSubmit={handleSubmit}>
              <h2>{editingId ? "Edit team" : "Add team"}</h2>
              <div className="setup-form-grid">
                <label className="field">
                  <span>Team name</span>
                  <input
                    onChange={(event) => updateField("name", event.target.value)}
                    required
                    value={form.name}
                  />
                </label>
                <label className={`field${memberError ? " field--invalid" : ""}`}>
                  <span>Add member</span>
                  <select
                    aria-invalid={Boolean(memberError)}
                    disabled={!availableMembers.length}
                    onChange={(event) => addMember(event.target.value)}
                    value={memberToAdd}
                  >
                    <option value="">
                      {users.length
                        ? availableMembers.length
                          ? "Select onboarded user"
                          : "All available users are already on a team"
                        : "No onboarded users yet"}
                    </option>
                    {availableMembers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {userDisplayName(user)}
                        {user.workEmail ? ` (${user.workEmail})` : ""}
                      </option>
                    ))}
                  </select>
                  {memberError ? (
                    <p className="setup-field-error" role="alert">
                      <CircleAlert aria-hidden size={14} />
                      <span>{memberError}</span>
                    </p>
                  ) : null}
                </label>
                {form.memberIds.length ? (
                  <div className="field field--full">
                    <span>Members</span>
                    <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                      {form.memberIds.map((userId) => {
                        const user = usersById.get(userId);
                        const label = user ? userDisplayName(user) : "Unknown user";
                        return (
                          <button
                            className="setup-chip is-active"
                            key={userId}
                            onClick={() => removeMember(userId)}
                            style={{
                              background: "var(--color-neutral-900, #111)",
                              color: "#fff",
                            }}
                            title="Remove member"
                            type="button"
                          >
                            {label}
                            <X aria-hidden size={12} strokeWidth={2.5} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <label className="field field--full">
                  <span>Description</span>
                  <textarea
                    onChange={(event) => updateField("description", event.target.value)}
                    rows="2"
                    value={form.description}
                  />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select
                    onChange={(event) => updateField("status", event.target.value)}
                    value={form.status}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>
              <div className="setup-form-actions">
                <button className="secondary-button" onClick={closeForm} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                  {saving ? "Saving…" : editingId ? "Save changes" : "Add team"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading teams…</p>
          ) : (
            <div className="setup-table-wrap">
              <table className="setup-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Members</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => {
                    return (
                      <tr
                        className="setup-table-row--clickable"
                        key={team.id}
                        onClick={() => openTeamDetails(team.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openTeamDetails(team.id);
                          }
                        }}
                        role="link"
                        tabIndex={0}
                      >
                        <td>
                          <SetupEntityName
                            description={team.description}
                            name={team.name}
                          />
                        </td>
                        <td>{membersCountLabel(team.memberIds)}</td>
                        <td>
                          <SetupStatusBadge
                            status={team.status === "active" ? "Active" : team.status}
                            tone={team.status === "active" ? "success" : "warning"}
                          />
                        </td>
                        <td>
                          <div className="setup-row-actions">
                            <button
                              className="secondary-button setup-icon-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEdit(team);
                              }}
                              title="Edit"
                              type="button"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="secondary-button setup-icon-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(team);
                              }}
                              title="Delete"
                              type="button"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!teams.length ? (
                    <tr>
                      <td colSpan={4}>No teams yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Teams" value={teams.length} />
          <section className="onboarding-card lead-dashboard-panel">
            <div className="lead-dashboard-panel__heading">
              <div className="lead-dashboard-panel__heading-icon">
                <Users size={18} strokeWidth={2} />
              </div>
              <div>
                <h2>Teams</h2>
                <p>Add onboarded users to teams for product and role assignment.</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
