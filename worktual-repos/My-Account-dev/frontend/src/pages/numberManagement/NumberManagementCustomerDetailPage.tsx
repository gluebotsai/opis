// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  Inbox,
  MoreHorizontal,
  Pencil,
  Phone,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AdminFieldSelect } from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
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
import {
  createNumberMapping,
  deleteNumberMapping,
  fetchNumberManagementCustomer,
  fetchNumberProviders,
  fetchProviderNumbers,
  fetchTenantMappingCapacity,
  updateNumberMapping,
} from "../../lib/numberManagement.js";
import "../../styles/admin-users-light.css";

const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);
const PAGE_SIZE_OPTIONS = [10, 20, 50];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

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

function resizeNumberFields(currentNumbers = [], count = 0, fallbackDialCode = "+91") {
  const size = Math.max(0, Number(count) || 0);
  const fallback = normalizeLeadDialCode(fallbackDialCode, "+91");
  return Array.from({ length: size }, (_, index) =>
    normalizeNumberEntry(currentNumbers[index], fallback),
  );
}

function providerLabel(providers, providerId) {
  if (!providerId) {
    return "";
  }
  return providers.find((entry) => entry.id === providerId)?.name || "Provider";
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="admin-users-field__required">
      *
    </span>
  );
}

function MappingMobileField({
  dialCode,
  error = "",
  label,
  onDialCodeChange,
  onNumberChange,
  value,
}) {
  const code = normalizeLeadDialCode(dialCode, "+91");
  const rule = MOBILE_VALIDATION_RULES[code] || MOBILE_VALIDATION_RULES["+91"];
  const validationMessage = mobileValidationMessage(code);

  return (
    <label className={`admin-users-field admin-users-field--mobile${error ? " is-invalid" : ""}`}>
      <span>
        {label}
        <RequiredMark />
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
          minLength={rule.digits}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            onNumberChange(trimMobileNumberForDialCode(event.target.value, code));
          }}
          onInvalid={(event) => {
            event.currentTarget.setCustomValidity(validationMessage);
          }}
          pattern={mobileInputPattern(code)}
          placeholder={`${rule.digits} digits`}
          required
          type="tel"
          value={value}
        />
      </div>
      {error ? <span className="admin-users-field__error">{error}</span> : null}
    </label>
  );
}

function lifecycleStatusMeta(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active") {
    return { className: "is-active", label: "Active" };
  }
  if (normalized === "inactive") {
    return { className: "is-inactive", label: "Inactive" };
  }
  if (!normalized) {
    return null;
  }
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return { className: "is-neutral", label };
}

export function NumberManagementCustomerDetailPage() {
  const { organizationId } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [openRowMenuId, setOpenRowMenuId] = useState("");
  const [rowMenuOpensUp, setRowMenuOpensUp] = useState(false);
  const rowMenuRef = useRef(null);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [capacity, setCapacity] = useState(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [availableOpen, setAvailableOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableError, setAvailableError] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [selectedAvailable, setSelectedAvailable] = useState([]);
  const [pickerProviderId, setPickerProviderId] = useState("");

  async function reloadDetail() {
    try {
      const data = await fetchNumberManagementCustomer(organizationId);
      setDetail(data);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load customer.");
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchNumberManagementCustomer(organizationId);
        if (!active) {
          return;
        }
        setDetail(data);
        setError("");
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load customer.");
          setDetail(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!openRowMenuId) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (rowMenuRef.current?.contains(event.target)) {
        return;
      }
      setOpenRowMenuId("");
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenRowMenuId("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRowMenuId]);

  const lockedTenantId = String(detail?.customer?.tenantId || "").trim();
  const defaultDialCode = normalizeLeadDialCode(capacity?.dialCode || "+91", "+91");
  const numberSlotCount = editingId ? 1 : (form.numbers || []).length;
  const selectionMeta =
    numberSlotCount <= 0
      ? "No slots remaining for this product"
      : selectedAvailable.length
        ? `${selectedAvailable.length} of ${numberSlotCount} selected`
        : `Select up to ${numberSlotCount}`;

  useEffect(() => {
    if (!overlayOpen) {
      setCapacity(null);
      setCapacityError("");
      setCapacityLoading(false);
      return undefined;
    }
    const tenantId = String(form.tenantId || lockedTenantId || "").trim();
    if (!tenantId) {
      setCapacity(null);
      setCapacityError("Tenant ID is required.");
      setCapacityLoading(false);
      return undefined;
    }

    let active = true;
    setCapacityLoading(true);
    fetchTenantMappingCapacity(tenantId, editingId || undefined)
      .then((data) => {
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
          if (!products.length) {
            setCapacityError("No remaining number slots for this tenant.");
            return {
              ...current,
              productId: "",
              numbers: [],
            };
          }
          const currentId = String(current.productId || "");
          const nextProductId = products.some((product) => product.id === currentId)
            ? currentId
            : products[0]?.id || "";
          const selected = products.find((product) => product.id === nextProductId);
          return {
            ...current,
            productId: nextProductId,
            numbers: resizeNumberFields(current.numbers, selected?.remaining || 0, customerDial),
          };
        });
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setCapacity(null);
        setCapacityError(
          loadError instanceof Error ? loadError.message : "Could not load products.",
        );
      })
      .finally(() => {
        if (active) {
          setCapacityLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [overlayOpen, form.tenantId, lockedTenantId, editingId]);

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

  function toggleRowMenu(mappingId, trigger) {
    if (openRowMenuId === mappingId) {
      setOpenRowMenuId("");
      return;
    }
    const rect = trigger?.getBoundingClientRect?.();
    const spaceBelow = rect ? window.innerHeight - rect.bottom : 240;
    setRowMenuOpensUp(spaceBelow < 180);
    setOpenRowMenuId(mappingId);
  }

  function closeRowMenu() {
    setOpenRowMenuId("");
  }

  function openCreate() {
    if (!lockedTenantId) {
      setError("This customer has no tenant ID for mapping.");
      return;
    }
    setEditingId("");
    setForm({
      ...EMPTY_FORM,
      tenantId: lockedTenantId,
    });
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
      tenantId: mapping.tenantId || lockedTenantId,
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
    setForm(EMPTY_FORM);
    setCapacity(null);
    setCapacityError("");
    setFieldErrors({});
    setFormError("");
    setAvailableOpen(false);
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

  function updateField(key, value) {
    setForm((current) => {
      if (key === "productId" && !editingId) {
        const selected = (capacity?.products || []).find((product) => product.id === value);
        const fallbackDial = normalizeLeadDialCode(capacity?.dialCode || defaultDialCode, "+91");
        return {
          ...current,
          productId: value,
          numbers: resizeNumberFields([], selected?.remaining || 0, fallbackDial),
        };
      }
      return { ...current, [key]: value };
    });
    setFieldErrors((current) => {
      if (!current[key] && !String(key).startsWith("number_")) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      Object.keys(next).forEach((errorKey) => {
        if (String(errorKey).startsWith("number_")) {
          delete next[errorKey];
        }
      });
      return next;
    });
  }

  function updateNumberAt(index, patch) {
    setForm((current) => {
      const numbers = [...(current.numbers || [])];
      const existing = normalizeNumberEntry(numbers[index], defaultDialCode);
      numbers[index] = normalizeNumberEntry({ ...existing, ...patch }, defaultDialCode);
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

  function validateForm() {
    const nextErrors = {};
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
      const tenantId = String(form.tenantId || lockedTenantId).trim();
      const productId = String(form.productId || "").trim();
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
      closeOverlay();
      await reloadDetail();
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Could not save mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleMappingStatus(mapping) {
    const nextStatus = mapping.status === "active" ? "inactive" : "active";
    setStatusUpdatingId(mapping.id);
    setError("");
    closeRowMenu();
    try {
      await updateNumberMapping(mapping.id, {
        tenantId: mapping.tenantId,
        productId: mapping.productId,
        number: mapping.number,
        dialCode: mapping.dialCode || undefined,
        numberType: mapping.numberType || "other",
        agentLabel: mapping.agentLabel || "",
        status: nextStatus,
        notes: mapping.notes || "",
      });
      setMessage(nextStatus === "active" ? "Mapping set to active." : "Mapping set to inactive.");
      await reloadDetail();
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : "Could not update mapping status.",
      );
    } finally {
      setStatusUpdatingId("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await deleteNumberMapping(deleteTarget.id);
      setMessage("Mapping deleted.");
      if (editingId === deleteTarget.id) {
        closeOverlay();
      }
      setDeleteTarget(null);
      await reloadDetail();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete mapping.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const customer = detail?.customer;
  const mappings = detail?.mappings || [];
  const lifecycle = lifecycleStatusMeta(customer?.lifecycleStatus);

  useEffect(() => {
    setPage(1);
  }, [pageSize, organizationId, mappings.length]);

  const totalPages = Math.max(1, Math.ceil(mappings.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = mappings.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, mappings.length);
  const visibleMappings = useMemo(
    () => mappings.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, mappings, pageSize],
  );
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  if (loading) {
    return (
      <section className="nm-customer-page">
        <p className="nm-customer-empty" role="status">
          Loading customer…
        </p>
      </section>
    );
  }

  if (error && !customer) {
    return (
      <section className="nm-customer-page">
        <AdminPageToast error={error || "Customer not found."} onDismiss={() => setError("")} />
        <header className="page-header nm-customer-page__header">
          <div>
            <h1>Customer</h1>
            <p className="page-header__copy">Could not load this tenant.</p>
          </div>
          <Link className="secondary-button" to="/number-management/dashboard">
            Back to dashboard
          </Link>
        </header>
      </section>
    );
  }

  const companyName = customer.companyName || "Customer";
  const tenantId = customer.tenantId || "—";
  const contact = customer.contactName || "—";
  const email = customer.workEmail || customer.adminEmail || "—";
  const country = customer.country || "—";
  const industry = customer.industryType || "—";
  const billingAddress = customer.billingAddress || "—";
  const purchasedProducts = Array.isArray(customer.purchasedProducts)
    ? customer.purchasedProducts
    : [];
  const mappingListHref = (() => {
    const params = new URLSearchParams();
    if (customer.tenantId && customer.tenantId !== "—") {
      params.set("tenantId", customer.tenantId);
    }
    if (organizationId) {
      params.set("customerId", organizationId);
    }
    const query = params.toString();
    return query ? `/number-management/mappings?${query}` : "/number-management/mappings";
  })();

  const productOptions = (capacity?.products || [])
    .filter((product) => product.remaining > 0 || product.id === form.productId)
    .map((product) => ({
      value: product.id,
      label:
        product.remaining === 1
          ? `${product.label} (1 remaining)`
          : `${product.label} (${product.remaining} remaining)`,
    }));
  const formNumbers = Array.isArray(form.numbers) ? form.numbers : [];

  return (
    <section className="admin-users-page nm-customer-page">
      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
        success={message}
      />

      <header className="page-header nm-customer-page__header">
        <div>
          <h1 title={companyName}>{companyName}</h1>
          <p className="page-header__copy">Tenant {tenantId}</p>
        </div>
        <Link className="secondary-button" to="/number-management/dashboard">
          Back to dashboard
        </Link>
      </header>

      <section className="nm-customer-info-panel">
        <header className="nm-customer-info-panel__header">
          <h2>Customer information</h2>
        </header>
        <div className="nm-customer-info-panel__body">
          <dl className="nm-customer-detail-grid">
            <div>
              <dt>Contact</dt>
              <dd title={contact}>{contact}</dd>
            </div>
            <div className="nm-customer-detail-grid__address">
              <dt>Billing address</dt>
              <dd title={billingAddress}>{billingAddress}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd title={country}>{country}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd title={email}>{email}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd title={industry}>{industry}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {lifecycle ? (
                  <span className={`nm-customer-status ${lifecycle.className}`}>{lifecycle.label}</span>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="nm-customer-detail-grid__full">
              <dt>Products purchased</dt>
              <dd className="nm-customer-products">
                {purchasedProducts.length ? (
                  <ul className="nm-customer-products__list">
                    {purchasedProducts.map((product) => {
                      const numberCount = Number(product.numberCount) || 0;
                      const mapped = Number(product.mapped) || 0;
                      const remaining =
                        product.remaining != null
                          ? Math.max(0, Number(product.remaining) || 0)
                          : Math.max(0, numberCount - mapped);
                      const purchasedLabel =
                        numberCount === 1 ? "1 purchased" : `${numberCount} purchased`;
                      const remainingLabel =
                        remaining === 0
                          ? "all mapped"
                          : remaining === 1
                            ? "1 to map"
                            : `${remaining} to map`;
                      return (
                        <li key={product.id}>
                          <span
                            className={`nm-customer-product-pill nm-customer-product-pill--${product.id}${
                              remaining > 0 ? " has-remaining" : " is-complete"
                            }`}
                            title={`${product.label} — ${purchasedLabel}, ${mapped} mapped, ${remainingLabel}`}
                          >
                            <span className="nm-customer-product-pill__label">{product.label}</span>
                            <span className="nm-customer-product-pill__count">{purchasedLabel}</span>
                            <span className="nm-customer-product-pill__sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="nm-customer-product-pill__remaining">
                              {remainingLabel}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        aria-labelledby="nm-customer-mappings-title"
        className="admin-users-panel nm-customer-panel nm-customer-panel--mappings"
      >
        <header className="admin-users-panel__section-header nm-customer-panel__header">
          <div>
            <h2 id="nm-customer-mappings-title">Mapped numbers</h2>
            <p>
              {mappings.length === 1
                ? "1 number in view"
                : `${mappings.length} numbers in view`}
            </p>
          </div>
          <div className="nm-customer-panel__header-actions">
            <Link className="secondary-button" to={mappingListHref}>
              Manage mappings
            </Link>
            <button className="primary-button" onClick={openCreate} type="button">
              <Phone size={16} />
              Map number
            </button>
          </div>
        </header>
        <div className="admin-users-panel__body nm-customer-panel__body">
          {mappings.length === 0 ? (
            <div className="nm-customer-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No numbers mapped yet</h3>
              <p>Map phone numbers to this tenant with the create overlay.</p>
              <button className="primary-button" onClick={openCreate} type="button">
                <Phone size={16} />
                Map number
              </button>
            </div>
          ) : (
            <div className="admin-users-panel__table-wrap nm-customer-panel__table-wrap">
              <table className="admin-users-table nm-customer-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleMappings.map((mapping) => {
                    const number = mapping.number || "—";
                    const product = mapping.productLabel || mapping.productId || "—";
                    const notes = mapping.notes || "—";
                    const active = mapping.status === "active";
                    const menuOpen = openRowMenuId === mapping.id;
                    const statusBusy = statusUpdatingId === mapping.id;
                    return (
                      <tr className={active ? undefined : "is-inactive"} key={mapping.id}>
                        <td className="nm-customer-table__number" title={number}>
                          {number}
                        </td>
                        <td title={product}>
                          <span
                            className={`nm-customer-product-pill nm-customer-product-pill--${
                              mapping.productId || "unknown"
                            }`}
                          >
                            {product}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`nm-customer-status ${
                              active ? "is-active" : "is-inactive"
                            }`}
                          >
                            {active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td title={notes}>{notes}</td>
                        <td>
                          <div
                            className="admin-users-table__menu-anchor nm-customer-table__menu-anchor"
                            ref={menuOpen ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={menuOpen}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${number}`}
                              className="admin-users-table__menu-trigger"
                              disabled={statusBusy}
                              onClick={(event) =>
                                toggleRowMenu(mapping.id, event.currentTarget)
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {menuOpen ? (
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
                                  disabled={statusBusy}
                                  onClick={() => void toggleMappingStatus(mapping)}
                                  role="menuitem"
                                  type="button"
                                >
                                  {active ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                                  {active ? "Mark inactive" : "Mark active"}
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

        {mappings.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} to {pageEnd} of {mappings.length} number
              {mappings.length === 1 ? "" : "s"}
            </span>

            <div className="admin-users-panel__footer-controls">
              <label className="admin-users-panel__page-size">
                <span>Rows per page</span>
                <span className="admin-users-panel__page-size-control">
                  <select
                    aria-label="Rows per page"
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    value={pageSize}
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </span>
              </label>

              <nav aria-label="Mapped numbers pagination" className="admin-users-panel__pagination">
                <button
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <ArrowLeft size={16} />
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button
                    className={pageNumber === currentPage ? "is-active" : ""}
                    key={pageNumber}
                    onClick={() => setPage(pageNumber)}
                    type="button"
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  aria-label="Next page"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  type="button"
                >
                  <ArrowRight size={16} />
                </button>
              </nav>
            </div>
          </footer>
        ) : null}
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
                  {editingId
                    ? "Update number, product, or status for this tenant mapping."
                    : "Tenant is fixed from this customer. Choose a product and enter each remaining number slot."}
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

                <label className="admin-users-field is-readonly">
                  <span>Tenant ID</span>
                  <input readOnly value={form.tenantId} />
                  <span className="admin-users-field__hint">Locked from this customer.</span>
                </label>

                <label className={`admin-users-field${fieldErrors.productId ? " is-invalid" : ""}`}>
                  <span>
                    Product
                    <RequiredMark />
                  </span>
                  <AdminFieldSelect
                    aria-label="Product"
                    disabled={capacityLoading}
                    onChange={(value) => updateField("productId", value)}
                    options={productOptions}
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
                  {fieldErrors.productId ? (
                    <span className="admin-users-field__error">{fieldErrors.productId}</span>
                  ) : null}
                </label>

                <label className={`admin-users-field${fieldErrors.providerId ? " is-invalid" : ""}`}>
                  <span>Provider</span>
                  <AdminFieldSelect
                    aria-label="Provider"
                    onChange={(value) => updateField("providerId", value)}
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

                {formNumbers.length > 0 ? (
                  <div className="nm-mapping-number-fields" role="group" aria-label="Numbers">
                    <div className="nm-mapping-number-fields__header">
                      <div>
                        <p className="nm-mapping-number-fields__title">Numbers</p>
                        <p className="nm-mapping-number-fields__copy">
                          {editingId
                            ? "Update this mapped number"
                            : formNumbers.length === 1
                              ? "1 slot remaining for this product"
                              : `${formNumbers.length} slots remaining for this product`}
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
                    {formNumbers.map((entry, index) => {
                      const normalized = normalizeNumberEntry(entry, defaultDialCode);
                      const label =
                        editingId || formNumbers.length === 1
                          ? "Number"
                          : `Number ${index + 1}`;
                      const providerHint = providerLabel(providers, normalized.providerId);
                      return (
                        <MappingMobileField
                          dialCode={normalized.dialCode}
                          error={fieldErrors[`number_${index}`] || ""}
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
                    {formNumbers.some((entry) => normalizeNumberEntry(entry, defaultDialCode).providerId) ? (
                      <p className="admin-users-field__hint">
                        {formNumbers
                          .map((entry, index) => {
                            const normalized = normalizeNumberEntry(entry, defaultDialCode);
                            if (!normalized.providerId || !normalized.national) {
                              return null;
                            }
                            const label =
                              editingId || formNumbers.length === 1
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
                    value={form.status || "active"}
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
                      : formNumbers.length > 1
                        ? `Create ${formNumbers.length} mappings`
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
