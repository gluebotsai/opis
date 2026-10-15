import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleAlert } from "lucide-react";

import {
  SetupEntityName,
  SetupPageHeader,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { getTeam, listSetupUsers } from "../../../lib/setup/setupApi.js";

function userDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.workEmail || "Untitled user";
}

export function SetupTeamDetailPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const usersById = useMemo(() => {
    const map = new Map();
    for (const user of users) map.set(user.id, user);
    return map;
  }, [users]);

  const members = useMemo(() => {
    const ids = Array.isArray(team?.memberIds) ? team.memberIds : [];
    return ids.map((id) => usersById.get(id)).filter(Boolean);
  }, [team?.memberIds, usersById]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [teamRow, userRows] = await Promise.all([getTeam(teamId), listSetupUsers()]);
        if (cancelled) return;
        setTeam(teamRow);
        setUsers(userRows);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setTeam(null);
          setError(err.message || "Failed to load team details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const memberCount = Array.isArray(team?.memberIds) ? team.memberIds.length : 0;

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="secondary-button"
            onClick={() => navigate("/customer/setup/teams")}
            type="button"
          >
            <ArrowLeft size={16} />
            Back to teams
          </button>
        }
        copy="View team details. Use Edit on the teams list to make changes."
        title={team?.name || "Team details"}
      />

      {error ? (
        <div className="form-error-banner" role="alert">
          <CircleAlert aria-hidden size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading team…</p>
          ) : team ? (
            <div className="setup-form-panel">
              <div className="setup-detail-grid">
                <div className="setup-detail-item">
                  <span>Team</span>
                  <SetupEntityName description={team.description} name={team.name} />
                </div>
                <div className="setup-detail-item">
                  <span>Status</span>
                  <strong>
                    <SetupStatusBadge
                      status={team.status === "active" ? "Active" : team.status}
                      tone={team.status === "active" ? "success" : "warning"}
                    />
                  </strong>
                </div>
                <div className="setup-detail-item">
                  <span>Members</span>
                  <strong>
                    {memberCount} {memberCount === 1 ? "member" : "members"}
                  </strong>
                </div>
                {team.description ? (
                  <div className="setup-detail-item field--full">
                    <span>Description</span>
                    <strong>{team.description}</strong>
                  </div>
                ) : null}
              </div>

              <h3 style={{ fontSize: "14px", margin: "20px 0 10px" }}>Team members</h3>
              {members.length ? (
                <ul className="setup-member-list">
                  {members.map((user) => (
                    <li key={user.id}>
                      <strong>{userDisplayName(user)}</strong>
                      {user.workEmail ? <span>{user.workEmail}</span> : null}
                      {user.employeeId ? <span>{user.employeeId}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: "13px", color: "var(--text-caption)", margin: 0 }}>
                  No members on this team yet.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
