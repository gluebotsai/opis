// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { AdminFieldSelect } from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import {
  createNumberMapping,
  deleteNumberMapping,
  fetchNumberMappings,
  fetchNumberProviders,
  fetchProviderNumbers,
  fetchTenantMappingCapacity,
  updateNumberMapping,
} from "../../lib/numberManagement.js";
import {
  MOBILE_VALIDATION_RULES,
  composePhoneNumber,
  mobileInputPattern,
  mobileValidationMessage,
  normalizeLeadDialCode,
  splitPhoneNumber,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import "../../styles/admin-users-light.css";

const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);

const EMPTY_FORM = {
  tenantId: "",
  productId: "",
  providerId: "",
  numbers: [],
  status: "active",
  notes: "",
};

function emptyNumberEntry(dialCode = "+91") {
  return {
    dialCode: normalizeLeadDialCode(dialCode, "+91"),
    national: "",
    providerId: "",
  };
}

function normalizeNumberEntry(entry, fallbackDialCode = "+91") {
  if (entry && typeof entry === "object") {
    const dialCode = normalizeLeadDialCode(entry.dialCode || fallbackDialCode, "+91");
    return {
      dialCode,
      national: trimMobileNumberForDialCode(entry.national || "", dialCode),
      providerId: String(entry.providerId || "").trim(),
    };
  }
  if (typeof entry === "string" && entry.trim()) {
    const split = splitPhoneNumber(entry, fallbackDialCode);
    return { dialCode: split.dialCode, national: split.national, providerId: "" };
  }
  return emptyNumberEntry(fallbackDialCode);
}

function providerLabel(providers, providerId) {
  if (!providerId) {
    return "";
  }
  return providers.find((entry) => entry.id === providerId)?.name || "Provider";
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const STATUS_FILTER_OPTIONS = [{ value: "all", label: "All statuses" }, ...STATUS_OPTIONS];

const PRODUCT_LABELS = {
  "contact-center": "Contact Center",
  crm: "CRM",
  campaign: "Campaign",
};

function productLabel(value) {
  return PRODUCT_LABELS[value] || value || "—";
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="admin-users-field__required">
      *
    </span>
  );
}

function resizeNumberFields(currentNumbers = [], count = 0, fallbackDialCode = "+91") {
  const size = Math.max(0, Number(count) || 0);
  const fallback = normalizeLeadDialCode(fallbackDialCode, "+91");
  return Array.from({ length: size }, (_, index) =>
    normalizeNumberEntry(currentNumbers[index], fallback),
  );
}

function MappingMobileField({
  dialCode,
  error = "",
  hint = "",
  label,
  onDialCodeChange,
  onNumberChange,
  required = true,
  value,
}) {
  const code = normalizeLeadDialCode(dialCode, "+91");
  const rule = MOBILE_VALIDATION_RULES[code] || MOBILE_VALIDATION_RULES["+91"];
  const validationMessage = mobileValidationMessage(code);

  return (
    <label className={`admin-users-field admin-users-field--mobile${error ? " is-invalid" : ""}`}>
      <span>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      <div className="mobile-field">
        <AdminFieldSelect
          aria-label={`${label} country code`}
          className="admin-field-select--mobile-code"
          menuMinWidth={160}
          onChange={onDialCodeChange}
          options={MOBILE_COUNTRY_CODES.map((entry) => ({
            value: entry,
            label: `${MOBILE_VALIDATION_RULES[entry].flag} ${entry}`,
          }))}
          value={code}
        />
        <input
          aria-invalid={error ? "true" : undefined}
          inputMode="numeric"
          maxLength={rule.digits}
          minLength={required ? rule.digits : undefined}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            onNumberChange(trimMobileNumberForDialCode(event.target.value, code));
          }}
          onInvalid={(event) => {
            event.currentTarget.setCustomValidity(validationMessage);
          }}
          pattern={mobileInputPattern(code)}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={value}
        />
      </div>
      {error ? <span className="admin-users-field__error">{error}</span> : null}
      {!error && hint ? <span className="admin-users-field__hint">{hint}</span> : null}
    </label>
  );
}

export function NumberMappingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [tenantLocked, setTenantLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openRowMenuId, setOpenRowMenuId] = useState("");
  const [rowMenuOpensUp, setRowMenuOpensUp] = useState(false);
  const [capacity, setCapacity] = useState(null);
  const [capacityError, setCapacityError] = useState("");
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableError, setAvailableError] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [selectedAvailable, setSelectedAvailable] = useState([]);
  const [pickerProviderId, setPickerProviderId] = useState("");
  const rowMenuRef = useRef(null);

  const numberSlotCount = editingId ? 1 : (form.numbers || []).length;
  const defaultDialCode = normalizeLeadDialCode(capacity?.dialCode || "+91", "+91");
  const selectionMeta =
    numberSlotCount <= 0
      ? "No slots remaining for this product"
      : selectedAvailable.length
        ? `${selectedAvailable.length} of ${numberSlotCount} selected`
        : `Select up to ${numberSlotCount}`;

  async function loadMappings(nextSearch = search, nextStatus = statusFilter) {
    setLoading(true);
    try {
      const data = await fetchNumberMappings({
        search: nextSearch,
        status: nextStatus === "all" ? undefined : nextStatus,
      });
      setMappings(data.mappings || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load mappings.");
    } finally {
      setLoading(false);
    }
  }

  const tenantFromQuery = String(searchParams.get("tenantId") || "").trim();
  const customerIdFromQuery = String(searchParams.get("customerId") || "").trim();
  const customerBackHref = customerIdFromQuery
    ? `/number-management/customers/${encodeURIComponent(customerIdFromQuery)}`
    : "";

  useEffect(() => {
    const createFromCustomer = searchParams.get("create") === "1";
    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const customerId = String(searchParams.get("customerId") || "").trim();

    function scopedParams() {
      const next = {};
      if (tenantId) next.tenantId = tenantId;
      if (customerId) next.customerId = customerId;
      return next;
    }

    if (createFromCustomer && tenantId) {
      setEditingId("");
      setForm({ ...EMPTY_FORM, tenantId });
      setTenantLocked(true);
      setCapacity(null);
      setCapacityError("");
      setFieldErrors({});
      setFormError("");
      setOverlayOpen(true);
      setOpenRowMenuId("");
      setRowMenuOpensUp(false);
      setSearch(tenantId);
      setStatusFilter("all");
      void loadMappings(tenantId, "all");
      // Drop create=1; keep scope params so sidebar can open the full list.
      setSearchParams(scopedParams(), { replace: true });
      return;
    }

    if (tenantId) {
      // Scoped list from customer "Manage mappings" — keep query in the URL.
      setSearch(tenantId);
      setStatusFilter("all");
      void loadMappings(tenantId, "all");
      return;
    }

    // Clean /mappings (e.g. sidebar) — show every tenant.
    setSearch("");
    setStatusFilter("all");
    void loadMappings("", "all");
  }, [searchParams, setSearchParams]);

  function closeRowMenu() {
    setOpenRowMenuId("");
    setRowMenuOpensUp(false);
  }

  function toggleRowMenu(mappingId, trigger) {
    if (openRowMenuId === mappingId) {
      closeRowMenu();
      return;
    }
    const rect = trigger?.getBoundingClientRect?.();
    const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
    setRowMenuOpensUp(spaceBelow < 140);
    setOpenRowMenuId(mappingId);
  }

  useEffect(() => {
    if (!openRowMenuId) {
      return undefined;
    }
    function handlePointerDown(event) {
      if (rowMenuRef.current && !rowMenuRef.current.contains(event.target)) {
        closeRowMenu();
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeRowMenu();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRowMenuId]);

  useEffect(() => {
    if (!overlayOpen) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
        closeOverlay();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [overlayOpen, saving]);

  useEffect(() => {
    if (!overlayOpen) {
      setCapacity(null);
      setCapacityError("");
      setCapacityLoading(false);
      return undefined;
    }
    const tenantId = String(form.tenantId || "").trim();
    if (!tenantId) {
      setCapacity(null);
      setCapacityError("");
      setCapacityLoading(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setCapacityLoading(true);
      try {
        const data = await fetchTenantMappingCapacity(tenantId, editingId || undefined);
        if (!active) {
          return;
        }
        setCapacity(data);
        setCapacityError("");
        setForm((current) => {
          const customerDial = normalizeLeadDialCode(data.dialCode || "+91", "+91");
          if (editingId) {
            return current;
          }
          const products = (data.products || []).filter((product) => product.remaining > 0);
          const currentId = String(current.productId || "");
          const nextProductId = products.some((product) => product.id === currentId)
            ? currentId
            : products[0]?.id || "";
          const selected = products.find((product) => product.id === nextProductId);
          const slotCount = selected?.remaining || 0;
          return {
            ...current,
            productId: nextProductId,
            numbers: resizeNumberFields(current.numbers, slotCount, customerDial),
          };
        });
      } catch (loadError) {
        if (!active) {
          return;
        }
        setCapacity(null);
        setCapacityError(
          loadError instanceof Error ? loadError.message : "Could not load product capacity.",
        );
      } finally {
        if (active) {
          setCapacityLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [overlayOpen, form.tenantId, editingId]);

  function updateField(field, value) {
    if (tenantLocked && field === "tenantId") {
      return;
    }
    setForm((current) => {
      if (field === "productId" && !editingId) {
        const selected = (capacity?.products || []).find((product) => product.id === value);
        const fallbackDial = normalizeLeadDialCode(
          capacity?.dialCode || defaultDialCode,
          "+91",
        );
        return {
          ...current,
          productId: value,
          numbers: resizeNumberFields([], selected?.remaining || 0, fallbackDial),
        };
      }
      return { ...current, [field]: value };
    });
    setFieldErrors((current) => {
      if (!current[field] && !String(field).startsWith("number_")) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      if (field === "productId") {
        Object.keys(next).forEach((key) => {
          if (key.startsWith("number_")) {
            delete next[key];
          }
        });
      }
      return next;
    });
    setFormError("");
  }

  function updateNumberAt(index, patch) {
    setForm((current) => {
      const numbers = [...(current.numbers || [])];
      const existing = normalizeNumberEntry(
        numbers[index],
        capacity?.dialCode || defaultDialCode,
      );
      const nextDial = normalizeLeadDialCode(
        patch.dialCode != null ? patch.dialCode : existing.dialCode,
        existing.dialCode,
      );
      const nextNational = trimMobileNumberForDialCode(
        patch.national != null ? patch.national : existing.national,
        nextDial,
      );
      numbers[index] = { dialCode: nextDial, national: nextNational };
      return { ...current, numbers };
    });
    setFieldErrors((current) => {
      const key = `number_${index}`;
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormError("");
  }

  async function loadProviders() {
    try {
      const data = await fetchNumberProviders();
      setProviders(data.providers || []);
    } catch {
      setProviders([]);
    }
  }

  async function loadProviderInventory(providerId, nextSearch = availableSearch) {
    if (!providerId) {
      setAvailableNumbers([]);
      return;
    }
    setAvailableLoading(true);
    try {
      const data = await fetchProviderNumbers(providerId, { search: nextSearch });
      setAvailableNumbers(data.numbers || []);
      setAvailableError("");
    } catch (loadError) {
      setAvailableError(
        loadError instanceof Error ? loadError.message : "Could not load provider numbers.",
      );
    } finally {
      setAvailableLoading(false);
    }
  }

  function openAvailablePicker() {
    const dial = normalizeLeadDialCode(capacity?.dialCode || defaultDialCode, "+91");
    const preselected = (form.numbers || [])
      .map((entry) => normalizeNumberEntry(entry, dial))
      .filter((entry) => entry.national)
      .map((entry) => ({
        number: composePhoneNumber(entry.dialCode, entry.national),
        providerId: entry.providerId || form.providerId || "",
      }));
    const providerId = form.providerId || preselected[0]?.providerId || "";
    setPickerProviderId(providerId);
    setSelectedAvailable(preselected);
    setAvailableSearch("");
    setAvailableError("");
    setAvailableOpen(true);
    void loadProviders();
    if (providerId) {
      void loadProviderInventory(providerId, "");
    } else {
      setAvailableNumbers([]);
    }
  }

  function closeAvailablePicker() {
    setAvailableOpen(false);
    setAvailableError("");
  }

  useEffect(() => {
    if (!availableOpen) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAvailablePicker();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [availableOpen]);

  useEffect(() => {
    if (!availableOpen || !pickerProviderId) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadProviderInventory(pickerProviderId, availableSearch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [availableOpen, availableSearch, pickerProviderId]);

  useEffect(() => {
    if (overlayOpen) {
      void loadProviders();
    }
  }, [overlayOpen]);

  function toggleAvailableSelection(numberValue) {
    const value = String(numberValue || "").trim();
    if (!value || !pickerProviderId) {
      return;
    }
    setSelectedAvailable((current) => {
      const exists = current.some((entry) => entry.number.toLowerCase() === value.toLowerCase());
      if (exists) {
        return current.filter((entry) => entry.number.toLowerCase() !== value.toLowerCase());
      }
      if (current.length >= numberSlotCount) {
        setAvailableError(
          numberSlotCount === 1
            ? "This product has 1 slot — select only 1 number."
            : `This product has ${numberSlotCount} slots — select at most ${numberSlotCount} numbers.`,
        );
        return current;
      }
      setAvailableError("");
      return [...current, { number: value, providerId: pickerProviderId }];
    });
  }

  function removeAvailableSelection(numberValue) {
    const value = String(numberValue || "").trim();
    if (!value) {
      return;
    }
    setSelectedAvailable((current) =>
      current.filter((entry) => entry.number.toLowerCase() !== value.toLowerCase()),
    );
    setAvailableError("");
  }

  function applyAvailableSelection() {
    if (selectedAvailable.length > numberSlotCount) {
      setAvailableError(
        numberSlotCount === 1
          ? "This product has 1 slot — select only 1 number."
          : `Select at most ${numberSlotCount} numbers for this product.`,
      );
      return;
    }
    if (!selectedAvailable.length) {
      setAvailableError("Select at least one available number.");
      return;
    }
    const fallbackDial = normalizeLeadDialCode(capacity?.dialCode || defaultDialCode, "+91");
    setForm((current) => {
      const size = editingId ? 1 : (current.numbers || []).length;
      const selectedEntries = selectedAvailable.map(({ number, providerId }) => ({
        ...normalizeNumberEntry(splitPhoneNumber(number, fallbackDial), fallbackDial),
        providerId,
      }));
      const nextNumbers = resizeNumberFields(selectedEntries, size, fallbackDial);
      const uniqueProviderIds = [
        ...new Set(selectedEntries.map((entry) => entry.providerId).filter(Boolean)),
      ];
      return {
        ...current,
        providerId:
          uniqueProviderIds.length === 1
            ? uniqueProviderIds[0]
            : uniqueProviderIds.length > 1
              ? ""
              : current.providerId,
        numbers: nextNumbers,
      };
    });
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => {
        if (key.startsWith("number_") || key === "providerId") {
          delete next[key];
        }
      });
      return next;
    });
    setAvailableOpen(false);
    setFormError("");
  }

  function openCreate() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setTenantLocked(false);
    setCapacity(null);
    setCapacityError("");
    setFieldErrors({});
    setFormError("");
    setOverlayOpen(true);
    closeRowMenu();
  }

  function openEdit(mapping) {
    const split = splitPhoneNumber(mapping.number || "", "+91");
    setEditingId(mapping.id);
    setForm({
      tenantId: mapping.tenantId || "",
      productId: mapping.productId || "",
      providerId: mapping.providerId || "",
      numbers: [
        {
          dialCode: split.dialCode,
          national: split.national,
          providerId: mapping.providerId || "",
        },
      ],
      status: mapping.status || "active",
      notes: mapping.notes || "",
    });
    setTenantLocked(false);
    setCapacity(null);
    setCapacityError("");
    setFieldErrors({});
    setFormError("");
    setOverlayOpen(true);
    closeRowMenu();
  }

  function closeOverlay() {
    if (saving) {
      return;
    }
    setOverlayOpen(false);
    setEditingId("");
    setTenantLocked(false);
    setForm(EMPTY_FORM);
    setCapacity(null);
    setCapacityError("");
    setFieldErrors({});
    setFormError("");
  }

  function validateForm() {
    const nextErrors = {};
    if (!String(form.tenantId || "").trim()) {
      nextErrors.tenantId = "Tenant ID is required.";
    }
    if (!String(form.productId || "").trim()) {
      nextErrors.productId = "Product is required.";
    }
    const numbers = Array.isArray(form.numbers) ? form.numbers : [];
    if (!editingId && numbers.length === 0) {
      nextErrors.productId = nextErrors.productId || "No remaining number slots for this product.";
    }
    const seen = new Set();
    numbers.forEach((entry, index) => {
      const normalized = normalizeNumberEntry(entry, defaultDialCode);
      if (!normalized.national) {
        nextErrors[`number_${index}`] = "Number is required.";
        return;
      }
      const validationError = validateMobileForDialCode(
        normalized.dialCode,
        normalized.national,
      );
      if (validationError) {
        nextErrors[`number_${index}`] = validationError;
        return;
      }
      const key = composePhoneNumber(normalized.dialCode, normalized.national).toLowerCase();
      if (seen.has(key)) {
        nextErrors[`number_${index}`] = "Duplicate number in this form.";
        return;
      }
      seen.add(key);
    });
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    if (!validateForm()) {
      return;
    }
    setSaving(true);
    try {
      const tenantId = String(form.tenantId).trim();
      const productId = String(form.productId).trim();
      const status = form.status || "active";
      const notes = String(form.notes || "").trim();
      const entries = (form.numbers || []).map((entry) =>
        normalizeNumberEntry(entry, defaultDialCode),
      );

      const providerId =
        String(entries[0]?.providerId || form.providerId || "").trim() || null;
      if (editingId) {
        const first = entries[0];
        await updateNumberMapping(editingId, {
          tenantId,
          productId,
          providerId,
          number: composePhoneNumber(first.dialCode, first.national),
          dialCode: first.dialCode,
          numberType: "other",
          agentLabel: "",
          status,
          notes,
        });
        setMessage("Mapping updated.");
      } else {
        for (const entry of entries) {
          const entryProviderId =
            String(entry.providerId || form.providerId || "").trim() || null;
          await createNumberMapping({
            tenantId,
            productId,
            providerId: entryProviderId,
            number: composePhoneNumber(entry.dialCode, entry.national),
            dialCode: entry.dialCode,
            numberType: "other",
            agentLabel: "",
            status,
            notes,
          });
        }
        setMessage(
          entries.length === 1
            ? "Mapping created."
            : `${entries.length} mappings created.`,
        );
      }
      setOverlayOpen(false);
      setEditingId("");
      setTenantLocked(false);
      setForm(EMPTY_FORM);
      await loadMappings(search, statusFilter);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Could not save mapping.");
    } finally {
      setSaving(false);
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
      await deleteNumberMapping(deleteTarget.id);
      setMessage("Mapping deleted.");
      if (editingId === deleteTarget.id) {
        closeOverlay();
      }
      setDeleteTarget(null);
      await loadMappings(search, statusFilter);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete mapping.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const hasActiveFilters = Boolean(search.trim()) || statusFilter !== "all";
  const emptyTitle = hasActiveFilters ? "No mappings match" : "No mappings yet";
  const emptyCopy = hasActiveFilters
    ? "Try a different search or clear filters."
    : "Use Create mapping above to link a phone or DID number to a customer tenant.";

  return (
    <section className="admin-users-page nm-mapping-page">
      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
        success={message}
      />

      <header className="page-header nm-mapping-page__header">
        <div>
          <h1>Number mapping</h1>
          <p className="page-header__copy">
            Map phone, DID, and agent numbers to a tenant product (Contact Center, CRM, or
            Campaign). Each number maps to one product only.
          </p>
        </div>
        <div className="nm-mapping-page__header-actions">
          {customerBackHref ? (
            <Link className="secondary-button" to={customerBackHref}>
              Back to customer
            </Link>
          ) : tenantFromQuery ? (
            <Link className="secondary-button" to="/number-management/dashboard">
              Back to dashboard
            </Link>
          ) : null}
          <button className="primary-button" onClick={openCreate} type="button">
            <Plus size={18} />
            Create mapping
          </button>
        </div>
      </header>

      <section aria-busy={loading} className="admin-users-panel nm-mapping-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Mapped numbers</h2>
            <p>
              {loading
                ? "Loading…"
                : `${mappings.length} mapping${mappings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            <form
              className="admin-users-panel__search"
              onSubmit={(event) => {
                event.preventDefault();
                void loadMappings(search, statusFilter);
              }}
            >
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="Search mappings"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or tenant…"
                type="search"
                value={search}
              />
            </form>
            <label className="nm-mapping-status-filter">
              <span className="sr-only">Filter by status</span>
              <select
                onChange={(event) => {
                  const next = event.target.value;
                  setStatusFilter(next);
                  void loadMappings(search, next);
                }}
                value={statusFilter}
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading">Loading mappings…</p>
          ) : mappings.length === 0 ? (
            <div className="nm-mapping-empty-state">
              <Inbox size={28} aria-hidden="true" />
              <h3>{emptyTitle}</h3>
              <p>{emptyCopy}</p>
              {hasActiveFilters ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                    if (
                      searchParams.get("tenantId") ||
                      searchParams.get("customerId") ||
                      searchParams.get("create")
                    ) {
                      setSearchParams({}, { replace: true });
                    } else {
                      void loadMappings("", "all");
                    }
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table nm-mapping-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Number</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => {
                    const tenant = mapping.tenantId || "—";
                    const number = mapping.number || "—";
                    const product = mapping.productLabel || productLabel(mapping.productId);
                    const notes = mapping.notes || "—";
                    const active = mapping.status === "active";
                    return (
                      <tr key={mapping.id}>
                        <td title={tenant}>{tenant}</td>
                        <td className="nm-mapping-table__number" title={number}>
                          {number}
                        </td>
                        <td title={product}>
                          <span
                            className={`nm-mapping-product-pill nm-mapping-product-pill--${
                              mapping.productId || "unknown"
                            }`}
                          >
                            {product}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`nm-mapping-status ${
                              active ? "is-active" : "is-inactive"
                            }`}
                          >
                            {active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td title={notes}>{notes}</td>
                        <td>
                          <div
                            className="admin-users-table__menu-anchor nm-mapping-table__menu-anchor"
                            ref={openRowMenuId === mapping.id ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={openRowMenuId === mapping.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${number}`}
                              className="admin-users-table__menu-trigger"
                              onClick={(event) =>
                                toggleRowMenu(mapping.id, event.currentTarget)
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openRowMenuId === mapping.id ? (
                              <div
                                className={`admin-users-row-menu${
                                  rowMenuOpensUp ? " is-up" : ""
                                }`}
                                role="menu"
                              >
                                <button
                                  onClick={() => openEdit(mapping)}
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
                                    setDeleteTarget(mapping);
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
      </section>

      {overlayOpen ? (
        <div
          aria-label={editingId ? "Edit mapping" : "Create mapping"}
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Close form"
            className="admin-side-overlay__backdrop"
            disabled={saving}
            onClick={closeOverlay}
            type="button"
          />
          <section className="admin-side-overlay__panel">
            <header className="admin-side-overlay__header">
              <div>
                <h2>{editingId ? "Edit mapping" : "Create mapping"}</h2>
                <p>
                  {tenantLocked
                    ? "Tenant is fixed from the customer page. Choose a product and enter each purchased number."
                    : "Choose a product to open one number field per remaining purchased slot."}
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={saving}
                onClick={closeOverlay}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-users-form admin-side-overlay__form" onSubmit={handleSubmit}>
              <div className="admin-side-overlay__body">
                {formError ? <p className="admin-side-overlay__alert">{formError}</p> : null}

                <label
                  className={`admin-users-field${fieldErrors.tenantId ? " is-invalid" : ""}${
                    tenantLocked ? " is-readonly" : ""
                  }`}
                >
                  <span>
                    Tenant ID
                    <RequiredMark />
                  </span>
                  <input
                    autoComplete="off"
                    onChange={(event) => updateField("tenantId", event.target.value)}
                    placeholder="Tenant identifier"
                    readOnly={tenantLocked}
                    value={form.tenantId}
                  />
                  {tenantLocked ? (
                    <span className="admin-users-field__hint">
                      Locked from customer
                      {capacity?.companyName ? ` — ${capacity.companyName}` : ""}.
                    </span>
                  ) : null}
                  {fieldErrors.tenantId ? (
                    <span className="admin-users-field__error">{fieldErrors.tenantId}</span>
                  ) : null}
                </label>

                <label className={`admin-users-field${fieldErrors.productId ? " is-invalid" : ""}`}>
                  <span>
                    Product
                    <RequiredMark />
                  </span>
                  <AdminFieldSelect
                    aria-label="Product"
                    disabled={!String(form.tenantId || "").trim() || capacityLoading}
                    onChange={(value) => updateField("productId", value)}
                    options={(capacity?.products || [])
                      .filter((product) => product.remaining > 0)
                      .map((product) => ({
                        value: product.id,
                        label:
                          product.remaining === 1
                            ? `${product.label} (1 remaining)`
                            : `${product.label} (${product.remaining} remaining)`,
                      }))}
                    placeholder={
                      capacityLoading
                        ? "Loading products…"
                        : capacityError
                          ? "No eligible products"
                          : "Select product"
                    }
                    value={form.productId || ""}
                  />
                  {capacityError ? (
                    <span className="admin-users-field__error">{capacityError}</span>
                  ) : null}
                  {!capacityError && capacity?.companyName ? (
                    <span className="admin-users-field__hint">
                      {capacity.companyName}
                      {capacity.products?.length
                        ? ` — map within available Contact Center / CRM / Campaign slots.`
                        : ""}
                    </span>
                  ) : null}
                  {fieldErrors.productId ? (
                    <span className="admin-users-field__error">{fieldErrors.productId}</span>
                  ) : null}
                </label>

                <label className={`admin-users-field${fieldErrors.providerId ? " is-invalid" : ""}`}>
                  <span>Provider</span>
                  <AdminFieldSelect
                    aria-label="Provider"
                    onChange={(value) => {
                      updateField("providerId", value);
                      setFieldErrors((current) => {
                        if (!current.providerId) {
                          return current;
                        }
                        const next = { ...current };
                        delete next.providerId;
                        return next;
                      });
                    }}
                    options={(providers || []).map((provider) => ({
                      value: provider.id,
                      label:
                        provider.numberCount === 1
                          ? `${provider.name} (1 available)`
                          : `${provider.name} (${provider.numberCount || 0} available)`,
                    }))}
                    placeholder={
                      providers.length ? "Select provider" : "No providers — add in Number inventory"
                    }
                    value={form.providerId || ""}
                  />
                  <span className="admin-users-field__hint">
                    {editingId
                      ? "Provider for this mapped number."
                      : "Optional default for manually typed numbers. Use Available numbers to pick from one or more providers."}
                  </span>
                  {fieldErrors.providerId ? (
                    <span className="admin-users-field__error">{fieldErrors.providerId}</span>
                  ) : null}
                </label>

                {(form.numbers || []).length > 0 ? (
                  <div className="nm-mapping-number-fields" role="group" aria-label="Numbers">
                    <div className="nm-mapping-number-fields__header">
                      <div>
                        <p className="nm-mapping-number-fields__title">Numbers</p>
                        <p className="nm-mapping-number-fields__copy">
                          {(form.numbers || []).length === 1
                            ? "1 slot remaining for this product"
                            : `${(form.numbers || []).length} slots remaining for this product`}
                          {capacity?.country ? ` · default ${capacity.country}` : ""}
                        </p>
                      </div>
                      <button
                        className="secondary-button nm-mapping-available-btn"
                        onClick={openAvailablePicker}
                        type="button"
                      >
                        Available numbers
                      </button>
                    </div>

                    {(form.numbers || []).map((entry, index) => {
                      const normalized = normalizeNumberEntry(entry, defaultDialCode);
                      const errorKey = `number_${index}`;
                      const label =
                        (form.numbers || []).length === 1
                          ? "Number"
                          : `Number ${index + 1}`;
                      return (
                        <MappingMobileField
                          dialCode={normalized.dialCode}
                          error={fieldErrors[errorKey] || ""}
                          key={`number-field-${index}`}
                          label={label}
                          onDialCodeChange={(nextDial) =>
                            updateNumberAt(index, { dialCode: nextDial })
                          }
                          onNumberChange={(nextNational) =>
                            updateNumberAt(index, { national: nextNational })
                          }
                          value={normalized.national}
                        />
                      );
                    })}
                    {(form.numbers || []).some(
                      (entry) => normalizeNumberEntry(entry, defaultDialCode).providerId,
                    ) ? (
                      <p className="admin-users-field__hint">
                        {(form.numbers || [])
                          .map((entry, index) => {
                            const normalized = normalizeNumberEntry(entry, defaultDialCode);
                            if (!normalized.providerId || !normalized.national) {
                              return null;
                            }
                            const label =
                              (form.numbers || []).length === 1
                                ? "Number"
                                : `Number ${index + 1}`;
                            return `${label}: ${providerLabel(providers, normalized.providerId)}`;
                          })
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="admin-users-field__hint">
                    {capacityLoading
                      ? "Loading number slots…"
                      : form.productId
                        ? "No remaining number slots for this product."
                        : "Select a product to enter numbers."}
                  </p>
                )}

                <label className="admin-users-field">
                  <span>Status</span>
                  <AdminFieldSelect
                    aria-label="Mapping status"
                    onChange={(value) => updateField("status", value)}
                    options={STATUS_OPTIONS}
                    value={form.status}
                  />
                </label>

                <label className="admin-users-field">
                  <span>Notes</span>
                  <textarea
                    onChange={(event) => updateField("notes", event.target.value)}
                    placeholder="Optional notes"
                    rows={3}
                    value={form.notes}
                  />
                </label>
              </div>

              <div className="admin-side-overlay__footer">
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={closeOverlay}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : (form.numbers || []).length > 1
                        ? `Create ${(form.numbers || []).length} mappings`
                        : "Create mapping"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {availableOpen ? (
        <div
          aria-label="Available numbers"
          aria-modal="true"
          className="admin-users-modal nm-available-modal"
          role="dialog"
        >
          <div className="admin-users-modal__backdrop" onClick={closeAvailablePicker} />
          <section className="admin-users-modal__card nm-available-modal__card">
            <header className="nm-available-modal__header">
              <div className="nm-available-modal__header-copy">
                <h2>Available numbers</h2>
                <p>
                  {numberSlotCount === 1
                    ? "Select 1 unmapped number. Switch providers to mix inventory sources."
                    : `Select up to ${numberSlotCount} unmapped numbers. Switch providers without losing prior picks.`}
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                onClick={closeAvailablePicker}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="nm-available-modal__body">
              {availableError ? (
                <p className="admin-side-overlay__alert" role="alert">
                  {availableError}
                </p>
              ) : null}

              <label className="admin-users-field">
                <span>Browse provider inventory</span>
                <AdminFieldSelect
                  aria-label="Provider for inventory"
                  onChange={(value) => {
                    setPickerProviderId(value);
                    setAvailableSearch("");
                    setAvailableError("");
                    void loadProviderInventory(value, "");
                  }}
                  options={(providers || []).map((provider) => ({
                    value: provider.id,
                    label: provider.name,
                  }))}
                  placeholder="Select provider"
                  value={pickerProviderId || ""}
                />
              </label>

              {selectedAvailable.length ? (
                <section
                  className="nm-available-modal__section nm-available-modal__section--selected"
                  aria-label="Selected numbers"
                >
                  <div className="nm-available-modal__section-head">
                    <div>
                      <h3>Selected</h3>
                      <p>
                        {selectedAvailable.length === 1
                          ? "1 number across providers"
                          : `${selectedAvailable.length} numbers across providers`}
                      </p>
                    </div>
                    <span className="nm-available-modal__meta">{selectionMeta}</span>
                  </div>
                  <div className="nm-available-modal__list nm-available-modal__list--selected">
                    {selectedAvailable.map((entry) => (
                      <div className="nm-available-modal__row is-selected" key={entry.number}>
                        <div className="nm-available-modal__option">
                          <span title={entry.number}>{entry.number}</span>
                          {entry.providerId ? (
                            <span className="nm-available-modal__provider-tag">
                              {providerLabel(providers, entry.providerId)}
                            </span>
                          ) : null}
                        </div>
                        <button
                          aria-label={`Remove ${entry.number}`}
                          className="admin-users-panel__icon-button"
                          onClick={() => removeAvailableSelection(entry.number)}
                          type="button"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section
                className="nm-available-modal__section nm-available-modal__section--pool"
                aria-label="Provider inventory"
              >
                <div className="nm-available-modal__section-head nm-available-modal__section-head--row">
                  <div>
                    <h3>Unassigned numbers</h3>
                    <p>
                      {!pickerProviderId
                        ? "Select a provider"
                        : availableLoading
                          ? "Loading…"
                          : availableNumbers.length === 1
                            ? "1 number available"
                            : `${availableNumbers.length} numbers available`}
                    </p>
                  </div>
                  <span className="nm-available-modal__meta">{selectionMeta}</span>
                </div>

                <label className="nm-available-modal__search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="Search provider numbers"
                    disabled={!pickerProviderId}
                    onChange={(event) => setAvailableSearch(event.target.value)}
                    placeholder="Search numbers…"
                    type="search"
                    value={availableSearch}
                  />
                </label>

                <div className="nm-available-modal__list" role="listbox" aria-multiselectable="true">
                  {!pickerProviderId ? (
                    <div className="nm-available-modal__empty" role="status">
                      <p>Select a provider to see unassigned numbers.</p>
                    </div>
                  ) : availableLoading ? (
                    <div className="nm-available-modal__empty" role="status">
                      <p>Loading provider numbers…</p>
                    </div>
                  ) : availableNumbers.length === 0 ? (
                    <div className="nm-available-modal__empty" role="status">
                      <Inbox size={24} aria-hidden="true" />
                      <strong>
                        {availableSearch.trim() ? "No matches" : "No unassigned numbers"}
                      </strong>
                      <p>
                        {availableSearch.trim()
                          ? "Try a different search."
                          : "Add numbers under Number inventory, or type them manually in the form."}
                      </p>
                    </div>
                  ) : (
                    availableNumbers.map((entry) => {
                      const value = entry.number || "";
                      const checked = selectedAvailable.some(
                        (item) => item.number.toLowerCase() === value.toLowerCase(),
                      );
                      return (
                        <div
                          className={`nm-available-modal__row${checked ? " is-selected" : ""}`}
                          key={entry.id}
                        >
                          <label className="nm-available-modal__option">
                            <input
                              checked={checked}
                              onChange={() => toggleAvailableSelection(value)}
                              type="checkbox"
                            />
                            <span title={value}>{value}</span>
                          </label>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="nm-available-modal__footer">
              <button className="secondary-button" onClick={closeAvailablePicker} type="button">
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={selectedAvailable.length === 0}
                onClick={applyAvailableSelection}
                type="button"
              >
                Use selected
                {selectedAvailable.length ? ` (${selectedAvailable.length})` : ""}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          aria-label="Delete number mapping"
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
                <h2>Delete this mapping?</h2>
                <p>
                  Delete {deleteTarget.number || "this number"} for tenant{" "}
                  {deleteTarget.tenantId || "—"}? This cannot be undone.
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
                    {deleting ? "Deleting…" : "Delete mapping"}
                  </button>
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}
