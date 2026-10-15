// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Filter,
  Info,
  MoreHorizontal,
  Percent,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import {
  createCommissionSlab,
  deleteCommissionSlab,
  fetchAdminCommissionSlabs,
  formatCurrencyAmount,
  formatSlabRange,
  updateCommissionSlab,
} from "../../lib/commissions.js";
import {
  AdminFieldSelect,
  isAdminFieldSelectMenuTarget,
} from "../../components/AdminFieldSelect.tsx";
import { SideOverlayDraftIsland } from "../../components/SideOverlayDraftIsland.tsx";
import { useSideOverlayDraftDismiss } from "../../hooks/useSideOverlayDraftDismiss.js";
import {
  isCommissionSlabCreateFormEmpty,
  isCommissionSlabEditFormDirty,
} from "../../lib/sideOverlayFormDraft.js";
import { getLeadCountryDefaults } from "../../lib/countryDefaults.js";
import {
  normalizeNumericInputValue,
  selectZeroOnFocus,
} from "../../lib/integerInputFocus.js";
import { COUNTRY_OPTIONS } from "../../lib/leads.js";
import "../../styles/admin-users-light.css";
import "../../styles/admin-commission-slabs.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const MIN_RATE_PERCENT = 0;
const MAX_RATE_PERCENT = 99.9;
const ROW_MENU_VIEWPORT_PADDING = 8;
const ROW_MENU_GAP = 6;

function getRowMenuPosition(anchorEl, menuEl) {
  if (!anchorEl) {
    return null;
  }

  const rect = anchorEl.getBoundingClientRect();
  const menuHeight = menuEl?.offsetHeight || 120;
  const menuWidth = menuEl?.offsetWidth || 200;
  const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_GAP;
  const openUpward = spaceBelow < menuHeight + ROW_MENU_VIEWPORT_PADDING;

  let top = openUpward ? rect.top - ROW_MENU_GAP - menuHeight : rect.bottom + ROW_MENU_GAP;
  top = Math.max(
    ROW_MENU_VIEWPORT_PADDING,
    Math.min(top, window.innerHeight - menuHeight - ROW_MENU_VIEWPORT_PADDING),
  );

  let left = rect.right - menuWidth;
  left = Math.max(
    ROW_MENU_VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - menuWidth - ROW_MENU_VIEWPORT_PADDING),
  );

  return { top, left };
}

const emptyForm = {
  minAmount: "0",
  maxAmount: "",
  ratePercent: "",
  isActive: true,
};

function nextRatePercentValue(raw) {
  const value = String(raw ?? "");
  if (value === "") {
    return "";
  }
  if (!/^\d*\.?\d{0,1}$/.test(value)) {
    return null;
  }
  if (value === "." || value.endsWith(".")) {
    const whole = value === "." ? 0 : Number(value.slice(0, -1));
    if (!Number.isFinite(whole) || whole > MAX_RATE_PERCENT) {
      return null;
    }
    return value;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < MIN_RATE_PERCENT || num > MAX_RATE_PERCENT) {
    return null;
  }
  return value;
}

function toFormValues(slab) {
  return {
    minAmount: String(slab.minAmount ?? 0),
    maxAmount: slab.maxAmount === null || slab.maxAmount === undefined ? "" : String(slab.maxAmount),
    ratePercent: String(slab.ratePercent ?? ""),
    isActive: slab.isActive !== false,
  };
}

function toPayload(form, country, sortOrder = 0) {
  const currency = getLeadCountryDefaults(country).currency || "INR";
  return {
    country,
    minAmount: Number(form.minAmount),
    maxAmount: Number(form.maxAmount),
    ratePercent: Number(form.ratePercent),
    // Kept in API/DB; not shown in UI — ranges define order.
    sortOrder: Number(sortOrder || 0),
    isActive: form.isActive !== false,
    currency,
  };
}

function formatAmountCell(value, currency) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return formatCurrencyAmount(value, currency);
}

function downloadSlabsCsv(slabs, currency) {
  const headers = ["From", "To", "Rate %", "Status", "Currency", "Country"];
  const rows = slabs.map((slab) => [
    slab.minAmount ?? "",
    slab.maxAmount ?? "",
    slab.ratePercent ?? "",
    slab.isActive !== false ? "Active" : "Inactive",
    slab.currency || currency,
    slab.country || "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktual-commission-slabs.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function StatusFilterDropdown({ onClose, onStatusChange, statusFilter }) {
  return (
    <div className="admin-users-filter-dropdown" role="dialog" aria-label="Filter slabs">
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
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button className="secondary-button" onClick={() => onStatusChange("all")} type="button">
          Clear
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Done
        </button>
      </div>
    </div>
  );
}

function ActiveToggle({ checked, disabled, label, onChange }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`admin-slab-toggle ${checked ? "is-on" : "is-off"}`}
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span className="admin-slab-toggle__track">
        <span className="admin-slab-toggle__thumb" />
      </span>
      <span className="admin-slab-toggle__label">{checked ? "Active" : "Inactive"}</span>
    </button>
  );
}

export function AdminCommissionSlabsPage() {
  const [country, setCountry] = useState("India");
  const [slabs, setSlabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [formBaseline, setFormBaseline] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [overlayMinimized, setOverlayMinimized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [rowMenuAnchorEl, setRowMenuAnchorEl] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);
  const [togglingId, setTogglingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const filterAnchorRef = useRef(null);
  const rowMenuRef = useRef(null);
  const currency = getLeadCountryDefaults(country).currency || "INR";

  function closeRowMenu() {
    setOpenRowMenuId(null);
    setRowMenuAnchorEl(null);
    setRowMenuPosition(null);
  }

  function toggleRowMenu(slabId, trigger) {
    if (openRowMenuId === slabId) {
      closeRowMenu();
      return;
    }
    setOpenRowMenuId(slabId);
    setRowMenuAnchorEl(trigger);
  }

  async function loadSlabs(selectedCountry = country) {
    setLoading(true);
    try {
      const rows = await fetchAdminCommissionSlabs({ country: selectedCountry });
      setSlabs(rows);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load slabs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSlabs(country);
  }, [country]);

  useLayoutEffect(() => {
    if (!openRowMenuId || !rowMenuAnchorEl) {
      return undefined;
    }

    function updatePosition() {
      setRowMenuPosition(getRowMenuPosition(rowMenuAnchorEl, rowMenuRef.current));
    }

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openRowMenuId, rowMenuAnchorEl]);

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
      if (openRowMenuId) {
        const target = event.target;
        if (rowMenuRef.current?.contains(target) || rowMenuAnchorEl?.contains?.(target)) {
          return;
        }
        closeRowMenu();
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowFilters(false);
        closeRowMenu();
        if (!deleting) {
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
  }, [showFilters, openRowMenuId, rowMenuAnchorEl, saving, deleting]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, pageSize, country]);

  const filteredSlabs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = [...slabs].sort(
      (left, right) => Number(left.minAmount) - Number(right.minAmount),
    );

    return sorted.filter((slab) => {
      if (statusFilter === "active" && slab.isActive === false) {
        return false;
      }
      if (statusFilter === "inactive" && slab.isActive !== false) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        formatSlabRange(slab),
        `${slab.ratePercent}%`,
        slab.isActive ? "active" : "inactive",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [slabs, searchQuery, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredSlabs.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleSlabs = filteredSlabs.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasActiveFilters = statusFilter !== "all";
  const openMenuSlab = openRowMenuId
    ? visibleSlabs.find((slab) => slab.id === openRowMenuId) ||
      filteredSlabs.find((slab) => slab.id === openRowMenuId) ||
      null
    : null;

  function updateField(field, value) {
    const next =
      field === "minAmount" || field === "maxAmount"
        ? normalizeNumericInputValue(value)
        : value;
    setForm((current) => ({ ...current, [field]: next }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormBaseline(emptyForm);
    setMessage("");
    setError("");
    setOverlayMinimized(false);
    setModalOpen(true);
  }

  function openEdit(slab) {
    setEditingId(slab.id);
    const nextForm = toFormValues(slab);
    setForm(nextForm);
    setFormBaseline(nextForm);
    setMessage("");
    setError("");
    setOverlayMinimized(false);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormBaseline(null);
    setOverlayMinimized(false);
  }

  const isOverlayDirty = useCallback(() => {
    if (!modalOpen) {
      return false;
    }
    if (editingId) {
      return isCommissionSlabEditFormDirty(form, formBaseline);
    }
    return !isCommissionSlabCreateFormEmpty(form);
  }, [editingId, form, formBaseline, modalOpen]);

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    enabled: modalOpen,
    isBusy: saving,
    isDirty: isOverlayDirty,
    minimized: overlayMinimized,
    onClose: closeModal,
    onExpand: () => setOverlayMinimized(false),
    onMinimize: () => setOverlayMinimized(true),
  });

  function handleRatePercentChange(raw) {
    const next = nextRatePercentValue(normalizeNumericInputValue(raw));
    if (next === null) {
      return;
    }
    updateField("ratePercent", next);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const minAmount = Number(form.minAmount);
    const maxAmount = Number(form.maxAmount);
    const rate = Number(form.ratePercent);
    if (!Number.isFinite(minAmount) || minAmount < 0) {
      setError("From amount must be a non-negative number.");
      return;
    }
    if (form.maxAmount === "" || !Number.isFinite(maxAmount) || maxAmount < 0) {
      setError("To amount is required.");
      return;
    }
    if (maxAmount <= minAmount) {
      setError("To amount must be greater than From amount.");
      return;
    }
    if (!Number.isFinite(rate) || rate < MIN_RATE_PERCENT || rate > MAX_RATE_PERCENT) {
      setError(`Rate must be between ${MIN_RATE_PERCENT} and ${MAX_RATE_PERCENT}.`);
      return;
    }
    if (!/^\d+(\.\d)?$/.test(String(form.ratePercent).trim())) {
      setError("Rate may have at most one decimal place (e.g. 99.9).");
      return;
    }
    setSaving(true);
    try {
      const existingSortOrder = editingId
        ? Number(slabs.find((slab) => slab.id === editingId)?.sortOrder || 0)
        : 0;
      const payload = toPayload(form, country, existingSortOrder);
      if (editingId) {
        await updateCommissionSlab(editingId, payload);
        setMessage("Commission slab updated.");
      } else {
        await createCommissionSlab(payload);
        setMessage("Commission slab created.");
      }
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadSlabs(country);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save slab.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSlabActive(slab) {
    const nextActive = slab.isActive === false;
    setTogglingId(slab.id);
    setError("");
    setMessage("");
    setSlabs((current) =>
      current.map((row) => (row.id === slab.id ? { ...row, isActive: nextActive } : row)),
    );
    try {
      await updateCommissionSlab(slab.id, {
        country,
        minAmount: Number(slab.minAmount),
        maxAmount: Number(slab.maxAmount),
        ratePercent: Number(slab.ratePercent),
        sortOrder: Number(slab.sortOrder || 0),
        isActive: nextActive,
        currency: slab.currency || currency,
      });
      setMessage(
        nextActive
          ? `Activated slab ${formatSlabRange(slab)}.`
          : `Deactivated slab ${formatSlabRange(slab)}.`,
      );
    } catch (toggleError) {
      setSlabs((current) =>
        current.map((row) =>
          row.id === slab.id ? { ...row, isActive: slab.isActive !== false } : row,
        ),
      );
      setError(toggleError instanceof Error ? toggleError.message : "Could not update slab status.");
    } finally {
      setTogglingId("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      await deleteCommissionSlab(deleteTarget.id);
      setMessage("Commission slab deleted.");
      if (editingId === deleteTarget.id) {
        closeModal();
      }
      setDeleteTarget(null);
      await loadSlabs(country);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete slab.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  function handleCountryChange(nextCountry) {
    setCountry(nextCountry);
    setSearchQuery("");
    setMessage("");
    setStatusFilter("all");
    closeModal();
  }

  const subtitle =
    "Define country-based % slabs on paid quotation totals. Finance and partners can view these slabs; only admin can edit.";

  return (
    <div className="admin-users-page admin-commission-slabs-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Commission slabs</h1>
          <p className="admin-users-page__subtitle" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <button className="primary-button admin-users-page__create" onClick={openCreate} type="button">
          <Plus size={18} />
          Create slab
        </button>
      </header>

      {error ? <p className="form-error-banner">{error}</p> : null}
      {message ? <p className="admin-users-page__success">{message}</p> : null}

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Current slabs</h2>
            <p>
              {filteredSlabs.length} slab{filteredSlabs.length === 1 ? "" : "s"} for {country}
            </p>
          </div>

          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search slabs..."
                type="search"
                value={searchQuery}
              />
            </label>

            <div className="admin-users-panel__toolbar-actions">
              <div className="admin-commission-slabs-page__country">
                <AdminFieldSelect
                  aria-label="Filter slabs by country"
                  className="admin-field-select--toolbar"
                  onChange={handleCountryChange}
                  options={COUNTRY_OPTIONS.map((option) => ({
                    value: option,
                    label: option,
                  }))}
                  value={country}
                />
              </div>

              <button
                className="admin-users-panel__tool-button"
                disabled={filteredSlabs.length === 0}
                onClick={() => downloadSlabsCsv(filteredSlabs, currency)}
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
                  <StatusFilterDropdown
                    onClose={() => setShowFilters(false)}
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
            <p className="admin-users-panel__loading">Loading slabs…</p>
          ) : filteredSlabs.length === 0 ? (
            <p className="admin-users-panel__empty">
              {slabs.length === 0
                ? `No slabs for ${country} yet. Use Create slab to add the first range.`
                : "No slabs match your search or filters."}
            </p>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table admin-commission-slabs-table">
                <thead>
                  <tr>
                    <th>From amount ({currency})</th>
                    <th>To amount ({currency})</th>
                    <th>Rate %</th>
                    <th aria-label="Actions" />
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSlabs.map((slab) => {
                    const fromLabel = formatAmountCell(slab.minAmount, currency);
                    const toLabel = formatAmountCell(slab.maxAmount, currency);
                    const rateLabel = `${Number(slab.ratePercent).toFixed(1)}%`;
                    const active = slab.isActive !== false;

                    return (
                      <tr key={slab.id} className={active ? "" : "is-inactive"}>
                        <td title={fromLabel}>{fromLabel}</td>
                        <td title={toLabel}>{toLabel}</td>
                        <td title={rateLabel}>{rateLabel}</td>
                        <td>
                          <div className="admin-users-table__menu-anchor">
                            <button
                              aria-expanded={openRowMenuId === slab.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for slab ${formatSlabRange(slab)}`}
                              className="admin-users-table__menu-trigger"
                              onClick={(event) => toggleRowMenu(slab.id, event.currentTarget)}
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </div>
                        </td>
                        <td className="admin-commission-slabs-table__toggle-cell">
                          <ActiveToggle
                            checked={active}
                            disabled={togglingId === slab.id}
                            label={`${active ? "Deactivate" : "Activate"} slab ${formatSlabRange(slab)}`}
                            onChange={() => void toggleSlabActive(slab)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filteredSlabs.length > 0 ? (
          <footer className="admin-users-panel__footer admin-commission-slabs-page__footer">
            <p className="admin-commission-slabs-page__hint">
              <Info size={14} />
              <span title={`Example: a deal of ${formatCurrencyAmount(100000, currency)} in ${country} uses the matching active slab rate.`}>
                Example: {formatCurrencyAmount(100000, currency)} in {country} uses the matching
                active slab.
              </span>
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
              <nav aria-label="Slabs pagination" className="admin-users-panel__pagination">
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

      {openMenuSlab && rowMenuAnchorEl && typeof document !== "undefined"
        ? createPortal(
            <div
              className="admin-users-row-menu admin-users-row-menu--portal"
              ref={rowMenuRef}
              role="menu"
              style={
                rowMenuPosition
                  ? {
                      left: `${rowMenuPosition.left}px`,
                      top: `${rowMenuPosition.top}px`,
                    }
                  : { visibility: "hidden" }
              }
            >
              <button
                onClick={() => {
                  closeRowMenu();
                  openEdit(openMenuSlab);
                }}
                role="menuitem"
                type="button"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                className="admin-users-row-menu__danger"
                onClick={() => {
                  closeRowMenu();
                  setDeleteTarget(openMenuSlab);
                }}
                role="menuitem"
                type="button"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}

      {modalOpen ? (
        overlayMinimized ? (
          isOverlayDirty() ? (
            <SideOverlayDraftIsland
              draftKind={editingId ? "edit" : "create"}
              icon={Percent}
              label={editingId ? "Edit slab" : "Create slab"}
              onDiscard={discardDraft}
              onOpen={expandDraft}
            />
          ) : null
        ) : (
        <div
          aria-label={editingId ? "Edit commission slab" : "Create commission slab"}
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Minimize form to draft"
            className="admin-side-overlay__backdrop"
            disabled={saving}
            onClick={requestDismiss}
            type="button"
          />
          <section className="admin-side-overlay__panel">
            <header className="admin-side-overlay__header">
              <div>
                <h2>{editingId ? "Edit slab" : "Create slab"}</h2>
                <p>
                  {country} · {currency}. Rate must be between {MIN_RATE_PERCENT} and{" "}
                  {MAX_RATE_PERCENT}.
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={saving}
                onClick={requestDismiss}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-users-form admin-side-overlay__form" onSubmit={handleSubmit}>
              <div className="admin-side-overlay__body">
                <div className="admin-users-form__grid">
                  <label className="admin-users-field">
                    <span>From amount ({currency}) *</span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => updateField("minAmount", event.target.value)}
                      onFocus={selectZeroOnFocus}
                      placeholder="0"
                      required
                      type="text"
                      value={form.minAmount}
                    />
                  </label>
                  <label className="admin-users-field">
                    <span>To amount ({currency}) *</span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => updateField("maxAmount", event.target.value)}
                      onFocus={selectZeroOnFocus}
                      placeholder="Enter end amount"
                      required
                      type="text"
                      value={form.maxAmount}
                    />
                  </label>
                  <label className="admin-users-field">
                    <span>Rate % *</span>
                    <input
                      inputMode="decimal"
                      max={MAX_RATE_PERCENT}
                      min={MIN_RATE_PERCENT}
                      onChange={(event) => handleRatePercentChange(event.target.value)}
                      onFocus={selectZeroOnFocus}
                      placeholder="0"
                      required
                      step="0.1"
                      type="number"
                      value={form.ratePercent}
                    />
                  </label>
                </div>
              </div>

              <div className="admin-side-overlay__footer">
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={requestDismiss}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create slab"}
                </button>
              </div>
            </form>
          </section>
        </div>
        )
      ) : null}

      {deleteTarget ? (
        <div
          aria-label="Delete commission slab"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={deleting ? undefined : () => setDeleteTarget(null)}
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Delete this slab?</h2>
                <p>
                  Delete slab {formatSlabRange(deleteTarget)} ({deleteTarget.ratePercent}%)? This
                  cannot be undone.
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
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
                <div className="admin-users-delete__actions">
                  <button
                    className="secondary-button"
                    disabled={deleting}
                    onClick={() => setDeleteTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    disabled={deleting}
                    onClick={() => void confirmDelete()}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {deleting ? "Deleting…" : "Delete slab"}
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
