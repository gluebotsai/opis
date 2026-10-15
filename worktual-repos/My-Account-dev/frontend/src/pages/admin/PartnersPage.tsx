// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronDown,
  Download,
  Filter,
  Globe2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  AdminFieldSelect,
  isAdminFieldSelectMenuTarget,
} from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { PartnerCreateOverlay } from "../../components/admin/PartnerCreateOverlay.tsx";
import { getAvatarTone } from "../../lib/brandColors.js";
import {
  deleteManagedPartner,
  fetchManagedPartners,
  forceLogoutManagedPartner,
  updateManagedPartner,
} from "../../lib/partners.js";
import "../../styles/admin-users-light.css";
import "../../styles/admin-partners.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatPhone(partner) {
  if (partner.mobileNumber) {
    return `${partner.mobileCountryCode || ""} ${partner.mobileNumber}`.trim();
  }
  return "—";
}

function formatUpdatedAt(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function portalLogin(partner) {
  return partner.users?.[0]?.email || "—";
}

function downloadPartnersCsv(partners) {
  const headers = [
    "Company",
    "Contact",
    "Work email",
    "Country",
    "Phone",
    "Portal login",
    "Status",
    "Last Updated",
  ];
  const rows = partners.map((partner) => [
    partner.companyName || "",
    partner.contactName || "",
    partner.workEmail || "",
    partner.country || "",
    formatPhone(partner) === "—" ? "" : formatPhone(partner),
    partner.users?.[0]?.email || "",
    partner.isActive === false ? "Inactive" : "Active",
    formatUpdatedAt(partner.updatedAt),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktual-partners.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function FilterDropdown({
  countries,
  countryFilter,
  onClose,
  onCountryChange,
  onStatusChange,
  statusFilter,
}) {
  return (
    <div className="admin-users-filter-dropdown" role="dialog" aria-label="Filter partners">
      <div className="admin-users-filter-dropdown__section">
        <p className="admin-users-filter-dropdown__title">Filter by</p>
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
        <div className="admin-users-filter-dropdown__field">
          <span>Country</span>
          <AdminFieldSelect
            aria-label="Filter by country"
            onChange={onCountryChange}
            options={[
              { value: "all", label: "All countries" },
              ...countries.map((country) => ({ value: country, label: country })),
            ]}
            value={countryFilter}
          />
        </div>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button
          className="secondary-button"
          onClick={() => {
            onStatusChange("all");
            onCountryChange("all");
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

export function PartnersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState(location.state?.message || "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sortDirection, setSortDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [forceLogoutTarget, setForceLogoutTarget] = useState(null);
  const [forcingLogoutId, setForcingLogoutId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [togglingActivePartnerId, setTogglingActivePartnerId] = useState("");
  const [createOpen, setCreateOpen] = useState(Boolean(location.state?.openCreate));
  const [editPartner, setEditPartner] = useState(null);

  const filterAnchorRef = useRef(null);
  const rowMenuRef = useRef(null);

  useEffect(() => {
    const openEditId = location.state?.openEditPartnerId;
    if (location.state?.message || location.state?.openCreate || openEditId) {
      if (location.state?.openCreate) {
        setCreateOpen(true);
      }
      navigate(location.pathname, { replace: true, state: {} });
      if (openEditId) {
        // Partner list may not be loaded yet — resolve once rows arrive.
        setEditPartner({ id: openEditId, _pending: true });
      }
    }
  }, [
    location.pathname,
    location.state?.message,
    location.state?.openCreate,
    location.state?.openEditPartnerId,
    navigate,
  ]);

  useEffect(() => {
    if (!editPartner?._pending || loading) {
      return;
    }
    const match = partners.find((entry) => entry.id === editPartner.id);
    if (match) {
      setEditPartner(match);
      return;
    }
    setEditPartner(null);
    setError("Partner not found.");
  }, [editPartner, partners, loading]);

  useEffect(() => {
    setLoading(true);
    fetchManagedPartners()
      .then((rows) => setPartners(rows))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load partners.");
      })
      .finally(() => setLoading(false));
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
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showFilters, openRowMenuId, forcingLogoutId]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, countryFilter, pageSize]);

  const countries = useMemo(() => {
    const set = new Set();
    for (const partner of partners) {
      if (partner.country) {
        set.add(partner.country);
      }
    }
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [partners]);

  const stats = useMemo(() => {
    const active = partners.filter((partner) => partner.isActive !== false).length;
    return {
      total: partners.length,
      active,
      inactive: partners.length - active,
      countries: countries.length,
    };
  }, [partners, countries]);

  const filteredPartners = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = partners.filter((partner) => {
      if (statusFilter === "active" && partner.isActive === false) {
        return false;
      }
      if (statusFilter === "inactive" && partner.isActive !== false) {
        return false;
      }
      if (countryFilter !== "all" && partner.country !== countryFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        partner.companyName,
        partner.contactName,
        partner.workEmail,
        partner.country,
        partner.users?.[0]?.email,
        partner.mobileNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    filtered.sort((left, right) => {
      const leftStamp = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightStamp = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      return sortDirection === "asc" ? leftStamp - rightStamp : rightStamp - leftStamp;
    });

    return filtered;
  }, [partners, searchQuery, statusFilter, countryFilter, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredPartners.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visiblePartners = filteredPartners.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasActiveFilters = statusFilter !== "all" || countryFilter !== "all";

  async function confirmForceLogout() {
    if (!forceLogoutTarget) {
      return;
    }
    setForcingLogoutId(forceLogoutTarget.id);
    setError("");
    setMessage("");
    try {
      await forceLogoutManagedPartner(forceLogoutTarget.id);
      setMessage(
        `Signed out all portal sessions for ${forceLogoutTarget.companyName || "partner"}.`,
      );
      setForceLogoutTarget(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not force logout partner.",
      );
      setForceLogoutTarget(null);
    } finally {
      setForcingLogoutId("");
    }
  }

  async function confirmDeletePartner() {
    if (!deleteTarget) {
      return;
    }
    setDeletingId(deleteTarget.id);
    setError("");
    setMessage("");
    try {
      await deleteManagedPartner(deleteTarget.id);
      setPartners((current) => current.filter((row) => row.id !== deleteTarget.id));
      setMessage(`Deleted ${deleteTarget.companyName || "partner"}.`);
      setDeleteTarget(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not delete partner.",
      );
      setDeleteTarget(null);
    } finally {
      setDeletingId("");
    }
  }

  async function togglePartnerActive(partner, { nextActive = partner.isActive === false } = {}) {
    if (!partner?.id || togglingActivePartnerId) {
      return;
    }

    setTogglingActivePartnerId(partner.id);
    setError("");
    setMessage("");
    setOpenRowMenuId(null);
    setPartners((current) =>
      current.map((row) => (row.id === partner.id ? { ...row, isActive: nextActive } : row)),
    );

    try {
      await updateManagedPartner(partner.id, {
        isActive: nextActive,
        portalIsActive: nextActive,
      });
      setMessage(
        nextActive
          ? `Activated ${partner.companyName || "partner"}.`
          : `Deactivated ${partner.companyName || "partner"}.`,
      );
    } catch (actionError) {
      setPartners((current) =>
        current.map((row) =>
          row.id === partner.id ? { ...row, isActive: partner.isActive !== false } : row,
        ),
      );
      setError(
        actionError instanceof Error ? actionError.message : "Could not update partner status.",
      );
    } finally {
      setTogglingActivePartnerId("");
    }
  }

  async function handleMarkActive(partner) {
    await togglePartnerActive(partner, { nextActive: true });
  }

  async function confirmMarkInactive() {
    if (!deactivateTarget || togglingActivePartnerId) {
      return;
    }
    await togglePartnerActive(deactivateTarget, { nextActive: false });
    setDeactivateTarget(null);
  }

  const subtitle =
    "Manage referral partners and portal logins. Partners submit leads; sales admin assigns executives who create quotes.";

  return (
    <div className="admin-users-page admin-partners-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Partners</h1>
          <p className="admin-users-page__subtitle" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <button
          className="primary-button admin-users-page__create"
          onClick={() => {
            setError("");
            setEditPartner(null);
            setCreateOpen(true);
          }}
          type="button"
        >
          <Plus size={18} />
          Create partner
        </button>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
        success={message}
      />

      <div className="admin-users-kpi-grid">
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--total">
            <Users size={20} />
          </div>
          <div>
            <span title="Total partners">Total partners</span>
            <strong title={String(stats.total)}>{stats.total}</strong>
            <small title="All referral partners">All referral partners</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active">
            <UserCheck size={20} />
          </div>
          <div>
            <span title="Active partners">Active partners</span>
            <strong title={String(stats.active)}>{stats.active}</strong>
            <small title="Currently active">Currently active</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--inactive">
            <UserX size={20} />
          </div>
          <div>
            <span title="Inactive partners">Inactive partners</span>
            <strong title={String(stats.inactive)}>{stats.inactive}</strong>
            <small title="Currently inactive">Currently inactive</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-partners-kpi-card__icon--countries">
            <Globe2 size={20} />
          </div>
          <div>
            <span title="Countries">Countries</span>
            <strong title={String(stats.countries)}>{stats.countries}</strong>
            <small title="Unique countries">Unique countries</small>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All partners</h2>
            <p>
              {filteredPartners.length} partner{filteredPartners.length === 1 ? "" : "s"} in view
            </p>
          </div>

          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by company, contact, or email..."
                type="search"
                value={searchQuery}
              />
            </label>

            <div className="admin-users-panel__toolbar-actions">
              <button
                className="admin-users-panel__tool-button"
                disabled={filteredPartners.length === 0}
                onClick={() => downloadPartnersCsv(filteredPartners)}
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
                    countries={countries}
                    countryFilter={countryFilter}
                    onClose={() => setShowFilters(false)}
                    onCountryChange={setCountryFilter}
                    onStatusChange={setStatusFilter}
                    statusFilter={statusFilter}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading">Loading partners…</p>
          ) : filteredPartners.length === 0 ? (
            <p className="admin-users-panel__empty">
              {partners.length === 0
                ? "No partners yet. Use Create partner to add the first one."
                : "No partners match your search or filters."}
            </p>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table admin-partners-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Work email</th>
                    <th>Country</th>
                    <th>Portal login</th>
                    <th>Status</th>
                    <th>
                      <button
                        className="admin-users-table__sort"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                        type="button"
                      >
                        Last updated
                        <ChevronDown
                          className={sortDirection === "asc" ? "is-asc" : ""}
                          size={14}
                        />
                      </button>
                    </th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePartners.map((partner) => {
                    const company = partner.companyName || "—";
                    const contact = partner.contactName || "—";
                    const workEmail = partner.workEmail || "—";
                    const country = partner.country || "—";
                    const login = portalLogin(partner);
                    const updatedAt = formatUpdatedAt(partner.updatedAt);

                    return (
                      <tr
                        key={partner.id}
                        className={partner.isActive === false ? "is-inactive" : ""}
                      >
                        <td>
                          <div className="admin-users-name-cell">
                            <span
                              className={`admin-users-name-cell__avatar admin-users-name-cell__avatar--${getAvatarTone(
                                partner.id,
                              )}`}
                            >
                              <Building2 size={14} />
                            </span>
                            <span title={company}>{company}</span>
                          </div>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={workEmail}>{workEmail}</td>
                        <td title={country}>{country}</td>
                        <td title={login}>{login}</td>
                        <td>
                          <span
                            className={`admin-users-status-pill ${
                              partner.isActive === false ? "admin-users-status-pill--inactive" : ""
                            }`}
                          >
                            <span className="admin-users-status-pill__dot" />
                            {partner.isActive === false ? "Inactive" : "Active"}
                          </span>
                        </td>
                        <td title={updatedAt}>{updatedAt}</td>
                        <td>
                          <div
                            className="admin-users-table__menu-anchor"
                            ref={openRowMenuId === partner.id ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={openRowMenuId === partner.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${partner.companyName || "partner"}`}
                              className="admin-users-table__menu-trigger"
                              onClick={() =>
                                setOpenRowMenuId((current) =>
                                  current === partner.id ? null : partner.id,
                                )
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openRowMenuId === partner.id ? (
                              <div className="admin-users-row-menu" role="menu">
                                <button
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setCreateOpen(false);
                                    setEditPartner(partner);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  disabled={togglingActivePartnerId === partner.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    if (partner.isActive === false) {
                                      void handleMarkActive(partner);
                                      return;
                                    }
                                    setDeactivateTarget(partner);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {partner.isActive === false ? (
                                    <UserCheck size={14} />
                                  ) : (
                                    <UserX size={14} />
                                  )}
                                  {togglingActivePartnerId === partner.id
                                    ? "Updating…"
                                    : partner.isActive === false
                                      ? "Mark active"
                                      : "Mark inactive"}
                                </button>
                                <button
                                  disabled={forcingLogoutId === partner.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    setForceLogoutTarget(partner);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <LogOut size={14} />
                                  {forcingLogoutId === partner.id
                                    ? "Signing out…"
                                    : "Force logout"}
                                </button>
                                <button
                                  className="admin-users-row-menu__danger"
                                  disabled={deletingId === partner.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    setDeleteTarget(partner);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Trash2 size={14} />
                                  {deletingId === partner.id ? "Deleting…" : "Delete"}
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

        {filteredPartners.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <p>
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredPartners.length)} of{" "}
              {filteredPartners.length}
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
              <nav aria-label="Partners pagination" className="admin-users-panel__pagination">
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

      {createOpen ? (
        <PartnerCreateOverlay
          onClose={() => setCreateOpen(false)}
          onCreated={async (successMessage, emailError) => {
            setCreateOpen(false);
            setMessage(successMessage || "Partner created.");
            setError(
              emailError ? `Welcome email was not sent: ${emailError}` : "",
            );
            setLoading(true);
            try {
              const rows = await fetchManagedPartners();
              setPartners(rows);
            } catch (loadError) {
              setError(
                loadError instanceof Error ? loadError.message : "Could not refresh partners.",
              );
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {editPartner && !editPartner._pending ? (
        <PartnerCreateOverlay
          onClose={() => setEditPartner(null)}
          onUpdated={async (successMessage) => {
            setEditPartner(null);
            setMessage(successMessage || "Partner updated.");
            setError("");
            setLoading(true);
            try {
              const rows = await fetchManagedPartners();
              setPartners(rows);
            } catch (loadError) {
              setError(
                loadError instanceof Error ? loadError.message : "Could not refresh partners.",
              );
            } finally {
              setLoading(false);
            }
          }}
          partner={editPartner}
        />
      ) : null}

      {forceLogoutTarget ? (
        <div
          aria-label="Force logout partner"
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
                  <strong>{forceLogoutTarget.companyName || "this partner"}</strong>
                  {forceLogoutTarget.users?.[0]?.email
                    ? ` (${forceLogoutTarget.users[0].email})`
                    : ""}
                  ?
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
                  They will need to sign in again to use the partner portal. This does not delete
                  the partner record.
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

      {deactivateTarget ? (
        <div
          aria-label="Mark inactive"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={togglingActivePartnerId ? undefined : () => setDeactivateTarget(null)}
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Mark inactive</h2>
                <p>
                  Deactivate{" "}
                  <strong>{deactivateTarget.companyName || "this partner"}</strong>
                  {deactivateTarget.users?.[0]?.email
                    ? ` (${deactivateTarget.users[0].email})`
                    : ""}
                  ?
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={Boolean(togglingActivePartnerId)}
                onClick={() => setDeactivateTarget(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <section className="admin-users-delete">
              <div className="admin-users-delete__confirm">
                <div className="confirm-modal__icon confirm-modal__icon--remove">
                  <UserX size={22} />
                </div>
                <p>
                  They will not be able to sign in to the partner portal until marked active again.
                  Referral history and commission records are kept.
                </p>
                <div className="admin-users-delete__actions">
                  <button
                    className="secondary-button"
                    disabled={Boolean(togglingActivePartnerId)}
                    onClick={() => setDeactivateTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(togglingActivePartnerId)}
                    onClick={() => void confirmMarkInactive()}
                    type="button"
                  >
                    <UserX size={16} />
                    {togglingActivePartnerId ? "Updating…" : "Confirm mark inactive"}
                  </button>
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          aria-label="Delete partner"
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
                <h2>Delete partner</h2>
                <p>
                  Permanently remove{" "}
                  <strong>{deleteTarget.companyName || "this partner"}</strong>
                  {deleteTarget.users?.[0]?.email
                    ? ` (${deleteTarget.users[0].email})`
                    : ""}
                  ?
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
                  Portal logins and sessions are removed. Partners with referral leads or commission
                  history cannot be deleted — mark them inactive instead. This cannot be undone.
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
                    onClick={() => void confirmDeletePartner()}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {deletingId ? "Deleting…" : "Confirm delete"}
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
