// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Filter, MoreVertical, Search } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../components/DeleteCustomerModal.tsx";
import { LeadActionsMenu } from "../components/LeadActionsMenu.tsx";
import { useLeadEdit } from "../components/leads/LeadEditProvider.tsx";
import { WorkspaceViewSelect } from "../components/WorkspaceViewSelect.tsx";
import { isSalesAdminSession } from "../lib/auth.js";
import { formatCurrency } from "../lib/leadDashboard.js";
import { deleteLeadCustomer, updateLead } from "../lib/leads.js";
import { getCustomerPortfolio } from "../lib/organizations.js";
import { subscribeToAppEventsWithReconnect } from "../lib/eventStream.js";
import { CUSTOMER_SCOPE_OPTIONS, parseLeadScope } from "../lib/workspaceViews.js";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const TABLE_COLUMNS = [
  { key: "companyName", label: "Company" },
  { key: "contactName", label: "Contact" },
  { key: "activeProductCount", label: "Products" },
  // Hidden for now — single-location UI.
  // { key: "locationCount", label: "Locations" },
  { key: "avgUsagePercent", label: "Avg usage" },
  { key: "nextRenewalDays", label: "Next renewal" },
  { key: "monthlyRecurring", label: "MRR" },
];

const SORT_OPTIONS = [
  { key: "companyName", label: "Company name" },
  { key: "contactName", label: "Contact" },
  { key: "activeProductCount", label: "Products" },
  { key: "monthlyRecurring", label: "MRR" },
  { key: "customerSince", label: "Customer since" },
  { key: "nextRenewalDays", label: "Next renewal" },
];

function customerSearchText(customer) {
  return [customer.companyName, customer.contactName, customer.tenantId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCustomerSortValue(customer, key) {
  if (key === "customerSince") {
    return customer.customerSince ? new Date(customer.customerSince).getTime() : 0;
  }

  if (key === "nextRenewalDays") {
    return customer.nextRenewalDays ?? Number.POSITIVE_INFINITY;
  }

  if (key === "activeProductCount" || key === "monthlyRecurring") {
    return Number(customer[key] ?? 0);
  }

  return String(customer[key] ?? "").toLowerCase();
}

function CustomersFilterDropdown({
  containerRef,
  onClose,
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
    <div className="leads-filter-dropdown" ref={menuRef} role="dialog" aria-label="Filter and sort customers">
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

export function CustomersPage() {
  const navigate = useNavigate();
  const { startEditLead } = useLeadEdit();
  const isSalesAdmin = isSalesAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const customerScope = isSalesAdmin ? parseLeadScope(searchParams.get("scope")) : undefined;
  const [customers, setCustomers] = useState([]);
  const [currency, setCurrency] = useState("INR");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("monthlyRecurring");
  const [sortDirection, setSortDirection] = useState("desc");
  const [showFilters, setShowFilters] = useState(false);
  const filterAnchorRef = useRef(null);
  const [openingLeadId, setOpeningLeadId] = useState("");
  const [openMenuCustomerId, setOpenMenuCustomerId] = useState("");
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [toastMessage, setToastMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function closeCustomerActionsMenu() {
    setOpenMenuCustomerId("");
    setMenuAnchorEl(null);
  }

  const refreshCustomers = useCallback(async () => {
    try {
      const portfolio = await getCustomerPortfolio(
        customerScope ? { scope: customerScope } : undefined,
      );
      setCustomers(portfolio?.customers || []);
      setCurrency(portfolio?.summary?.currency || "INR");
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load customers.");
    }
  }, [customerScope]);

  useEffect(() => {
    refreshCustomers();
  }, [refreshCustomers]);

  useEffect(() => {
    const unsubscribe = subscribeToAppEventsWithReconnect({
      channels: ["quotations", "payments", "cancellations", "requests"],
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        if (
          eventName &&
          !eventName.startsWith("quotation.") &&
          !eventName.startsWith("payment.") &&
          !eventName.startsWith("cancellation.") &&
          !eventName.startsWith("product_request.") &&
          !eventName.startsWith("branch_add.")
        ) {
          return;
        }
        void refreshCustomers();
      },
    });

    function handleFocus() {
      void refreshCustomers();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshCustomers]);

  useEffect(() => {
    function handleLeadUpdated() {
      void refreshCustomers();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
  }, [refreshCustomers]);

  const hasActiveFilters = sortBy !== "monthlyRecurring" || sortDirection !== "desc";

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return customers
      .filter((customer) => {
        return query.length === 0 || customerSearchText(customer).includes(query);
      })
      .sort((left, right) => {
        const leftValue = getCustomerSortValue(left, sortBy);
        const rightValue = getCustomerSortValue(right, sortBy);

        if (
          sortBy === "customerSince" ||
          sortBy === "nextRenewalDays" ||
          sortBy === "activeProductCount" ||
          sortBy === "monthlyRecurring"
        ) {
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
  }, [customers, searchQuery, sortBy, sortDirection]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize, sortBy, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleCustomers = filteredCustomers.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const pageStart = filteredCustomers.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filteredCustomers.length);

  function resetFilters() {
    setSortBy("monthlyRecurring");
    setSortDirection("desc");
  }

  function openCustomerAccount(leadId) {
    setOpeningLeadId(leadId);
    closeCustomerActionsMenu();
    navigate(`/customers/${leadId}`);
  }

  async function handleToggleActive(customer) {
    try {
      await updateLead(customer.leadId, {
        isActive: customer.isActive === false,
      });
      closeCustomerActionsMenu();
      await refreshCustomers();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not update customer status.");
    }
  }

  function openDeleteCustomer(customer) {
    closeCustomerActionsMenu();
    setDeleteError("");
    setDeleteTarget(customer);
  }

  async function confirmDeleteCustomer() {
    if (!deleteTarget?.leadId || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteLeadCustomer(deleteTarget.leadId);
      setDeleteTarget(null);
      setToastMessage(`Deleted ${deleteTarget.companyName || "customer"}.`);
      await refreshCustomers();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete customer.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function handleCustomerScopeChange(nextScope) {
    const params = new URLSearchParams(searchParams);
    if (nextScope === "all") {
      params.delete("scope");
    } else {
      params.set("scope", nextScope);
    }
    setSearchParams(params, { replace: true });
  }

  const pageDescription =
    isSalesAdmin && customerScope === "mine"
      ? "Active customer accounts in your portfolio (including Partially paid / awaiting payment). Open an account to view subscriptions or start a renewal quote."
      : isSalesAdmin
        ? "All paid customers across the sales team. Open an account to manage subscriptions."
        : "Your paid customers. Open an account to view subscriptions, usage, and renewals.";

  return (
    <section className="leads-page">
      <header className="page-header">
        <div>
          <h1 className={isSalesAdmin ? "page-header__title-select" : undefined}>
            {isSalesAdmin ? (
              <WorkspaceViewSelect
                aria-label="Customers view"
                onChange={handleCustomerScopeChange}
                options={CUSTOMER_SCOPE_OPTIONS}
                value={customerScope}
              />
            ) : (
              "Customers"
            )}
          </h1>
          <p className="page-header__copy">{pageDescription}</p>
        </div>
        <div className="page-header__actions">
          <button className="secondary-button" onClick={() => navigate("/products")} type="button">
            View leads
          </button>
        </div>
      </header>

      <AdminPageToast
        error={deleteError && !deleteTarget ? deleteError : ""}
        onDismiss={() => {
          setToastMessage("");
          if (!deleteTarget) {
            setDeleteError("");
          }
        }}
        success={toastMessage}
      />

      <section className="onboarding-card leads-panel" aria-busy={openingLeadId ? "true" : "false"}>
        <div className="leads-panel__header">
          <div>
            <h2>Browse customers</h2>
            <p>Click a row to open the account overview or start a renewal quote.</p>
          </div>
          <div className="sales-dashboard-table-tools leads-panel__tools">
            <label className="sales-dashboard-table-tools__search">
              <Search size={16} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search customers..."
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
                <CustomersFilterDropdown
                  containerRef={filterAnchorRef}
                  onClose={() => setShowFilters(false)}
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

        {loadError ? <p className="form-error">{loadError}</p> : null}
        {openingLeadId ? (
          <p className="route-inline-status" role="status" aria-live="polite">
            Opening account overview...
          </p>
        ) : null}

        {customers.length === 0 && loadError ? null : customers.length === 0 ? (
          <p className="leads-empty">
            No paid customers yet. Convert a lead to see accounts here.
          </p>
        ) : filteredCustomers.length === 0 ? (
          <p className="leads-empty">No customers match your search or filters.</p>
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
                {visibleCustomers.map((customer) => (
                  <tr
                    key={customer.leadId}
                    className={`leads-table__row is-clickable ${customer.isActive === false ? "is-inactive" : ""} ${
                      openingLeadId === customer.leadId ? "is-opening" : ""
                    }`}
                    onClick={() => openCustomerAccount(customer.leadId)}
                  >
                    <td>
                      <div className="leads-table__company">
                        <span className="leads-table__company-icon">
                          <Building2 size={15} />
                        </span>
                        <span className="leads-table__company-copy">
                          <strong title={customer.companyName || ""}>{customer.companyName}</strong>
                          {/* Hidden for now — single-location UI.
                          {customer.locationCount > 1 ? (
                            <span className="leads-table__company-meta">
                              <span className="lead-location-badge lead-location-badge--multi">
                                {customer.locationCount} locations
                              </span>
                            </span>
                          ) : null}
                          */}
                        </span>
                      </div>
                    </td>
                    <td>{customer.contactName}</td>
                    <td>{customer.activeProductCount}</td>
                    {/* Hidden for now — single-location UI.
                    <td>{customer.locationCount}</td>
                    */}
                    <td>
                      <div className="sales-dashboard-mini-usage">
                        <div
                          className="sales-dashboard-mini-usage__fill"
                          style={{ width: `${customer.avgUsagePercent}%` }}
                        />
                      </div>
                      <span className="sales-dashboard-mini-usage__label">
                        {customer.avgUsagePercent}%
                      </span>
                    </td>
                    <td>
                      {customer.nextRenewalDays === null
                        ? "—"
                        : `${customer.nextRenewalDays} days`}
                    </td>
                    <td>{formatCurrency(customer.monthlyRecurring, currency)}</td>
                    <td className="leads-table__action">
                      <div className="lead-actions">
                        <button
                          aria-expanded={openMenuCustomerId === customer.leadId}
                          aria-haspopup="menu"
                          aria-label={`Actions for ${customer.companyName}`}
                          className="lead-actions__trigger"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (openMenuCustomerId === customer.leadId) {
                              closeCustomerActionsMenu();
                              return;
                            }
                            setOpenMenuCustomerId(customer.leadId);
                            setMenuAnchorEl(event.currentTarget);
                          }}
                          type="button"
                        >
                          <MoreVertical size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {openMenuCustomerId
              ? (() => {
                  const menuCustomer = filteredCustomers.find(
                    (customer) => customer.leadId === openMenuCustomerId,
                  );
                  if (!menuCustomer) {
                    return null;
                  }
                  return (
                    <LeadActionsMenu
                      anchorEl={menuAnchorEl}
                      lead={{
                        id: menuCustomer.leadId,
                        isActive: menuCustomer.isActive,
                      }}
                      onClose={closeCustomerActionsMenu}
                      onDeleteLead={() => openDeleteCustomer(menuCustomer)}
                      onEditLead={() => {
                        closeCustomerActionsMenu();
                        startEditLead(menuCustomer.leadId);
                      }}
                      onViewAccount={() => {
                        closeCustomerActionsMenu();
                        openCustomerAccount(menuCustomer.leadId);
                      }}
                      onEditProduct={() => {
                        closeCustomerActionsMenu();
                        navigate(`/products/${menuCustomer.leadId}/workflow`, {
                          state: { freshQuote: true },
                        });
                      }}
                      onToggleActive={() => handleToggleActive(menuCustomer)}
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
            onConfirm={() => void confirmDeleteCustomer()}
            title="Delete customer"
          />
        ) : null}

        {filteredCustomers.length > 0 ? (
          <footer className="admin-users-panel__footer leads-panel__footer">
            <p>
              Showing {pageStart}–{pageEnd} of {filteredCustomers.length}
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
              <nav aria-label="Customers pagination" className="admin-users-panel__pagination">
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
    </section>
  );
}
