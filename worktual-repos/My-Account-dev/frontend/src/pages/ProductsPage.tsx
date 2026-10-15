// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Filter, MoreVertical, Package, Plus, Search } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../components/DeleteCustomerModal.tsx";
import { LeadActionsMenu } from "../components/LeadActionsMenu.tsx";
import { LeadCreateOverlay } from "../components/leads/LeadCreateOverlay.tsx";
import { useLeadEdit } from "../components/leads/LeadEditProvider.tsx";
import { WorkspaceViewSelect } from "../components/WorkspaceViewSelect.tsx";
import { useLeadCreateSessions } from "../hooks/useLeadCreateSessions.js";
import { isSalesAdminSession } from "../lib/auth.js";
import {
  listSalesOpenProductRequests,
  productRequestListTitle,
  productRequestTypeLabel,
} from "../lib/customerProductRequests.js";
import {
  deleteLeadCustomer,
  formatLeadCreatedDate,
  getLeadLocationSummary,
  getLeads,
  leadSearchText,
  updateLead,
} from "../lib/leads.js";
import { formatDashboardDate } from "../lib/leadDashboard.js";
import { loadMultiBranchDemoScenario } from "../lib/demoScenario.js";
import { subscribeToAppEventsWithReconnect } from "../lib/eventStream.js";
import { LEAD_SCOPE_OPTIONS, isTemporaryLeadScope, parseLeadScope } from "../lib/workspaceViews.js";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const TABLE_COLUMNS = [
  { key: "companyName", label: "Company" },
  { key: "contactName", label: "Contact" },
  { key: "tenantId", label: "Tenant ID" },
  { key: "industryType", label: "Industry" },
  { key: "createdAt", label: "Created" },
];

const SORT_OPTIONS = [
  { key: "companyName", label: "Company name" },
  { key: "contactName", label: "Contact" },
  { key: "industryType", label: "Industry" },
  { key: "createdAt", label: "Created date" },
];

function getLeadSortValue(lead, key) {
  if (key === "createdAt") {
    return new Date(lead.createdAt).getTime();
  }

  return String(lead[key] ?? "").toLowerCase();
}

function LeadsFilterDropdown({
  containerRef,
  industryFilter,
  industryOptions,
  onClose,
  onIndustryChange,
  onReset,
  onSortByChange,
  onSortDirectionChange,
  sortBy,
  sortDirection,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      const container = containerRef?.current;
      if (container && !container.contains(event.target)) {
        onClose();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [containerRef, onClose]);

  return (
    <div className="leads-filter-dropdown" ref={menuRef} role="dialog" aria-label="Filter and sort leads">
      <div className="leads-filter-dropdown__section">
        <p className="leads-filter-dropdown__title">Filter by</p>
        <label className="leads-filter-dropdown__field">
          <span>Industry</span>
          <select
            onChange={(event) => onIndustryChange(event.target.value)}
            value={industryFilter}
          >
            {industryOptions.map((industry) => (
              <option key={industry} value={industry}>
                {industry === "all" ? "All industries" : industry}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="leads-filter-dropdown__section">
        <p className="leads-filter-dropdown__title">Sort by</p>
        <label className="leads-filter-dropdown__field">
          <span>Field</span>
          <select onChange={(event) => onSortByChange(event.target.value)} value={sortBy}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="leads-filter-dropdown__field">
          <span>Order</span>
          <select
            onChange={(event) => onSortDirectionChange(event.target.value)}
            value={sortDirection}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

      <button className="leads-filter-dropdown__reset" onClick={onReset} type="button">
        Clear filters
      </button>
    </div>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSalesAdmin = isSalesAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadScope = isSalesAdmin ? parseLeadScope(searchParams.get("scope")) : undefined;
  const [leads, setLeads] = useState([]);
  const [productRequests, setProductRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState("desc");
  const [showFilters, setShowFilters] = useState(false);
  const filterAnchorRef = useRef(null);
  const [openMenuLeadId, setOpenMenuLeadId] = useState(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [openingLeadId, setOpeningLeadId] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);
  const [statusSyncError, setStatusSyncError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createMessage, setCreateMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const {
    createSessions,
    removeCreateSession,
    startCreateLead,
    updateCreateSession,
  } = useLeadCreateSessions();
  const { startEditLead } = useLeadEdit();

  function closeLeadActionsMenu() {
    setOpenMenuLeadId(null);
    setMenuAnchorEl(null);
  }

  const refreshLeads = useCallback(async () => {
    try {
      const isTemporary = isTemporaryLeadScope(leadScope);
      const scopeOpts = leadScope && !isTemporary ? { scope: leadScope } : undefined;
      const [nextLeads, nextRequests] = await Promise.all([
        getLeads({
          ...(leadScope && !isTemporary ? { scope: leadScope } : {}),
          ...(isTemporary ? { leadKind: "temporary" } : {}),
          pipelineOnly: true,
        }),
        isTemporary
          ? Promise.resolve([])
          : listSalesOpenProductRequests(scopeOpts),
      ]);
      setLeads(nextLeads);
      setProductRequests(Array.isArray(nextRequests) ? nextRequests : []);
      setStatusSyncError("");
    } catch (error) {
      setStatusSyncError(
        error instanceof Error ? error.message : "Could not load leads.",
      );
    }
  }, [leadScope]);

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  useEffect(() => {
    function handleLeadUpdated() {
      void refreshLeads();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
  }, [refreshLeads]);

  useEffect(() => {
    if (!location.state?.openCreate) {
      return;
    }
    startCreateLead();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }
    startCreateLead();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let reloadTimer = null;

    const unsubscribe = subscribeToAppEventsWithReconnect({
      channels: ["quotations", "payments", "cancellations", "requests"],
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        const shouldRefresh =
          !eventName ||
          eventName.startsWith("quotation.") ||
          eventName.startsWith("payment.") ||
          eventName.startsWith("cancellation.") ||
          eventName.startsWith("product_request.") ||
          eventName.startsWith("branch_add.");

        if (!shouldRefresh) {
          return;
        }

        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        reloadTimer = window.setTimeout(() => {
          void refreshLeads();
        }, 500);
      },
    });

    function handleFocus() {
      void refreshLeads();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [refreshLeads]);

  const industryOptions = useMemo(() => {
    const options = new Set(
      leads.map((lead) => lead.industryType).filter((value) => String(value || "").trim()),
    );

    return ["all", ...Array.from(options).sort()];
  }, [leads]);

  const hasActiveFilters =
    industryFilter !== "all" ||
    sortBy !== "createdAt" ||
    sortDirection !== "desc";

  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return leads
      .filter((lead) => {
        const matchesSearch = query.length === 0 || leadSearchText(lead).includes(query);
        const matchesIndustry =
          industryFilter === "all" || (lead.industryType || "") === industryFilter;

        return matchesSearch && matchesIndustry;
      })
      .sort((left, right) => {
        const leftValue = getLeadSortValue(left, sortBy);
        const rightValue = getLeadSortValue(right, sortBy);

        if (sortBy === "createdAt") {
          return (leftValue - rightValue) * multiplier;
        }

        if (leftValue < rightValue) {
          return -1 * multiplier;
        }
        if (leftValue > rightValue) {
          return 1 * multiplier;
        }
        return 0;
      });
  }, [industryFilter, leads, searchQuery, sortBy, sortDirection]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, industryFilter, pageSize, sortBy, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleLeads = filteredLeads.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageStart = filteredLeads.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filteredLeads.length);

  function resetFilters() {
    setIndustryFilter("all");
    setSortBy("createdAt");
    setSortDirection("desc");
  }

  function openLeadDashboard(leadId) {
    setOpeningLeadId(leadId);
    setOpenMenuLeadId(null);
    navigate(`/products/${leadId}`);
  }

  async function handleToggleActive(lead) {
    await updateLead(lead.id, { isActive: lead.isActive === false });
    closeLeadActionsMenu();
    refreshLeads();
  }

  function openDeleteLead(lead) {
    closeLeadActionsMenu();
    setDeleteError("");
    setDeleteTarget(lead);
  }

  async function confirmDeleteLead() {
    if (!deleteTarget?.id || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteLeadCustomer(deleteTarget.id);
      setDeleteTarget(null);
      setCreateMessage(`Deleted ${deleteTarget.companyName || "lead"}.`);
      await refreshLeads();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete lead.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleLoadDemoScenario() {
    setDemoLoading(true);
    try {
      const lead = await loadMultiBranchDemoScenario();
      await refreshLeads();
      navigate(`/products/${lead.id}`);
    } finally {
      setDemoLoading(false);
    }
  }

  function handleLeadScopeChange(nextScope) {
    const params = new URLSearchParams(searchParams);
    if (nextScope === "all") {
      params.delete("scope");
    } else {
      params.set("scope", nextScope);
    }
    setSearchParams(params, { replace: true });
  }

  const isTemporaryScope = isTemporaryLeadScope(leadScope);
  const leadsDescription =
    isSalesAdmin && isTemporaryScope
      ? "Temporary leads for immediate finance-only invoices. No payment link or customer go-live."
      : isSalesAdmin && leadScope === "mine"
      ? "Leads in your pipeline. Open a lead to continue quoting or onboarding."
      : isSalesAdmin
        ? "All leads in the sales pipeline. Converted customers appear on the dashboard."
        : "Leads in the sales pipeline. After purchase, accounts move to the customer dashboard.";

  return (
    <section className="leads-page">
      <header className="page-header">
        <div>
          <h1 className={isSalesAdmin ? "page-header__title-select" : undefined}>
            {isSalesAdmin ? (
              <WorkspaceViewSelect
                aria-label="Leads view"
                onChange={handleLeadScopeChange}
                options={LEAD_SCOPE_OPTIONS}
                value={leadScope}
              />
            ) : (
              "Leads"
            )}
          </h1>
          <p className="page-header__copy">{leadsDescription}</p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button leads-page__create"
            onClick={startCreateLead}
            type="button"
          >
            <Plus size={18} />
            Create lead
          </button>
        </div>
      </header>

      <AdminPageToast
        error={deleteError && !deleteTarget ? deleteError : ""}
        onDismiss={() => {
          setCreateMessage("");
          if (!deleteTarget) {
            setDeleteError("");
          }
        }}
        success={createMessage}
      />

      {productRequests.length > 0 ? (
        <section className="onboarding-card leads-panel leads-panel--product-requests">
          <div className="leads-panel__header">
            <div>
              <h2>Open product requests</h2>
              <p>
                Customer inquiries and configure requests waiting for follow-up
                ({productRequests.length}).
              </p>
            </div>
          </div>
          <ul className="leads-product-requests">
            {productRequests.slice(0, 5).map((request) => {
              const leadId = request.sourceLeadId;
              const company =
                String(request.companyName || "").trim() || "Customer";

              return (
                <li key={request.id}>
                  <div className="leads-product-requests__main">
                    <strong>{company}</strong>
                    <small>
                      {productRequestListTitle(request)}
                      {" · "}
                      {productRequestTypeLabel(request.requestType)}
                      {request.createdAt
                        ? ` · ${formatDashboardDate(request.createdAt)}`
                        : ""}
                    </small>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={!leadId}
                    onClick={() => leadId && navigate(`/customers/${leadId}`)}
                    type="button"
                  >
                    <Package size={16} />
                    Open customer
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="onboarding-card leads-panel" aria-busy={openingLeadId ? "true" : "false"}>
        <div className="leads-panel__header">
          <div>
            <h2>Browse leads</h2>
            <p>Click a row to open the account overview or start a new quote.</p>
          </div>
          <div className="sales-dashboard-table-tools leads-panel__tools">
            <label className="sales-dashboard-table-tools__search">
              <Search size={16} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search leads..."
                type="search"
                value={searchQuery}
              />
            </label>
            <div className="leads-filter-anchor" ref={filterAnchorRef}>
              <button
                aria-expanded={showFilters}
                className={`sales-dashboard-table-tools__filter ${showFilters || hasActiveFilters ? "is-active" : ""}`}
                onClick={() => setShowFilters((current) => !current)}
                type="button"
              >
                <Filter size={16} />
              </button>
              {showFilters ? (
                <LeadsFilterDropdown
                  containerRef={filterAnchorRef}
                  industryFilter={industryFilter}
                  industryOptions={industryOptions}
                  onClose={() => setShowFilters(false)}
                  onIndustryChange={setIndustryFilter}
                  onReset={() => {
                    resetFilters();
                    setShowFilters(false);
                  }}
                  onSortByChange={setSortBy}
                  onSortDirectionChange={setSortDirection}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                />
              ) : null}
            </div>
          </div>
        </div>

        {statusSyncError ? <p className="form-error">{statusSyncError}</p> : null}
        {openingLeadId ? (
          <p className="route-inline-status" role="status" aria-live="polite">
            Opening account overview...
          </p>
        ) : null}

        {leads.length === 0 && statusSyncError ? null : leads.length === 0 ? (
          <p className="leads-empty">
            No leads yet. Create a lead from lead creation to get started.
          </p>
        ) : filteredLeads.length === 0 ? (
          <p className="leads-empty">No leads match your search or filters.</p>
        ) : (
          <div className="leads-table-wrap">
            <table className="leads-table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th className="leads-table__action-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => {
                  const locationSummary = getLeadLocationSummary(lead);

                  return (
                    <tr
                      key={lead.id}
                      className={`leads-table__row is-clickable ${lead.isActive === false ? "is-inactive" : ""} ${
                        openingLeadId === lead.id ? "is-opening" : ""
                      }`}
                      onClick={() => openLeadDashboard(lead.id)}
                    >
                      <td>
                        <div className="leads-table__company">
                          <span className="leads-table__company-icon">
                            <Building2 size={15} />
                          </span>
                          <span className="leads-table__company-copy">
                            <strong title={lead.companyName || ""}>{lead.companyName}</strong>
                            <span className="leads-table__company-meta">
                              {lead.demoScenario ? (
                                <span className="lead-demo-badge">Demo</span>
                              ) : null}
                              <span
                                className={`lead-location-badge ${
                                  locationSummary.count > 1 ? "lead-location-badge--multi" : ""
                                }`}
                              >
                                {locationSummary.shortLabel}
                              </span>
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>{lead.contactName}</td>
                      <td>
                        <span className="lead-domain-id">{lead.tenantId}</span>
                      </td>
                      <td>{lead.industryType || "—"}</td>
                      <td className="leads-table__meta">{formatLeadCreatedDate(lead.createdAt)}</td>
                      <td className="leads-table__action">
                        <div className="lead-actions">
                          <button
                            aria-expanded={openMenuLeadId === lead.id}
                            aria-haspopup="menu"
                            aria-label={`Actions for ${lead.companyName}`}
                            className="lead-actions__trigger"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (openMenuLeadId === lead.id) {
                                closeLeadActionsMenu();
                                return;
                              }
                              setOpenMenuLeadId(lead.id);
                              setMenuAnchorEl(event.currentTarget);
                            }}
                            type="button"
                          >
                            <MoreVertical size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {openMenuLeadId
              ? (() => {
                  const menuLead = filteredLeads.find((lead) => lead.id === openMenuLeadId);
                  if (!menuLead) {
                    return null;
                  }
                  return (
                    <LeadActionsMenu
                      anchorEl={menuAnchorEl}
                      lead={menuLead}
                      onClose={closeLeadActionsMenu}
                      onDeleteLead={() => openDeleteLead(menuLead)}
                      onEditLead={() => {
                        closeLeadActionsMenu();
                        startEditLead(menuLead.id);
                      }}
                      onViewAccount={() => {
                        closeLeadActionsMenu();
                        openLeadDashboard(menuLead.id);
                      }}
                      onEditProduct={() => {
                        closeLeadActionsMenu();
                        navigate(`/products/${menuLead.id}/workflow`, {
                          state: { freshQuote: true },
                        });
                      }}
                      onToggleActive={() => handleToggleActive(menuLead)}
                    />
                  );
                })()
              : null}
          </div>
        )}

        {deleteTarget ? (
          <DeleteCustomerModal
            busy={deleteBusy}
            companyName={deleteTarget.companyName || ""}
            copy="This permanently deletes the company, portal logins, quotations, invoices, and related records. This cannot be undone."
            error={deleteError}
            onCancel={() => {
              if (deleteBusy) {
                return;
              }
              setDeleteTarget(null);
              setDeleteError("");
            }}
            onConfirm={() => void confirmDeleteLead()}
            title="Delete lead"
          />
        ) : null}

        {filteredLeads.length > 0 ? (
          <footer className="admin-users-panel__footer leads-panel__footer">
            <p>
              Showing {pageStart}–{pageEnd} of {filteredLeads.length}
            </p>
            <div className="admin-users-panel__footer-controls">
              <label className="admin-users-panel__page-size">
                <span>Rows per page</span>
                <span className="admin-users-panel__page-size-control">
                  <select
                    aria-label="Rows per page"
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
              <nav aria-label="Leads pagination" className="admin-users-panel__pagination">
                <button
                  aria-label="Previous page"
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
                  aria-label="Next page"
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

      {createSessions.map((session, index) => {
        const minimizedStackIndex = createSessions
          .filter((entry) => entry.presentation === "minimized")
          .findIndex((entry) => entry.id === session.id);

        return (
          <LeadCreateOverlay
            key={session.id}
            leadKind={isTemporaryScope ? "temporary" : "standard"}
            minimized={session.presentation === "minimized"}
            onClose={() => removeCreateSession(session.id)}
            onCreated={async (successMessage) => {
              removeCreateSession(session.id);
              setCreateMessage(
                successMessage ||
                  (isTemporaryScope ? "Temporary lead created." : "Lead created."),
              );
              await refreshLeads();
            }}
            onExpand={() => updateCreateSession(session.id, "open")}
            onMinimize={() => updateCreateSession(session.id, "minimized")}
            stackIndex={minimizedStackIndex >= 0 ? minimizedStackIndex : index}
          />
        );
      })}
    </section>
  );
}
