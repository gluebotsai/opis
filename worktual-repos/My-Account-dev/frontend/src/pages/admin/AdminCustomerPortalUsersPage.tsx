// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Download,
  Filter,
  LogOut,
  MoreHorizontal,
  Search,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
  XCircle,
} from "lucide-react";

import {
  AdminFieldSelect,
  isAdminFieldSelectMenuTarget,
} from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { getAvatarTone } from "../../lib/brandColors.js";
import {
  deleteCustomerPortalUser,
  forceLogoutCustomerPortalUser,
  listAdminCustomerPortalUsers,
  updateCustomerPortalUserActive,
} from "../../lib/customerPortalAccess.js";
import "../../styles/admin-users-light.css";
import "../../styles/admin-customer-portal-users.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
function roleLabel(role) {
  if (role === "branch_user" || role === "org_admin") {
    return "Branch user";
  }
  return role || "—";
}

function branchDisplay(user) {
  return user.branchLabel || user.branchId || "—";
}

function resourceLabel(user) {
  const value = String(user?.resource || "Internal").trim();
  if (value === "Partner" || value === "Reseller" || value === "Internal") {
    return value;
  }
  return "Internal";
}

function inchargeLabel(user) {
  const name = String(user?.inchargeName || "").trim();
  return name || "Unassigned";
}

function downloadPortalUsersCsv(users) {
  const headers = ["Company", "Email", "Branch", "Resources", "Incharge", "Role", "Status"];
  const rows = users.map((user) => [
    user.companyName || "",
    user.email || "",
    branchDisplay(user),
    resourceLabel(user),
    inchargeLabel(user),
    roleLabel(user.role),
    user.isActive === false ? "Inactive" : "Active",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktual-customer-portal-users.csv";
  link.click();
  URL.revokeObjectURL(url);
}

const INCHARGE_UNASSIGNED = "__unassigned__";

function FilterDropdown({
  inchargeFilter,
  inchargeOptions,
  onClose,
  onInchargeChange,
  onResourceChange,
  onRoleChange,
  onStatusChange,
  resourceFilter,
  roleFilter,
  statusFilter,
}) {
  return (
    <div className="admin-users-filter-dropdown" role="dialog" aria-label="Filter portal users">
      <div className="admin-users-filter-dropdown__section">
        <p className="admin-users-filter-dropdown__title">Filter by</p>
        <div className="admin-users-filter-dropdown__field">
          <span>Resources</span>
          <AdminFieldSelect
            aria-label="Filter by resources"
            onChange={onResourceChange}
            options={[
              { value: "all", label: "All resources" },
              { value: "Internal", label: "Internal" },
              { value: "Partner", label: "Partner" },
              { value: "Reseller", label: "Reseller" },
            ]}
            value={resourceFilter}
          />
        </div>
        <div className="admin-users-filter-dropdown__field">
          <span>Incharge</span>
          <AdminFieldSelect
            aria-label="Filter by incharge"
            onChange={onInchargeChange}
            options={[
              { value: "all", label: "All incharge" },
              { value: INCHARGE_UNASSIGNED, label: "Unassigned" },
              ...inchargeOptions,
            ]}
            value={inchargeFilter}
          />
        </div>
        <div className="admin-users-filter-dropdown__field">
          <span>Role</span>
          <AdminFieldSelect
            aria-label="Filter by role"
            onChange={onRoleChange}
            options={[
              { value: "all", label: "All roles" },
              { value: "branch_user", label: "Branch user" },
            ]}
            value={roleFilter}
          />
        </div>
        <div className="admin-users-filter-dropdown__field">
          <span>Status</span>
          <AdminFieldSelect
            aria-label="Filter by status"
            onChange={onStatusChange}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            value={statusFilter}
          />
        </div>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button
          className="secondary-button"
          onClick={() => {
            onResourceChange("all");
            onInchargeChange("all");
            onRoleChange("all");
            onStatusChange("all");
          }}
          type="button"
        >
          Clear
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Done
        </button>
      </div>
    </div>
  );
}

export function AdminCustomerPortalUsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [inchargeFilter, setInchargeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [forceLogoutTarget, setForceLogoutTarget] = useState(null);
  const [forcingLogoutId, setForcingLogoutId] = useState("");
  const [togglingActiveId, setTogglingActiveId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState("");

  const filterAnchorRef = useRef(null);
  const rowMenuRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listAdminCustomerPortalUsers("", { signal: controller.signal })
      .then((rows) => setUsers(rows))
      .catch((loadError) => {
        if (controller.signal.aborted || loadError?.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "Could not load customer portal users.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function onPointerDown(event) {
      if (
        showFilters &&
        filterAnchorRef.current &&
        !filterAnchorRef.current.contains(event.target) &&
        !isAdminFieldSelectMenuTarget(event.target)
      ) {
        setShowFilters(false);
      }
      if (openRowMenuId && rowMenuRef.current && !rowMenuRef.current.contains(event.target)) {
        setOpenRowMenuId(null);
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowFilters(false);
        setOpenRowMenuId(null);
        if (!forcingLogoutId) {
          setForceLogoutTarget(null);
        }
        if (!deletingId) {
          setDeleteTarget(null);
        }
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showFilters, openRowMenuId, forcingLogoutId, deletingId]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, resourceFilter, inchargeFilter, roleFilter, statusFilter, pageSize]);

  const stats = useMemo(() => {
    const active = users.filter((user) => user.isActive !== false).length;
    const inactive = users.length - active;
    const companies = new Set(
      users.map((user) => user.companyName || user.organizationId).filter(Boolean),
    ).size;
    return {
      total: users.length,
      active,
      inactive,
      companies,
    };
  }, [users]);

  const inchargeOptions = useMemo(() => {
    const names = new Set();
    for (const user of users) {
      const name = String(user?.inchargeName || "").trim();
      if (name) {
        names.add(name);
      }
    }
    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ value: name, label: name }));
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = users.filter((user) => {
      if (resourceFilter !== "all" && resourceLabel(user) !== resourceFilter) {
        return false;
      }
      if (inchargeFilter === INCHARGE_UNASSIGNED) {
        if (String(user?.inchargeName || "").trim()) {
          return false;
        }
      } else if (inchargeFilter !== "all") {
        if (String(user?.inchargeName || "").trim() !== inchargeFilter) {
          return false;
        }
      }
      if (
        roleFilter !== "all" &&
        !(
          user.role === roleFilter ||
          (roleFilter === "branch_user" && user.role === "org_admin")
        )
      ) {
        return false;
      }
      if (statusFilter === "active" && user.isActive === false) {
        return false;
      }
      if (statusFilter === "inactive" && user.isActive !== false) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        user.companyName,
        user.email,
        user.displayName,
        user.branchLabel,
        resourceLabel(user),
        inchargeLabel(user),
        roleLabel(user.role),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    filtered.sort((left, right) =>
      String(left.companyName || "")
        .toLowerCase()
        .localeCompare(String(right.companyName || "").toLowerCase()),
    );

    return filtered;
  }, [users, searchQuery, resourceFilter, inchargeFilter, roleFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasActiveFilters =
    resourceFilter !== "all" ||
    inchargeFilter !== "all" ||
    roleFilter !== "all" ||
    statusFilter !== "all";

  async function toggleUserActive(user) {
    if (!user?.id || togglingActiveId) {
      return;
    }

    const nextActive = user.isActive === false;
    const notice = nextActive
      ? `Activated ${user.displayName || user.email}.`
      : `Deactivated ${user.displayName || user.email}.`;
    setTogglingActiveId(user.id);
    setError("");
    setOpenRowMenuId(null);
    // Show notice immediately so it is visible even if the request is slow.
    setMessage(notice);
    setUsers((current) =>
      current.map((row) => (row.id === user.id ? { ...row, isActive: nextActive } : row)),
    );

    try {
      await updateCustomerPortalUserActive(user.id, nextActive);
      setMessage(notice);
    } catch (toggleError) {
      setUsers((current) =>
        current.map((row) =>
          row.id === user.id ? { ...row, isActive: user.isActive !== false } : row,
        ),
      );
      setMessage("");
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not update account status.",
      );
    } finally {
      setTogglingActiveId("");
    }
  }

  async function confirmForceLogout() {
    if (!forceLogoutTarget) {
      return;
    }
    setForcingLogoutId(forceLogoutTarget.id);
    setError("");
    setMessage("");
    try {
      await forceLogoutCustomerPortalUser(forceLogoutTarget.id);
      setMessage(
        `Signed out all portal sessions for ${forceLogoutTarget.email || "this customer user"}.`,
      );
      setForceLogoutTarget(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not force logout customer portal user.",
      );
      setForceLogoutTarget(null);
    } finally {
      setForcingLogoutId("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeletingId(deleteTarget.id);
    setError("");
    setMessage("");
    try {
      await deleteCustomerPortalUser(deleteTarget.id);
      setUsers((current) => current.filter((row) => row.id !== deleteTarget.id));
      setMessage(`Deleted ${deleteTarget.email || "customer portal user"}.`);
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete customer portal user.",
      );
      setDeleteTarget(null);
    } finally {
      setDeletingId("");
    }
  }

  const subtitle =
    "View and manage portal logins for customers with at least one paid quotation. Activate, deactivate, force-logout, or delete from the row menu. Sales still provisions access from the paid customer page.";

  return (
    <div className="admin-users-page admin-cpu-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Customer portal users</h1>
          <p className="admin-users-page__subtitle" title={subtitle}>
            {subtitle}
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
        variant="pill"
      />

      <div className="admin-users-kpi-grid">
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--total">
            <Users size={20} />
          </div>
          <div>
            <span title="Total users">Total users</span>
            <strong title={String(stats.total)}>{stats.total}</strong>
            <small title="All portal logins">All portal logins</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active">
            <UserCheck size={20} />
          </div>
          <div>
            <span title="Active users">Active users</span>
            <strong title={String(stats.active)}>{stats.active}</strong>
            <small title="Currently active">Currently active</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--inactive">
            <UserX size={20} />
          </div>
          <div>
            <span title="Inactive users">Inactive users</span>
            <strong title={String(stats.inactive)}>{stats.inactive}</strong>
            <small title="Currently inactive">Currently inactive</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-cpu-kpi-card__icon--companies">
            <Building2 size={20} />
          </div>
          <div>
            <span title="Companies">Companies</span>
            <strong title={String(stats.companies)}>{stats.companies}</strong>
            <small title="Unique organizations">Unique organizations</small>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All portal users</h2>
            <p>
              {filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"} in view
            </p>
          </div>

          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by company, email, or role..."
                type="search"
                value={searchQuery}
              />
            </label>

            <div className="admin-users-panel__toolbar-actions">
              <button
                className="admin-users-panel__tool-button"
                disabled={filteredUsers.length === 0}
                onClick={() => downloadPortalUsersCsv(filteredUsers)}
                type="button"
              >
                <Download size={16} />
                Download
              </button>

              <div className="admin-users-panel__filter-anchor" ref={filterAnchorRef}>
                <button
                  className={`admin-users-panel__tool-button ${
                    showFilters || hasActiveFilters ? "is-active" : ""
                  }`}
                  onClick={() => setShowFilters((current) => !current)}
                  type="button"
                >
                  <Filter size={16} />
                  Filters
                </button>
                {showFilters ? (
                  <FilterDropdown
                    inchargeFilter={inchargeFilter}
                    inchargeOptions={inchargeOptions}
                    onClose={() => setShowFilters(false)}
                    onInchargeChange={setInchargeFilter}
                    onResourceChange={setResourceFilter}
                    onRoleChange={setRoleFilter}
                    onStatusChange={setStatusFilter}
                    resourceFilter={resourceFilter}
                    roleFilter={roleFilter}
                    statusFilter={statusFilter}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading">Loading customer portal users…</p>
          ) : filteredUsers.length === 0 ? (
            <p className="admin-users-panel__empty">
              {users.length === 0
                ? "No portal users for paid customers yet."
                : "No users match your search or filters."}
            </p>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table admin-cpu-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Email</th>
                    {/* Hidden for now — single-location UI.
                    <th>Branch</th>
                    */}
                    <th>Resources</th>
                    <th>Incharge</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => {
                    const company = user.companyName || "—";
                    const email = user.email || "—";
                    // Hidden for now — single-location UI.
                    // const branch = branchDisplay(user);
                    const resource = resourceLabel(user);
                    const incharge = inchargeLabel(user);

                    return (
                      <tr key={user.id} className={user.isActive === false ? "is-inactive" : ""}>
                        <td>
                          <div className="admin-users-name-cell">
                            <span
                              className={`admin-users-name-cell__avatar admin-users-name-cell__avatar--${getAvatarTone(
                                user.organizationId || user.id,
                              )}`}
                            >
                              <Building2 size={14} />
                            </span>
                            <span title={company}>{company}</span>
                          </div>
                        </td>
                        <td title={email}>{email}</td>
                        {/* Hidden for now — single-location UI.
                        <td title={branch}>{branch}</td>
                        */}
                        <td title={resource}>{resource}</td>
                        <td title={incharge}>{incharge}</td>
                        <td>
                          <span
                            className={`admin-users-status-pill ${
                              user.isActive === false ? "admin-users-status-pill--inactive" : ""
                            }`}
                          >
                            <span className="admin-users-status-pill__dot" />
                            {user.isActive === false ? "Inactive" : "Active"}
                          </span>
                        </td>
                        <td>
                          <div
                            className="admin-users-table__menu-anchor"
                            ref={openRowMenuId === user.id ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={openRowMenuId === user.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${user.displayName || user.email}`}
                              className="admin-users-table__menu-trigger"
                              onClick={() =>
                                setOpenRowMenuId((current) =>
                                  current === user.id ? null : user.id,
                                )
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openRowMenuId === user.id ? (
                              <div className="admin-users-row-menu" role="menu">
                                <button
                                  disabled={togglingActiveId === user.id}
                                  onClick={() => void toggleUserActive(user)}
                                  role="menuitem"
                                  type="button"
                                >
                                  {user.isActive === false ? (
                                    <UserCheck size={14} />
                                  ) : (
                                    <UserX size={14} />
                                  )}
                                  {togglingActiveId === user.id
                                    ? "Updating…"
                                    : user.isActive === false
                                      ? "Mark active"
                                      : "Mark inactive"}
                                </button>
                                <button
                                  disabled={forcingLogoutId === user.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    setForceLogoutTarget(user);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <LogOut size={14} />
                                  {forcingLogoutId === user.id ? "Signing out…" : "Force logout"}
                                </button>
                                <button
                                  className="admin-users-row-menu__danger"
                                  disabled={deletingId === user.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    setDeleteTarget(user);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filteredUsers.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <p>
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredUsers.length)} of {filteredUsers.length}
            </p>
            <div className="admin-users-panel__footer-controls">
              <label className="admin-users-panel__page-size">
                <span>Rows</span>
                <span className="admin-users-panel__page-size-control">
                  <select
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    value={pageSize}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <nav aria-label="Portal users pagination" className="admin-users-panel__pagination">
                <button
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <ArrowLeft size={14} />
                </button>
                <button className="is-active" type="button">
                  {safePage}
                </button>
                <button
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  type="button"
                >
                  <ArrowRight size={14} />
                </button>
              </nav>
            </div>
          </footer>
        ) : null}
      </section>

      {forceLogoutTarget ? (
        <div
          aria-label="Force logout customer portal user"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={forcingLogoutId ? undefined : () => setForceLogoutTarget(null)}
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Force logout</h2>
                <p>
                  Sign out all active portal sessions for{" "}
                  <strong>{forceLogoutTarget.email || "this customer user"}</strong>
                  {forceLogoutTarget.companyName ? ` (${forceLogoutTarget.companyName})` : ""}?
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={Boolean(forcingLogoutId)}
                onClick={() => setForceLogoutTarget(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <section className="admin-users-delete">
              <div className="admin-users-delete__confirm">
                <div className="confirm-modal__icon confirm-modal__icon--remove">
                  <XCircle size={22} />
                </div>
                <p>
                  They will need to sign in again to use the customer portal. This does not delete
                  the account.
                </p>
                <div className="admin-users-delete__actions">
                  <button
                    className="secondary-button"
                    disabled={Boolean(forcingLogoutId)}
                    onClick={() => setForceLogoutTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(forcingLogoutId)}
                    onClick={() => void confirmForceLogout()}
                    type="button"
                  >
                    <LogOut size={16} />
                    {forcingLogoutId ? "Signing out…" : "Confirm force logout"}
                  </button>
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          aria-label="Delete customer portal user"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={deletingId ? undefined : () => setDeleteTarget(null)}
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Delete portal user</h2>
                <p>
                  Permanently remove{" "}
                  <strong>{deleteTarget.email || "this customer user"}</strong>
                  {deleteTarget.companyName ? ` (${deleteTarget.companyName})` : ""}?
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={Boolean(deletingId)}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <section className="admin-users-delete">
              <div className="admin-users-delete__confirm">
                <div className="confirm-modal__icon confirm-modal__icon--remove">
                  <Trash2 size={22} />
                </div>
                <p>
                  They will no longer be able to sign in. Active sessions are revoked. This cannot
                  be undone.
                </p>
                <div className="admin-users-delete__actions">
                  <button
                    className="secondary-button"
                    disabled={Boolean(deletingId)}
                    onClick={() => setDeleteTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(deletingId)}
                    onClick={() => void confirmDelete()}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {deletingId ? "Deleting…" : "Delete user"}
                  </button>
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </div>
  );
}
