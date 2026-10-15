import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Filter, MoreVertical, Search } from "lucide-react";

import { LeadActionsMenu } from "../components/LeadActionsMenu.jsx";
import { WorkspaceViewSelect } from "../components/WorkspaceViewSelect.jsx";
import { isSalesAdminSession } from "../lib/auth.js";
import {
  formatLeadCreatedDate,
  getLeadLocationSummary,
  getLeads,
  leadSearchText,
  updateLead,
} from "../lib/leads.js";
import { loadMultiBranchDemoScenario } from "../lib/demoScenario.js";
import { subscribeToAppEvents } from "../lib/eventStream.js";
import { LEAD_SCOPE_OPTIONS, parseLeadScope } from "../lib/workspaceViews.js";

const TABLE_COLUMNS = [
  { key: "companyName", label: "Company" },
  { key: "contactName", label: "Contact" },
  { key: "domainId", label: "Domain ID" },
  { key: "industryType", label: "Industry" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
];

const SORT_OPTIONS = [
  { key: "companyName", label: "Company name" },
  { key: "status", label: "Status" },
  { key: "contactName", label: "Contact" },
  { key: "industryType", label: "Industry" },
  { key: "createdAt", label: "Created date" },
];

function getLeadStatusLabel(lead) {
  if (lead.isActive === false) {
    return "Inactive";
  }

  return lead.status || "New";
}

function getLeadSortValue(lead, key) {
  if (key === "createdAt") {
    return new Date(lead.createdAt).getTime();
  }

  if (key === "status") {
    return getLeadStatusLabel(lead).toLowerCase();
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
  onStatusChange,
  sortBy,
  sortDirection,
  statusFilter,
  statusOptions,
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
          <span>Status</span>
          <select
            onChange={(event) => onStatusChange(event.target.value)}
            value={statusFilter}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "All statuses" : status}
              </option>
            ))}
          </select>
        </label>
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

function StatusBadge({ isActive, status }) {
  if (!isActive) {
    return (
      <span className="lead-status lead-status--inactive">
        <span className="lead-status__dot" />
        Inactive
      </span>
    );
  }

  const tone =
    status === "Approved"
      ? "qualified"
      : status === "Rejected"
        ? "inactive"
        : status === "Pending Finance Review"
          ? "in-progress"
          : status === "Qualified"
            ? "qualified"
            : status === "In Progress"
              ? "in-progress"
              : "new";

  return (
    <span className={`lead-status lead-status--${tone}`}>
      <span className="lead-status__dot" />
      {status}
    </span>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const isSalesAdmin = isSalesAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadScope = isSalesAdmin ? parseLeadScope(searchParams.get("scope")) : undefined;
  const [leads, setLeads] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState("desc");
  const [showFilters, setShowFilters] = useState(false);
  const filterAnchorRef = useRef(null);
  const [openMenuLeadId, setOpenMenuLeadId] = useState(null);
  const [openingLeadId, setOpeningLeadId] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);
  const [statusSyncError, setStatusSyncError] = useState("");

  const refreshLeads = useCallback(async () => {
    try {
      const nextLeads = await getLeads({
        ...(leadScope ? { scope: leadScope } : {}),
        pipelineOnly: true,
      });
      setLeads(nextLeads);
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
    const unsubscribe = subscribeToAppEvents({
      channels: ["quotations", "payments"],
      onEvent: () => {
        void refreshLeads();
      },
    });

    function handleFocus() {
      void refreshLeads();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshLeads]);

  const statusOptions = useMemo(() => {
    const options = new Set();
    for (const lead of leads) {
      if (lead.isActive === false) {
        options.add("Inactive");
      } else {
        options.add(lead.status || "New");
      }
    }

    return ["all", ...Array.from(options).sort()];
  }, [leads]);

  const industryOptions = useMemo(() => {
    const options = new Set(
      leads.map((lead) => lead.industryType).filter((value) => String(value || "").trim()),
    );

    return ["all", ...Array.from(options).sort()];
  }, [leads]);

  const hasActiveFilters =
    statusFilter !== "all" ||
    industryFilter !== "all" ||
    sortBy !== "createdAt" ||
    sortDirection !== "desc";

  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return leads
      .filter((lead) => {
        const matchesSearch = query.length === 0 || leadSearchText(lead).includes(query);
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "Inactive"
            ? lead.isActive === false
            : lead.isActive !== false && lead.status === statusFilter);
        const matchesIndustry =
          industryFilter === "all" || (lead.industryType || "") === industryFilter;

        return matchesSearch && matchesStatus && matchesIndustry;
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
  }, [industryFilter, leads, searchQuery, sortBy, sortDirection, statusFilter]);

  function resetFilters() {
    setStatusFilter("all");
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
    setOpenMenuLeadId(null);
    refreshLeads();
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

  const leadsDescription =
    isSalesAdmin && leadScope === "mine"
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
          {/* <button
            className="secondary-button"
            disabled={demoLoading}
            onClick={handleLoadDemoScenario}
            type="button"
          >
            {demoLoading ? "Loading..." : "Try demo"}
          </button> */}
          <button className="primary-button" onClick={() => navigate("/onboarding")} type="button">
            New customer
          </button>
        </div>
      </header>

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
                  onStatusChange={setStatusFilter}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                  statusFilter={statusFilter}
                  statusOptions={statusOptions}
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

        {leads.length === 0 ? (
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
                {filteredLeads.map((lead) => {
                  const locationSummary = getLeadLocationSummary(lead);

                  return (
                    <tr
                      key={lead.id}
                      className={`leads-table__row ${lead.isActive === false ? "is-inactive" : ""} ${
                        openingLeadId === lead.id ? "is-opening" : ""
                      }`}
                      onClick={() => openLeadDashboard(lead.id)}
                    >
                      <td className="leads-table__company">
                        <span className="leads-table__company-icon">
                          <Building2 size={15} />
                        </span>
                        <span className="leads-table__company-copy">
                          <strong>{lead.companyName}</strong>
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
                      </td>
                      <td>{lead.contactName}</td>
                      <td>
                        <span className="lead-domain-id">{lead.domainId}</span>
                      </td>
                      <td>{lead.industryType || "—"}</td>
                      <td>
                        <StatusBadge isActive={lead.isActive !== false} status={lead.status} />
                      </td>
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
                              setOpenMenuLeadId((current) => (current === lead.id ? null : lead.id));
                            }}
                            type="button"
                          >
                            <MoreVertical size={18} />
                          </button>
                          {openMenuLeadId === lead.id ? (
                            <LeadActionsMenu
                              lead={lead}
                              onClose={() => setOpenMenuLeadId(null)}
                              onEditLead={() => {
                                setOpenMenuLeadId(null);
                                navigate(`/onboarding/${lead.id}/edit`);
                              }}
                              onViewAccount={() => {
                                setOpenMenuLeadId(null);
                                openLeadDashboard(lead.id);
                              }}
                              onEditProduct={() => {
                                setOpenMenuLeadId(null);
                                navigate(`/products/${lead.id}/workflow`, { state: { freshQuote: true } });
                              }}
                              onToggleActive={() => handleToggleActive(lead)}
                            />
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
      </section>
    </section>
  );
}
