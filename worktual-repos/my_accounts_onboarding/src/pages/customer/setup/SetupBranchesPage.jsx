import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Plus, Search, Trash2, X } from "lucide-react";

import {
  SetupPageHeader,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import {
  createBranch,
  deleteBranch,
  listBranches,
  SETUP_TIMEZONES,
} from "../../../lib/setup/setupApi.js";

const EMPTY_FORM = {
  name: "",
  address: "",
  city: "",
  country: "",
  timezone: "Asia/Kolkata",
};

const TIMEZONE_LABELS = {
  "Asia/Kolkata": "IST (UTC+05:30)",
  UTC: "UTC (UTC+00:00)",
  "Europe/London": "GMT (UTC+00:00)",
  "America/New_York": "EST (UTC−05:00)",
  "Asia/Dubai": "GST (UTC+04:00)",
  "Asia/Singapore": "SGT (UTC+08:00)",
};

function statusTone(status) {
  if (String(status || "").toLowerCase() === "active") return "success";
  if (String(status || "").toLowerCase() === "inactive") return "warning";
  return "neutral";
}

function formatTimezoneLabel(timezone) {
  if (!timezone) return "—";
  return TIMEZONE_LABELS[timezone] || timezone;
}

function cityCountryLabel(branch) {
  const parts = [branch.city, branch.country].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

export function SetupBranchesPage() {
  const [branches, setBranches] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const rows = await listBranches();
    setBranches(rows);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load branches.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = useMemo(
    () => branches.filter((branch) => String(branch.status || "").toLowerCase() === "active").length,
    [branches],
  );
  const inactiveCount = useMemo(
    () =>
      branches.filter((branch) => String(branch.status || "").toLowerCase() === "inactive").length,
    [branches],
  );

  const summary = useMemo(() => {
    const countries = new Set();
    const cities = new Set();
    const timezoneCounts = new Map();

    for (const branch of branches) {
      if (branch.country) countries.add(String(branch.country).trim());
      if (branch.city) cities.add(String(branch.city).trim());
      const timezone = branch.timezone || "Unassigned";
      timezoneCounts.set(timezone, (timezoneCounts.get(timezone) || 0) + 1);
    }

    return {
      countries: countries.size,
      cities: cities.size,
      timezoneRows: [...timezoneCounts.entries()]
        .map(([timezone, count]) => ({
          timezone,
          label: timezone === "Unassigned" ? "Unassigned" : formatTimezoneLabel(timezone),
          count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
  }, [branches]);

  const filteredBranches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return branches.filter((branch) => {
      const status = String(branch.status || "active").toLowerCase();
      if (statusFilter === "active" && status !== "active") return false;
      if (statusFilter === "inactive" && status !== "inactive") return false;
      if (!query) return true;
      const haystack = [
        branch.name,
        branch.address,
        branch.city,
        branch.country,
        branch.timezone,
        formatTimezoneLabel(branch.timezone),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [branches, searchQuery, statusFilter]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    try {
      setSaving(true);
      setError("");
      await createBranch({
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        timezone: form.timezone,
      });
      await refresh();
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (err) {
      setError(err.message || "Failed to create branch.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(branch) {
    if (branch.isPrimary) return;
    if (!window.confirm(`Delete branch “${branch.name}”?`)) return;
    try {
      setError("");
      await deleteBranch(branch.id);
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to delete branch.");
    }
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="primary-button"
            onClick={() => setShowForm((current) => !current)}
            type="button"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close form" : "Add branch"}
          </button>
        }
        copy="View your organization's active operating branches, address structures, and timezone assignments."
        title="Branches"
      />

      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {showForm ? (
            <form className="setup-form-panel" onSubmit={handleSubmit}>
              <h2>Add branch</h2>
              <div className="setup-form-grid">
                <label className="field">
                  <span>Branch name</span>
                  <input
                    onChange={(event) => updateField("name", event.target.value)}
                    required
                    value={form.name}
                  />
                </label>
                <label className="field">
                  <span>City</span>
                  <input
                    onChange={(event) => updateField("city", event.target.value)}
                    value={form.city}
                  />
                </label>
                <label className="field">
                  <span>Country</span>
                  <input
                    onChange={(event) => updateField("country", event.target.value)}
                    value={form.country}
                  />
                </label>
                <label className="field">
                  <span>Timezone</span>
                  <select
                    onChange={(event) => updateField("timezone", event.target.value)}
                    value={form.timezone}
                  >
                    {SETUP_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field--full">
                  <span>Address</span>
                  <textarea
                    onChange={(event) => updateField("address", event.target.value)}
                    rows="2"
                    value={form.address}
                  />
                </label>
              </div>
              <div className="setup-form-actions">
                <button className="secondary-button" onClick={() => setShowForm(false)} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  <Plus size={16} />
                  {saving ? "Saving…" : "Add branch"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading branches…</p>
          ) : (
            <div className="setup-bh-list">
              <div className="setup-list-toolbar">
                <label className="setup-search-field">
                  <Search size={16} />
                  <input
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search by branch name, city, country..."
                    type="search"
                    value={searchQuery}
                  />
                </label>
                <div className="setup-filter-tabs" role="tablist" aria-label="Branch status">
                  <button
                    aria-selected={statusFilter === "all"}
                    className={`setup-filter-tab ${statusFilter === "all" ? "is-active" : ""}`}
                    onClick={() => setStatusFilter("all")}
                    type="button"
                  >
                    All Status
                    <span>{branches.length}</span>
                  </button>
                  <button
                    aria-selected={statusFilter === "active"}
                    className={`setup-filter-tab ${statusFilter === "active" ? "is-active" : ""}`}
                    onClick={() => setStatusFilter("active")}
                    type="button"
                  >
                    Active Status
                    <span>{activeCount}</span>
                  </button>
                  <button
                    aria-selected={statusFilter === "inactive"}
                    className={`setup-filter-tab ${statusFilter === "inactive" ? "is-active" : ""}`}
                    onClick={() => setStatusFilter("inactive")}
                    type="button"
                  >
                    Inactive Status
                    <span>{inactiveCount}</span>
                  </button>
                </div>
              </div>

              <div className="setup-table-wrap">
                <table className="setup-table setup-branches-table">
                  <thead>
                    <tr>
                      <th>Branch name</th>
                      <th>Full address</th>
                      <th>City / Country</th>
                      <th>Assigned timezone</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBranches.map((branch) => (
                      <tr key={branch.id}>
                        <td>
                          <div className="setup-bh-name">
                            {/* <span className="setup-bh-name__icon">
                              <Building2 size={16} />
                            </span> */}
                            <div>
                              <strong>{branch.name || "Untitled branch"}</strong>
                              {branch.isPrimary ? (
                                <p className="setup-branch-primary-hint">Primary location</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="setup-branch-address">
                          <span className="setup-branch-address__row">
                            <MapPin size={14} />
                            {branch.address || "—"}
                          </span>
                        </td>
                        <td>{cityCountryLabel(branch)}</td>
                        <td>{formatTimezoneLabel(branch.timezone)}</td>
                        <td>
                          <SetupStatusBadge
                            status={
                              String(branch.status || "").toLowerCase() === "active"
                                ? "Active"
                                : "Inactive"
                            }
                            tone={statusTone(branch.status)}
                          />
                        </td>
                        <td>
                          {!branch.isPrimary ? (
                            <div className="setup-row-actions">
                              <button
                                className="secondary-button setup-icon-button"
                                onClick={() => handleDelete(branch)}
                                title="Delete"
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {!filteredBranches.length ? (
                      <tr>
                        <td colSpan={6}>
                          {branches.length
                            ? "No branches match your search or filter."
                            : "No branches yet. Add your first office location."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <section className="setup-usage-panel">
            <h2>Branch summary</h2>
            <p>Live counts from your organization locations.</p>
            <div className="setup-usage-panel__stats">
              <div>
                <span>Total branches</span>
                <strong>{branches.length}</strong>
              </div>
              <div>
                <span>Active status</span>
                <strong>{activeCount}</strong>
              </div>
              <div>
                <span>Countries</span>
                <strong>{summary.countries}</strong>
              </div>
              <div>
                <span>Cities</span>
                <strong>{summary.cities}</strong>
              </div>
            </div>
          </section>

          <section className="setup-usage-panel">
            <h2>Timezone distribution</h2>
            <p>{summary.timezoneRows.length} zone{summary.timezoneRows.length === 1 ? "" : "s"} in use.</p>
            <div className="setup-usage-panel__stats">
              {summary.timezoneRows.length ? (
                summary.timezoneRows.map((row) => (
                  <div key={row.timezone}>
                    <span>{row.label}</span>
                    <strong>
                      {row.count} branch{row.count === 1 ? "" : "es"}
                    </strong>
                  </div>
                ))
              ) : (
                <div>
                  <span>No timezone data</span>
                  <strong>0</strong>
                </div>
              )}
            </div>
          </section>

          <section className="setup-usage-panel">
            <h2>How are branches used?</h2>
            <p>
              Branches let products like Contact Center and CRM apply location-specific hours,
              teams, and routing without duplicating your company profile.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
