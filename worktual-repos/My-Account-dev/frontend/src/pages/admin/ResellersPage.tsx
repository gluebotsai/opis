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
import { ResellerCreateOverlay } from "../../components/admin/ResellerCreateOverlay.tsx";
import { getAvatarTone } from "../../lib/brandColors.js";
import { fetchManagedResellers, forceLogoutManagedReseller } from "../../lib/resellers.js";
import "../../styles/admin-users-light.css";
import "../../styles/admin-resellers.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatPhone(reseller) {
  if (reseller.mobileNumber) {
    return `${reseller.mobileCountryCode || ""} ${reseller.mobileNumber}`.trim();
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

function portalLogin(reseller) {
  return reseller.users?.[0]?.email || "—";
}

function downloadResellersCsv(resellers) {
  const headers = [
    "Company",
    "Contact",
    "Invoice email",
    "Country",
    "Phone",
    "Portal login",
    "Status",
    "Last Updated",
  ];
  const rows = resellers.map((reseller) => [
    reseller.companyName || "",
    reseller.contactName || "",
    reseller.invoiceEmail || "",
    reseller.country || "",
    formatPhone(reseller) === "—" ? "" : formatPhone(reseller),
    reseller.users?.[0]?.email || "",
    reseller.isActive === false ? "Inactive" : "Active",
    formatUpdatedAt(reseller.updatedAt),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktual-resellers.csv";
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
    <div className="admin-users-filter-dropdown" role="dialog" aria-label="Filter resellers">
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

export function ResellersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [resellers, setResellers] = useState([]);
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
  const [createOpen, setCreateOpen] = useState(Boolean(location.state?.openCreate));
  const [editReseller, setEditReseller] = useState(null);

  const filterAnchorRef = useRef(null);
  const rowMenuRef = useRef(null);

  useEffect(() => {
    const openEditId = location.state?.openEditResellerId;
    if (location.state?.message || location.state?.openCreate || openEditId) {
      if (location.state?.openCreate) {
        setCreateOpen(true);
      }
      navigate(location.pathname, { replace: true, state: {} });
      if (openEditId) {
        // Reseller list may not be loaded yet — resolve once rows arrive.
        setEditReseller({ id: openEditId, _pending: true });
      }
    }
  }, [
    location.pathname,
    location.state?.message,
    location.state?.openCreate,
    location.state?.openEditResellerId,
    navigate,
  ]);

  useEffect(() => {
    if (!editReseller?._pending || loading) {
      return;
    }
    const match = resellers.find((entry) => entry.id === editReseller.id);
    if (match) {
      setEditReseller(match);
      return;
    }
    setEditReseller(null);
    setError("Reseller not found.");
  }, [editReseller, resellers, loading]);

  useEffect(() => {
    setLoading(true);
    fetchManagedResellers()
      .then((rows) => setResellers(rows))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load resellers.");
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
    for (const reseller of resellers) {
      if (reseller.country) {
        set.add(reseller.country);
      }
    }
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [resellers]);

  const stats = useMemo(() => {
    const active = resellers.filter((reseller) => reseller.isActive !== false).length;
    return {
      total: resellers.length,
      active,
      inactive: resellers.length - active,
      countries: countries.length,
    };
  }, [resellers, countries]);

  const filteredResellers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = resellers.filter((reseller) => {
      if (statusFilter === "active" && reseller.isActive === false) {
        return false;
      }
      if (statusFilter === "inactive" && reseller.isActive !== false) {
        return false;
      }
      if (countryFilter !== "all" && reseller.country !== countryFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        reseller.companyName,
        reseller.contactName,
        reseller.invoiceEmail,
        reseller.country,
        reseller.users?.[0]?.email,
        reseller.mobileNumber,
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
  }, [resellers, searchQuery, statusFilter, countryFilter, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredResellers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleResellers = filteredResellers.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasActiveFilters = statusFilter !== "all" || countryFilter !== "all";

  async function confirmForceLogout() {
    if (!forceLogoutTarget) {
      return;
    }
    setForcingLogoutId(forceLogoutTarget.id);
    setError("");
    setMessage("");
    try {
      await forceLogoutManagedReseller(forceLogoutTarget.id);
      setMessage(
        `Signed out all portal sessions for ${forceLogoutTarget.companyName || "reseller"}.`,
      );
      setForceLogoutTarget(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not force logout reseller.",
      );
      setForceLogoutTarget(null);
    } finally {
      setForcingLogoutId("");
    }
  }

  const subtitle =
    "Manage reseller profiles and portal logins. Sales assigns resellers when creating leads.";

  return (
    <div className="admin-users-page admin-resellers-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Resellers</h1>
          <p className="admin-users-page__subtitle" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <button
          className="primary-button admin-users-page__create"
          onClick={() => {
            setError("");
            setEditReseller(null);
            setCreateOpen(true);
          }}
          type="button"
        >
          <Plus size={18} />
          Create reseller
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
            <span title="Total resellers">Total resellers</span>
            <strong title={String(stats.total)}>{stats.total}</strong>
            <small title="All managed resellers">All managed resellers</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active">
            <UserCheck size={20} />
          </div>
          <div>
            <span title="Active resellers">Active resellers</span>
            <strong title={String(stats.active)}>{stats.active}</strong>
            <small title="Currently active">Currently active</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--inactive">
            <UserX size={20} />
          </div>
          <div>
            <span title="Inactive resellers">Inactive resellers</span>
            <strong title={String(stats.inactive)}>{stats.inactive}</strong>
            <small title="Currently inactive">Currently inactive</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-resellers-kpi-card__icon--countries">
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
            <h2>All resellers</h2>
            <p>
              {filteredResellers.length} reseller{filteredResellers.length === 1 ? "" : "s"} in view
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
                disabled={filteredResellers.length === 0}
                onClick={() => downloadResellersCsv(filteredResellers)}
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
            <p className="admin-users-panel__loading">Loading resellers…</p>
          ) : filteredResellers.length === 0 ? (
            <p className="admin-users-panel__empty">
              {resellers.length === 0
                ? "No resellers yet. Use Create reseller to add the first one."
                : "No resellers match your search or filters."}
            </p>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table admin-resellers-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Invoice email</th>
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
                  {visibleResellers.map((reseller) => {
                    const company = reseller.companyName || "—";
                    const contact = reseller.contactName || "—";
                    const invoiceEmail = reseller.invoiceEmail || "—";
                    const country = reseller.country || "—";
                    const login = portalLogin(reseller);
                    const updatedAt = formatUpdatedAt(reseller.updatedAt);

                    return (
                      <tr
                        key={reseller.id}
                        className={reseller.isActive === false ? "is-inactive" : ""}
                      >
                        <td>
                          <div className="admin-users-name-cell">
                            <span
                              className={`admin-users-name-cell__avatar admin-users-name-cell__avatar--${getAvatarTone(
                                reseller.id,
                              )}`}
                            >
                              <Building2 size={14} />
                            </span>
                            <span title={company}>{company}</span>
                          </div>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={invoiceEmail}>{invoiceEmail}</td>
                        <td title={country}>{country}</td>
                        <td title={login}>{login}</td>
                        <td>
                          <span
                            className={`admin-users-status-pill ${
                              reseller.isActive === false ? "admin-users-status-pill--inactive" : ""
                            }`}
                          >
                            <span className="admin-users-status-pill__dot" />
                            {reseller.isActive === false ? "Inactive" : "Active"}
                          </span>
                        </td>
                        <td title={updatedAt}>{updatedAt}</td>
                        <td>
                          <div
                            className="admin-users-table__menu-anchor"
                            ref={openRowMenuId === reseller.id ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={openRowMenuId === reseller.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${reseller.companyName || "reseller"}`}
                              className="admin-users-table__menu-trigger"
                              onClick={() =>
                                setOpenRowMenuId((current) =>
                                  current === reseller.id ? null : reseller.id,
                                )
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openRowMenuId === reseller.id ? (
                              <div className="admin-users-row-menu" role="menu">
                                <button
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setCreateOpen(false);
                                    setEditReseller(reseller);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  disabled={forcingLogoutId === reseller.id}
                                  onClick={() => {
                                    setOpenRowMenuId(null);
                                    setError("");
                                    setMessage("");
                                    setForceLogoutTarget(reseller);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <LogOut size={14} />
                                  {forcingLogoutId === reseller.id
                                    ? "Signing out…"
                                    : "Force logout"}
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

        {filteredResellers.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <p>
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredResellers.length)} of{" "}
              {filteredResellers.length}
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
              <nav aria-label="Resellers pagination" className="admin-users-panel__pagination">
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
        <ResellerCreateOverlay
          onClose={() => setCreateOpen(false)}
          onCreated={async (successMessage, emailError) => {
            setCreateOpen(false);
            setMessage(successMessage || "Reseller created.");
            setError(
              emailError ? `Welcome email was not sent: ${emailError}` : "",
            );
            setLoading(true);
            try {
              const rows = await fetchManagedResellers();
              setResellers(rows);
            } catch (loadError) {
              setError(
                loadError instanceof Error ? loadError.message : "Could not refresh resellers.",
              );
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {editReseller && !editReseller._pending ? (
        <ResellerCreateOverlay
          onClose={() => setEditReseller(null)}
          onUpdated={async (successMessage) => {
            setEditReseller(null);
            setMessage(successMessage || "Reseller updated.");
            setError("");
            setLoading(true);
            try {
              const rows = await fetchManagedResellers();
              setResellers(rows);
            } catch (loadError) {
              setError(
                loadError instanceof Error ? loadError.message : "Could not refresh resellers.",
              );
            } finally {
              setLoading(false);
            }
          }}
          reseller={editReseller}
        />
      ) : null}

      {forceLogoutTarget ? (
        <div
          aria-label="Force logout reseller"
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
                  <strong>{forceLogoutTarget.companyName || "this reseller"}</strong>
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
                  They will need to sign in again to use the reseller portal. This does not delete
                  the reseller record.
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
    </div>
  );
}
