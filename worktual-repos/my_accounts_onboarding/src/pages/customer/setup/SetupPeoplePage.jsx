import { useEffect, useMemo, useState } from "react";
import { Mail, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  SetupEntityName,
  SetupPageHeader,
  SetupStatCard,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import { getProductName, getPurchasedProductCatalog } from "../../../lib/productCatalog.js";
import { selectableSetupRoles } from "../../../lib/setup/defaultRoles.js";
import {
  createSetupUser,
  deleteSetupUser,
  listBranches,
  listBusinessHours,
  listRoles,
  listSetupUsers,
  listTeams,
  resendSetupUserInvite,
  updateSetupUser,
} from "../../../lib/setup/setupApi.js";

function inviteBadge(user) {
  const status = user.inviteStatus || "pending";
  if (status === "active") return { label: "Active", tone: "success" };
  if (status === "invited") return { label: "Invited", tone: "warning" };
  if (status === "disabled") return { label: "Disabled", tone: "neutral" };
  return { label: "Pending", tone: "neutral" };
}

function canResendInvite(user) {
  const status = user.inviteStatus || "pending";
  if (status === "active" || status === "disabled") return false;
  if (user.status === "inactive") return false;
  return Array.isArray(user.productAccess) && user.productAccess.length > 0;
}

const EMPTY_FORM = {
  employeeId: "",
  firstName: "",
  lastName: "",
  workEmail: "",
  mobileNumber: "",
  primaryLanguage: "",
  secondaryLanguage: "",
  skill: "",
  locationId: "",
  teamId: "",
  businessHoursId: "",
  shiftTypes: [],
  status: "active",
  productAccess: [],
};

function emptyProductGrant(productId) {
  return {
    productId,
    roleId: "",
  };
}

function collectShiftTypes(entry) {
  const types = new Set();
  for (const shift of entry?.shifts || []) {
    if (shift.shiftType) types.add(shift.shiftType);
  }
  return [...types];
}

export function SetupPeoplePage() {
  const { dashboard } = useCustomerDashboard();
  const purchasedProducts = useMemo(
    () => getPurchasedProductCatalog(dashboard?.activeProducts),
    [dashboard?.activeProducts],
  );
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [businessHours, setBusinessHours] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedProducts, setExpandedProducts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const availableShiftTypes = useMemo(() => {
    const selected = businessHours.find((entry) => entry.id === form.businessHoursId);
    return collectShiftTypes(selected);
  }, [businessHours, form.businessHoursId]);

  async function refresh() {
    const [userRows, branchRows, teamRows, roleRows, hours] = await Promise.all([
      listSetupUsers(),
      listBranches(),
      listTeams(),
      listRoles(),
      listBusinessHours(),
    ]);
    setUsers(userRows);
    setBranches(branchRows);
    setTeams(teamRows);
    setRoles(roleRows);
    setBusinessHours(hours);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load users.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((current) => {
      if (key === "businessHoursId") {
        return {
          ...current,
          businessHoursId: value,
          shiftTypes: [],
        };
      }
      return { ...current, [key]: value };
    });
  }

  function selectedProductIds() {
    return form.productAccess.map((entry) => entry.productId);
  }

  function toggleProduct(productId) {
    setForm((current) => {
      const exists = current.productAccess.some((entry) => entry.productId === productId);
      if (exists) {
        return {
          ...current,
          productAccess: current.productAccess.filter((entry) => entry.productId !== productId),
        };
      }
      return {
        ...current,
        productAccess: [...current.productAccess, emptyProductGrant(productId)],
      };
    });
    setExpandedProducts((current) => ({ ...current, [productId]: true }));
  }

  function updateProductGrant(productId, key, value) {
    setForm((current) => ({
      ...current,
      productAccess: current.productAccess.map((entry) =>
        entry.productId === productId ? { ...entry, [key]: value } : entry,
      ),
    }));
  }

  function toggleShiftType(shiftType) {
    setForm((current) => {
      const has = current.shiftTypes.includes(shiftType);
      return {
        ...current,
        shiftTypes: has
          ? current.shiftTypes.filter((item) => item !== shiftType)
          : [...current.shiftTypes, shiftType],
      };
    });
  }

  function rolesForProduct(productId) {
    return selectableSetupRoles(roles.filter((role) => role.productId === productId));
  }

  function resetFormState() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setExpandedProducts({});
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

  function handleEdit(user) {
    const productAccess = (user.productAccess || []).map((grant) => ({
      productId: grant.productId || "",
      roleId: grant.roleId || "",
    }));
    const expanded = {};
    for (const grant of productAccess) {
      if (grant.productId) expanded[grant.productId] = true;
    }
    setEditingId(user.id);
    setForm({
      employeeId: user.employeeId || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      workEmail: user.workEmail || "",
      mobileNumber: user.mobileNumber || "",
      primaryLanguage: user.primaryLanguage || "",
      secondaryLanguage: user.secondaryLanguage || "",
      skill: user.skill || "",
      locationId: user.locationId || "",
      teamId: user.teamId || "",
      businessHoursId: user.businessHoursId || "",
      shiftTypes: Array.isArray(user.shiftTypes) ? [...user.shiftTypes] : [],
      status: user.status || "active",
      productAccess,
    });
    setExpandedProducts(expanded);
    setShowForm(true);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.workEmail.trim()) return;
    if (form.productAccess.some((grant) => !grant.roleId)) {
      setError("Select a role for every chosen product.");
      return;
    }
    if (form.shiftTypes.length && !form.businessHoursId) {
      setError("Select a business hours schedule for the chosen shift types.");
      return;
    }
    const payload = {
      employeeId: form.employeeId,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      workEmail: form.workEmail.trim(),
      mobileNumber: form.mobileNumber,
      primaryLanguage: form.primaryLanguage,
      secondaryLanguage: form.secondaryLanguage,
      skill: form.skill,
      locationId: form.locationId || null,
      teamId: form.teamId || null,
      businessHoursId: form.businessHoursId || null,
      shiftTypes: form.shiftTypes,
      productAccess: form.productAccess.map((grant) => ({
        productId: grant.productId,
        roleId: grant.roleId,
      })),
      status: form.status,
    };
    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");
      if (editingId) {
        const result = await updateSetupUser(editingId, payload);
        if (result?.inviteSent) {
          setSuccessMessage(`Invite sent to ${payload.workEmail}.`);
        } else if (result?.inviteError) {
          setSuccessMessage(`User saved, but invite email failed: ${result.inviteError}`);
        } else if (result?.accessNotified) {
          setSuccessMessage(
            `Product access updated. Notification sent to ${payload.workEmail}.`,
          );
        } else if (result?.accessNotifyError) {
          setSuccessMessage(
            `Product access saved, but notification email failed: ${result.accessNotifyError}`,
          );
        } else {
          setSuccessMessage("User saved.");
        }
      } else {
        const result = await createSetupUser(payload);
        if (result?.inviteSent) {
          setSuccessMessage(`Invite sent to ${payload.workEmail}.`);
        } else if (result?.inviteError) {
          setSuccessMessage(`User created, but invite email failed: ${result.inviteError}`);
        } else if (payload.productAccess.length) {
          setSuccessMessage("User created.");
        }
      }
      await refresh();
      closeForm();
    } catch (err) {
      setError(err.message || (editingId ? "Failed to update user." : "Failed to create user."));
    } finally {
      setSaving(false);
    }
  }

  async function handleResendInvite(user) {
    if (!canResendInvite(user)) return;
    try {
      setResendingId(user.id);
      setError("");
      setSuccessMessage("");
      const result = await resendSetupUserInvite(user.id);
      setSuccessMessage(`Invite resent to ${result?.email || user.workEmail}.`);
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to resend invite.");
    } finally {
      setResendingId("");
    }
  }

  async function handleDelete(user) {
    if (!window.confirm(`Delete user “${user.firstName} ${user.lastName}”?`)) return;
    try {
      setError("");
      await deleteSetupUser(user.id);
      if (editingId === user.id) closeForm();
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to delete user.");
    }
  }

  function roleName(id) {
    return roles.find((role) => role.id === id)?.name || id || "—";
  }

  function teamName(id) {
    return teams.find((team) => team.id === id)?.name || "—";
  }

  function hoursName(id) {
    return businessHours.find((entry) => entry.id === id)?.name || "—";
  }

  const activeCount = users.filter((user) => user.status === "active").length;

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
            {showForm ? "Close form" : "Add user"}
          </button>
        }
        copy="Onboard agents with team, product roles, and business-hour shift types."
        title="User details"
      />

      {error ? <div className="form-error-banner">{error}</div> : null}
      {successMessage ? <div className="form-success-banner">{successMessage}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {showForm ? (
            <form className="setup-form-panel" onSubmit={handleSubmit}>
              <h2>{editingId ? "Edit user" : "Add user"}</h2>
              <div className="setup-form-grid">
                <label className="field">
                  <span>Employee ID</span>
                  <input
                    onChange={(event) => updateField("employeeId", event.target.value)}
                    value={form.employeeId}
                  />
                </label>
                <label className="field">
                  <span>Location</span>
                  <select
                    onChange={(event) => updateField("locationId", event.target.value)}
                    value={form.locationId}
                  >
                    <option value="">Select branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>First name</span>
                  <input
                    onChange={(event) => updateField("firstName", event.target.value)}
                    required
                    value={form.firstName}
                  />
                </label>
                <label className="field">
                  <span>Last name</span>
                  <input
                    onChange={(event) => updateField("lastName", event.target.value)}
                    required
                    value={form.lastName}
                  />
                </label>
                <label className="field">
                  <span>Work email</span>
                  <input
                    onChange={(event) => updateField("workEmail", event.target.value)}
                    required
                    type="email"
                    value={form.workEmail}
                  />
                </label>
                <label className="field">
                  <span>Mobile</span>
                  <input
                    onChange={(event) => updateField("mobileNumber", event.target.value)}
                    value={form.mobileNumber}
                  />
                </label>
                <label className="field">
                  <span>Primary language</span>
                  <input
                    onChange={(event) => updateField("primaryLanguage", event.target.value)}
                    value={form.primaryLanguage}
                  />
                </label>
                <label className="field">
                  <span>Secondary language</span>
                  <input
                    onChange={(event) => updateField("secondaryLanguage", event.target.value)}
                    value={form.secondaryLanguage}
                  />
                </label>
                <label className="field field--full">
                  <span>Skill</span>
                  <input
                    onChange={(event) => updateField("skill", event.target.value)}
                    value={form.skill}
                  />
                </label>
                <label className="field">
                  <span>Team</span>
                  <select
                    onChange={(event) => updateField("teamId", event.target.value)}
                    value={form.teamId}
                  >
                    <option value="">Select team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
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
                <label className="field">
                  <span>Business hours</span>
                  <select
                    onChange={(event) => updateField("businessHoursId", event.target.value)}
                    value={form.businessHoursId}
                  >
                    <option value="">Select schedule</option>
                    {businessHours.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field field--full">
                  <span>Shift types</span>
                  {!form.businessHoursId ? (
                    <p
                      style={{
                        color: "var(--text-caption)",
                        fontSize: "12px",
                        margin: "8px 0 0",
                      }}
                    >
                      Select a business hours schedule first.
                    </p>
                  ) : availableShiftTypes.length ? (
                    <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                      {availableShiftTypes.map((shiftType) => {
                        const active = form.shiftTypes.includes(shiftType);
                        return (
                          <button
                            className={`setup-chip ${active ? "is-active" : ""}`}
                            key={shiftType}
                            onClick={() => toggleShiftType(shiftType)}
                            style={
                              active
                                ? { background: "var(--color-neutral-900, #111)", color: "#fff" }
                                : undefined
                            }
                            type="button"
                          >
                            {shiftType}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p
                      style={{
                        color: "var(--text-caption)",
                        fontSize: "12px",
                        margin: "8px 0 0",
                      }}
                    >
                      No shift types found on this schedule.
                    </p>
                  )}
                </div>
              </div>

              <h3 style={{ fontSize: "14px", margin: "20px 0 8px" }}>Product access</h3>
              <div className="setup-chip-row" style={{ marginBottom: "12px" }}>
                {purchasedProducts.length ? (
                  purchasedProducts.map((product) => {
                    const active = selectedProductIds().includes(product.id);
                    return (
                      <button
                        className={`setup-chip ${active ? "is-active" : ""}`}
                        key={product.id}
                        onClick={() => toggleProduct(product.id)}
                        style={
                          active
                            ? { background: "var(--color-neutral-900, #111)", color: "#fff" }
                            : undefined
                        }
                        type="button"
                      >
                        {product.name}
                      </button>
                    );
                  })
                ) : (
                  <span className="setup-chip">No purchased products on this account.</span>
                )}
              </div>

              {form.productAccess.map((grant) => {
                const productRoles = rolesForProduct(grant.productId);
                return (
                  <section
                    className="onboarding-card lead-dashboard-panel"
                    key={grant.productId}
                    style={{ marginBottom: "12px" }}
                  >
                    <button
                      onClick={() =>
                        setExpandedProducts((current) => ({
                          ...current,
                          [grant.productId]: !current[grant.productId],
                        }))
                      }
                      style={{
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        padding: 0,
                        textAlign: "left",
                        width: "100%",
                      }}
                      type="button"
                    >
                      <strong>{getProductName(grant.productId)}</strong>
                      <span style={{ color: "var(--text-caption)", marginLeft: "8px" }}>
                        {expandedProducts[grant.productId] === false ? "Expand" : "Collapse"}
                      </span>
                    </button>
                    {expandedProducts[grant.productId] !== false ? (
                      <div className="setup-form-grid" style={{ marginTop: "12px" }}>
                        <label className="field">
                          <span>Role</span>
                          <select
                            onChange={(event) =>
                              updateProductGrant(grant.productId, "roleId", event.target.value)
                            }
                            required
                            value={grant.roleId}
                          >
                            <option value="">Select role</option>
                            {productRoles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!productRoles.length ? (
                          <p
                            className="field field--full"
                            style={{
                              color: "var(--text-caption)",
                              fontSize: "12px",
                              margin: 0,
                            }}
                          >
                            No default roles for this product yet. They appear after an org admin logs in when the product is active.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}

              <div className="setup-form-actions">
                <button className="secondary-button" onClick={closeForm} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                  {saving ? "Saving…" : editingId ? "Save changes" : "Add user"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading users…</p>
          ) : (
            <div className="setup-table-wrap">
              <table className="setup-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Employee ID</th>
                    <th>Email</th>
                    <th>Team</th>
                    <th>Shifts</th>
                    <th>Products</th>
                    <th>Status</th>
                    <th>Invite</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const invite = inviteBadge(user);
                    return (
                    <tr key={user.id}>
                      <td>
                        <SetupEntityName
                          description={user.skill}
                          label="skill"
                          name={`${user.firstName} ${user.lastName}`.trim()}
                        />
                      </td>
                      <td>{user.employeeId || "—"}</td>
                      <td>{user.workEmail}</td>
                      <td>{teamName(user.teamId)}</td>
                      <td>
                        {user.businessHoursId ? (
                          <>
                            {hoursName(user.businessHoursId)}
                            {(user.shiftTypes || []).length
                              ? ` · ${(user.shiftTypes || []).join(", ")}`
                              : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="setup-chip-row">
                          {(user.productAccess || []).length ? (
                            user.productAccess.map((grant) => (
                              <span className="setup-chip" key={`${user.id}-${grant.productId}`}>
                                {getProductName(grant.productId)}
                                {grant.roleId ? ` · ${roleName(grant.roleId)}` : ""}
                              </span>
                            ))
                          ) : (
                            <span className="setup-chip">None</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <SetupStatusBadge
                          status={user.status === "active" ? "Active" : user.status}
                          tone={user.status === "active" ? "success" : "neutral"}
                        />
                      </td>
                      <td>
                        <SetupStatusBadge status={invite.label} tone={invite.tone} />
                      </td>
                      <td>
                        <div className="setup-row-actions">
                          {canResendInvite(user) ? (
                            <button
                              className="secondary-button setup-icon-button"
                              disabled={resendingId === user.id}
                              onClick={() => handleResendInvite(user)}
                              title="Resend invite"
                              type="button"
                            >
                              <Mail size={14} />
                            </button>
                          ) : null}
                          <button
                            className="secondary-button setup-icon-button"
                            onClick={() => handleEdit(user)}
                            title="Edit"
                            type="button"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="secondary-button setup-icon-button"
                            onClick={() => handleDelete(user)}
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
                  {!users.length ? (
                    <tr>
                      <td colSpan={9}>No users yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Total users" value={users.length} />
          <SetupStatCard label="Active users" value={activeCount} />
        </aside>
      </div>
    </section>
  );
}
