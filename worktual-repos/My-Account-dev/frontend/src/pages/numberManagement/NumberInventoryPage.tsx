// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Inbox,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { AdminFieldSelect } from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import {
  LEAD_COUNTRY_DEFAULTS,
  MOBILE_VALIDATION_RULES,
  composePhoneNumber,
  getDialCodeForCountry,
  mobileInputPattern,
  mobileValidationMessage,
  normalizeLeadDialCode,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import {
  confirmProviderNumberImport,
  createNumberProvider,
  createProviderNumber,
  deleteNumberProvider,
  deleteProviderNumber,
  fetchNumberProviders,
  fetchProviderNumbers,
  previewProviderNumberImport,
  updateNumberProvider,
} from "../../lib/numberManagement.js";
import "../../styles/admin-users-light.css";

const EMPTY_PROVIDER = {
  name: "",
  imageData: "",
  country: "India",
  // storage / accountId hidden from UI — DB columns remain; API accepts optional empty strings
  // storage: "",
  // accountId: "",
};

const COUNTRY_OPTIONS = Object.keys(LEAD_COUNTRY_DEFAULTS).map((country) => ({
  value: country,
  label: country,
}));

const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);

function RequiredMark() {
  return (
    <span aria-hidden="true" className="admin-users-field__required">
      *
    </span>
  );
}

function parseCsvNumbers(text) {
  return String(text || "")
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^number$/i.test(line));
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose an image file (PNG, JPEG, GIF, or WebP)."));
      return;
    }
    if (file.size > 500 * 1024) {
      reject(new Error("Image must be under 500KB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

export function NumberInventoryPage() {
  const [providers, setProviders] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [numberSearch, setNumberSearch] = useState("");
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState("");
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER);
  const [providerFieldErrors, setProviderFieldErrors] = useState({});
  const [providerFormError, setProviderFormError] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [numberDialCode, setNumberDialCode] = useState("+91");
  const [addingNumber, setAddingNumber] = useState(false);
  const [numberFieldError, setNumberFieldError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [deleteProviderTarget, setDeleteProviderTarget] = useState(null);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const csvInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const selectedProvider = useMemo(
    () => providers.find((entry) => entry.id === selectedId) || null,
    [providers, selectedId],
  );
  const providerDialCode = normalizeLeadDialCode(
    getDialCodeForCountry(selectedProvider?.country || "India"),
    "+91",
  );
  const activeDialCode = normalizeLeadDialCode(numberDialCode, providerDialCode);
  const activeDialRule =
    MOBILE_VALIDATION_RULES[activeDialCode] || MOBILE_VALIDATION_RULES["+91"];

  async function loadProviders(nextSearch = providerSearch, preferId = selectedId) {
    setLoading(true);
    try {
      const data = await fetchNumberProviders({ search: nextSearch });
      const list = data.providers || [];
      setProviders(list);
      setError("");
      if (!list.length) {
        setSelectedId("");
        setNumbers([]);
      } else if (preferId && list.some((entry) => entry.id === preferId)) {
        setSelectedId(preferId);
      } else {
        setSelectedId(list[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load providers.");
    } finally {
      setLoading(false);
    }
  }

  async function loadNumbers(providerId, nextSearch = numberSearch) {
    if (!providerId) {
      setNumbers([]);
      return;
    }
    setNumbersLoading(true);
    try {
      const data = await fetchProviderNumbers(providerId, { search: nextSearch });
      setNumbers(data.numbers || []);
    } catch (loadError) {
      setToast({
        tone: "error",
        message: loadError instanceof Error ? loadError.message : "Could not load numbers.",
      });
    } finally {
      setNumbersLoading(false);
    }
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setNumbers([]);
      return;
    }
    void loadNumbers(selectedId, numberSearch);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }
    const nextDial = normalizeLeadDialCode(
      getDialCodeForCountry(selectedProvider.country || "India"),
      "+91",
    );
    setNumberDialCode(nextDial);
    setNewNumber((current) => trimMobileNumberForDialCode(current, nextDial));
    setNumberFieldError("");
  }, [selectedProvider?.id, selectedProvider?.country]);

  useEffect(() => {
    if (!selectedId) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadNumbers(selectedId, numberSearch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [numberSearch, selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProviders(providerSearch, selectedId);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [providerSearch]);

  function closeProviderForm() {
    if (savingProvider) {
      return;
    }
    setProviderFormOpen(false);
  }

  useEffect(() => {
    if (!providerFormOpen) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape" && !savingProvider) {
        closeProviderForm();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [providerFormOpen, savingProvider]);

  useEffect(() => {
    if (!importOpen) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape" && !importing) {
        setImportOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [importOpen, importing]);

  useEffect(() => {
    if (!deleteProviderTarget) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape" && !deletingProvider) {
        setDeleteProviderTarget(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteProviderTarget, deletingProvider]);

  function openCreateProvider() {
    setEditingProviderId("");
    setProviderForm(EMPTY_PROVIDER);
    setProviderFieldErrors({});
    setProviderFormError("");
    setProviderFormOpen(true);
  }

  function openEditProvider(provider) {
    setEditingProviderId(provider.id);
    setProviderForm({
      name: provider.name || "",
      imageData: provider.imageData || "",
      country: provider.country || "India",
      // storage: provider.storage || "",
      // accountId: provider.accountId || "",
    });
    setProviderFieldErrors({});
    setProviderFormError("");
    setProviderFormOpen(true);
  }

  async function handleImagePick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const imageData = await readImageAsDataUrl(file);
      setProviderForm((current) => ({ ...current, imageData }));
      setProviderFieldErrors((current) => {
        const next = { ...current };
        delete next.imageData;
        return next;
      });
    } catch (imageError) {
      setProviderFieldErrors((current) => ({
        ...current,
        imageData: imageError instanceof Error ? imageError.message : "Invalid image.",
      }));
    }
  }

  async function handleSaveProvider(event) {
    event.preventDefault();
    const errors = {};
    if (!String(providerForm.name || "").trim()) {
      errors.name = "Provider name is required.";
    }
    if (!String(providerForm.country || "").trim()) {
      errors.country = "Country is required.";
    }
    if (Object.keys(errors).length) {
      setProviderFieldErrors(errors);
      return;
    }
    setSavingProvider(true);
    setProviderFormError("");
    try {
      // storage / accountId omitted from payload — backend defaults to "" on create;
      // patch keeps existing DB values when keys are absent.
      const payload = {
        name: String(providerForm.name || "").trim(),
        imageData: providerForm.imageData || "",
        country: String(providerForm.country || "").trim(),
      };
      const result = editingProviderId
        ? await updateNumberProvider(editingProviderId, payload)
        : await createNumberProvider(payload);
      setProviderFormOpen(false);
      setToast({
        tone: "success",
        message: editingProviderId ? "Provider updated." : "Provider created.",
      });
      await loadProviders(providerSearch, result.provider?.id || editingProviderId || selectedId);
    } catch (saveError) {
      setProviderFormError(
        saveError instanceof Error ? saveError.message : "Could not save provider.",
      );
    } finally {
      setSavingProvider(false);
    }
  }

  async function handleDeleteProvider() {
    if (!deleteProviderTarget) {
      return;
    }
    setDeletingProvider(true);
    try {
      await deleteNumberProvider(deleteProviderTarget.id);
      setDeleteProviderTarget(null);
      setToast({ tone: "success", message: "Provider deleted." });
      await loadProviders(providerSearch, "");
    } catch (deleteError) {
      setToast({
        tone: "error",
        message: deleteError instanceof Error ? deleteError.message : "Could not delete provider.",
      });
    } finally {
      setDeletingProvider(false);
    }
  }

  async function handleAddNumber(event) {
    event.preventDefault();
    if (!selectedId) {
      return;
    }
    const dial = normalizeLeadDialCode(numberDialCode, providerDialCode);
    const national = trimMobileNumberForDialCode(newNumber, dial);
    if (!national) {
      setNumberFieldError("Enter a number.");
      return;
    }
    const validationError = validateMobileForDialCode(dial, national);
    if (validationError) {
      setNumberFieldError(validationError);
      return;
    }
    setAddingNumber(true);
    setNumberFieldError("");
    try {
      await createProviderNumber(selectedId, {
        dialCode: dial,
        nationalNumber: national,
        number: composePhoneNumber(dial, national),
      });
      setNewNumber("");
      setToast({ tone: "success", message: "Number added." });
      await loadProviders(providerSearch, selectedId);
      await loadNumbers(selectedId, numberSearch);
    } catch (addError) {
      setNumberFieldError(addError instanceof Error ? addError.message : "Could not add number.");
    } finally {
      setAddingNumber(false);
    }
  }

  async function handleDeleteNumber(numberId) {
    if (!selectedId) {
      return;
    }
    try {
      await deleteProviderNumber(selectedId, numberId);
      setToast({ tone: "success", message: "Number removed." });
      await loadProviders(providerSearch, selectedId);
      await loadNumbers(selectedId, numberSearch);
    } catch (deleteError) {
      setToast({
        tone: "error",
        message: deleteError instanceof Error ? deleteError.message : "Could not remove number.",
      });
    }
  }

  async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedId) {
      return;
    }
    setImportError("");
    setImportPreview(null);
    setImportOpen(true);
    setImporting(true);
    try {
      const text = await file.text();
      const numbersList = parseCsvNumbers(text);
      if (!numbersList.length) {
        setImportError("CSV has no numbers. Use one number per line (optional header: number).");
        return;
      }
      const preview = await previewProviderNumberImport(selectedId, numbersList);
      setImportPreview({ ...preview, sourceNumbers: numbersList });
    } catch (previewError) {
      setImportError(
        previewError instanceof Error ? previewError.message : "Could not preview CSV import.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!selectedId || !importPreview) {
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const skip = (importPreview.conflicts || []).map((entry) => entry.number);
      const result = await confirmProviderNumberImport(
        selectedId,
        importPreview.sourceNumbers || [],
        skip,
      );
      setImportOpen(false);
      setImportPreview(null);
      setToast({
        tone: "success",
        message: `Imported ${result.importedCount || 0} number${result.importedCount === 1 ? "" : "s"}.`,
      });
      await loadProviders(providerSearch, selectedId);
      await loadNumbers(selectedId, numberSearch);
    } catch (confirmError) {
      setImportError(
        confirmError instanceof Error ? confirmError.message : "Could not import numbers.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="admin-users-page nm-inventory-page">
      {toast ? (
        <AdminPageToast
          message={toast.message}
          onDismiss={() => setToast(null)}
          tone={toast.tone}
        />
      ) : null}

      <header className="page-header nm-inventory-page__header">
        <div className="page-header__copy">
          <h1>Number inventory</h1>
          <p className="admin-users-page__subtitle">
            Manage telecom providers and unassigned numbers. Use CSV import for bulk upload.
          </p>
        </div>
        <button className="primary-button" onClick={openCreateProvider} type="button">
          <Plus size={16} aria-hidden="true" />
          Add provider
        </button>
      </header>

      {error ? (
        <AdminPageToast message={error} onDismiss={() => setError("")} tone="error" />
      ) : null}

      <div className="nm-inventory-layout">
        <section aria-busy={loading} className="admin-users-panel nm-inventory-providers">
          <header className="admin-users-panel__section-header">
            <div>
              <h2>Providers</h2>
              <p>
                {loading
                  ? "Loading…"
                  : providers.length === 1
                    ? "1 provider"
                    : `${providers.length} providers`}
              </p>
            </div>
          </header>
          <div className="admin-users-panel__toolbar nm-inventory-providers__toolbar">
            <label className="admin-users-panel__search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search providers"
                onChange={(event) => setProviderSearch(event.target.value)}
                placeholder="Search providers…"
                type="search"
                value={providerSearch}
              />
            </label>
          </div>
          <div className="admin-users-panel__body nm-inventory-providers__body">
            {loading ? (
              <p className="admin-users-panel__loading">Loading providers…</p>
            ) : providers.length === 0 ? (
              <div className="nm-inventory-empty">
                <Inbox size={24} aria-hidden="true" />
                <strong>
                  {providerSearch.trim() ? "No matching providers" : "No providers yet"}
                </strong>
                <p>
                  {providerSearch.trim()
                    ? "Try a different search."
                    : "Add a provider to start stocking unassigned numbers."}
                </p>
                {!providerSearch.trim() ? (
                  <button className="primary-button" onClick={openCreateProvider} type="button">
                    <Plus size={16} aria-hidden="true" />
                    Add provider
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="nm-inventory-provider-list">
                {providers.map((provider) => {
                  const active = provider.id === selectedId;
                  return (
                    <li key={provider.id}>
                      <button
                        className={`nm-inventory-provider-card${active ? " is-active" : ""}`}
                        onClick={() => setSelectedId(provider.id)}
                        type="button"
                      >
                        <span className="nm-inventory-provider-card__avatar" aria-hidden="true">
                          {provider.imageData ? (
                            <img alt="" src={provider.imageData} />
                          ) : (
                            <Building2 size={18} />
                          )}
                        </span>
                        <span className="nm-inventory-provider-card__copy">
                          <strong title={provider.name}>{provider.name}</strong>
                          <span>{provider.country || "—"}</span>
                          <span>
                            {provider.numberCount === 1
                              ? "1 unassigned number"
                              : `${provider.numberCount || 0} unassigned numbers`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="admin-users-panel nm-inventory-numbers">
          <header className="admin-users-panel__section-header">
            <div>
              <h2>{selectedProvider ? selectedProvider.name : "Numbers"}</h2>
              <p>
                {!selectedProvider
                  ? "Select a provider"
                  : numbersLoading
                    ? "Loading…"
                    : [
                        selectedProvider.country || null,
                        numbers.length === 1
                          ? "1 unassigned number"
                          : `${numbers.length} unassigned numbers`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
              </p>
            </div>
            {selectedProvider ? (
              <div className="nm-inventory-numbers__actions">
                <button
                  className="secondary-button"
                  onClick={() => openEditProvider(selectedProvider)}
                  type="button"
                >
                  Edit provider
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setDeleteProviderTarget(selectedProvider)}
                  type="button"
                >
                  Delete
                </button>
                <button
                  className="secondary-button"
                  onClick={() => csvInputRef.current?.click()}
                  type="button"
                >
                  <Upload size={16} aria-hidden="true" />
                  Bulk CSV
                </button>
                <input
                  accept=".csv,text/csv,text/plain"
                  hidden
                  onChange={(event) => void handleCsvFile(event)}
                  ref={csvInputRef}
                  type="file"
                />
              </div>
            ) : null}
          </header>

          {selectedProvider ? (
            <>
              {/* Meta: storage / account ID removed from display
              <div className="nm-inventory-meta">
                <span>Country: {selectedProvider.country || "—"}</span>
                <span>Storage: {selectedProvider.storage || "—"}</span>
                <span>Account ID: {selectedProvider.accountId || "—"}</span>
              </div>
              */}

              <form className="nm-inventory-add-number" onSubmit={handleAddNumber}>
                <label
                  className={`admin-users-field admin-users-field--mobile${
                    numberFieldError ? " is-invalid" : ""
                  }`}
                >
                  <span>
                    Add number
                    <RequiredMark />
                  </span>
                  <div className="mobile-field">
                    <AdminFieldSelect
                      aria-label="Number country code"
                      className="admin-field-select--mobile-code"
                      menuMinWidth={160}
                      onChange={(value) => {
                        const nextDial = normalizeLeadDialCode(value, providerDialCode);
                        setNumberDialCode(nextDial);
                        setNewNumber((current) =>
                          trimMobileNumberForDialCode(current, nextDial),
                        );
                        setNumberFieldError("");
                      }}
                      options={MOBILE_COUNTRY_CODES.map((entry) => ({
                        value: entry,
                        label: `${MOBILE_VALIDATION_RULES[entry].flag} ${entry}`,
                      }))}
                      value={activeDialCode}
                    />
                    <input
                      aria-invalid={numberFieldError ? "true" : undefined}
                      inputMode="numeric"
                      maxLength={activeDialRule.digits}
                      onChange={(event) => {
                        event.currentTarget.setCustomValidity("");
                        setNewNumber(
                          trimMobileNumberForDialCode(event.target.value, activeDialCode),
                        );
                        setNumberFieldError("");
                      }}
                      onInvalid={(event) => {
                        event.currentTarget.setCustomValidity(
                          mobileValidationMessage(activeDialCode),
                        );
                      }}
                      pattern={mobileInputPattern(activeDialCode)}
                      placeholder={`${activeDialRule.digits} digits`}
                      required
                      type="tel"
                      value={newNumber}
                    />
                  </div>
                  {numberFieldError ? (
                    <span className="admin-users-field__error">{numberFieldError}</span>
                  ) : (
                    <span className="admin-users-field__hint">
                      Defaults to {selectedProvider.country || "provider"} ({providerDialCode}) —
                      exactly {activeDialRule.digits} digits
                    </span>
                  )}
                </label>
                <div className="nm-inventory-add-number__action">
                  <span className="nm-inventory-add-number__action-spacer" aria-hidden="true">
                    Add
                  </span>
                  <button className="primary-button" disabled={addingNumber} type="submit">
                    {addingNumber ? "Adding…" : "Add"}
                  </button>
                </div>
              </form>

              <div className="admin-users-panel__toolbar nm-inventory-numbers__toolbar">
                <label className="admin-users-panel__search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="Search numbers"
                    onChange={(event) => setNumberSearch(event.target.value)}
                    placeholder="Search numbers…"
                    type="search"
                    value={numberSearch}
                  />
                </label>
              </div>

              <div className="admin-users-panel__body nm-inventory-numbers__body">
                {numbersLoading ? (
                  <p className="admin-users-panel__loading">Loading numbers…</p>
                ) : numbers.length === 0 ? (
                  <div className="nm-inventory-empty">
                    <Inbox size={24} aria-hidden="true" />
                    <strong>{numberSearch.trim() ? "No matches" : "No unassigned numbers"}</strong>
                    <p>
                      {numberSearch.trim()
                        ? "Try a different search."
                        : "Add a number or import a CSV (one number per line)."}
                    </p>
                  </div>
                ) : (
                  <div className="admin-users-panel__table-wrap">
                    <table className="admin-users-table">
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {numbers.map((entry) => (
                          <tr key={entry.id}>
                            <td title={entry.number}>{entry.number}</td>
                            <td className="nm-inventory-numbers__row-actions">
                              <button
                                aria-label={`Remove ${entry.number}`}
                                className="admin-users-panel__icon-button nm-inventory-numbers__remove"
                                onClick={() => void handleDeleteNumber(entry.id)}
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="admin-users-panel__body nm-inventory-numbers__body">
              <div className="nm-inventory-empty">
                <Building2 size={24} aria-hidden="true" />
                <strong>Select a provider</strong>
                <p>Choose a provider on the left to manage its unassigned numbers.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {providerFormOpen ? (
        <div
          aria-label={editingProviderId ? "Edit provider" : "Add provider"}
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Close form"
            className="admin-side-overlay__backdrop"
            disabled={savingProvider}
            onClick={closeProviderForm}
            type="button"
          />
          <section className="admin-side-overlay__panel">
            <header className="admin-side-overlay__header">
              <div>
                <h2>{editingProviderId ? "Edit provider" : "Add provider"}</h2>
                <p>Name, image, and country for this telecom provider.</p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={savingProvider}
                onClick={closeProviderForm}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <form
              className="admin-users-form admin-side-overlay__form"
              onSubmit={handleSaveProvider}
            >
              <div className="admin-side-overlay__body">
                {providerFormError ? (
                  <p className="admin-side-overlay__alert" role="alert">
                    {providerFormError}
                  </p>
                ) : null}
                <label
                  className={`admin-users-field${providerFieldErrors.name ? " is-invalid" : ""}`}
                >
                  <span>
                    Provider name
                    <RequiredMark />
                  </span>
                  <input
                    onChange={(event) => {
                      setProviderForm((current) => ({ ...current, name: event.target.value }));
                      setProviderFieldErrors((current) => {
                        const next = { ...current };
                        delete next.name;
                        return next;
                      });
                    }}
                    placeholder="e.g. Twilio"
                    value={providerForm.name}
                  />
                  {providerFieldErrors.name ? (
                    <span className="admin-users-field__error">{providerFieldErrors.name}</span>
                  ) : null}
                </label>

                <div
                  className={`admin-users-field${providerFieldErrors.imageData ? " is-invalid" : ""}`}
                >
                  <span>Logo</span>
                  <div className="nm-inventory-image-field">
                    <button
                      aria-label={
                        providerForm.imageData ? "Change provider logo" : "Upload provider logo"
                      }
                      className={`nm-inventory-image-field__preview${
                        providerForm.imageData ? " has-image" : ""
                      }`}
                      onClick={() => imageInputRef.current?.click()}
                      type="button"
                    >
                      {providerForm.imageData ? (
                        <img alt="" src={providerForm.imageData} />
                      ) : (
                        <>
                          <Upload size={22} aria-hidden="true" />
                          <span className="nm-inventory-image-field__preview-label">
                            Upload logo
                          </span>
                          <span className="nm-inventory-image-field__preview-hint">
                            PNG, JPEG, GIF, or WebP · under 500KB
                          </span>
                        </>
                      )}
                    </button>
                    {providerForm.imageData ? (
                      <div className="nm-inventory-image-field__actions">
                        <button
                          className="secondary-button"
                          onClick={() => imageInputRef.current?.click()}
                          type="button"
                        >
                          Replace
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() =>
                            setProviderForm((current) => ({ ...current, imageData: "" }))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                    <input
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      hidden
                      onChange={(event) => void handleImagePick(event)}
                      ref={imageInputRef}
                      type="file"
                    />
                  </div>
                  {providerFieldErrors.imageData ? (
                    <span className="admin-users-field__error">{providerFieldErrors.imageData}</span>
                  ) : null}
                </div>

                <label
                  className={`admin-users-field${providerFieldErrors.country ? " is-invalid" : ""}`}
                >
                  <span>
                    Country
                    <RequiredMark />
                  </span>
                  <AdminFieldSelect
                    aria-label="Country"
                    onChange={(value) => {
                      setProviderForm((current) => ({ ...current, country: value }));
                      setProviderFieldErrors((current) => {
                        const next = { ...current };
                        delete next.country;
                        return next;
                      });
                    }}
                    options={COUNTRY_OPTIONS}
                    value={providerForm.country || ""}
                  />
                  {providerFieldErrors.country ? (
                    <span className="admin-users-field__error">{providerFieldErrors.country}</span>
                  ) : null}
                </label>

                {/* Storage / Account ID — commented out (DB columns remain; API optional empty)
                <label className="admin-users-field">
                  <span>Storage</span>
                  <input
                    onChange={(event) =>
                      setProviderForm((current) => ({ ...current, storage: event.target.value }))
                    }
                    placeholder="Storage / region reference"
                    value={providerForm.storage}
                  />
                </label>

                <label className="admin-users-field">
                  <span>Account ID</span>
                  <input
                    onChange={(event) =>
                      setProviderForm((current) => ({ ...current, accountId: event.target.value }))
                    }
                    placeholder="Provider account ID"
                    value={providerForm.accountId}
                  />
                </label>
                */}
              </div>

              <div className="admin-side-overlay__footer">
                <button
                  className="secondary-button"
                  disabled={savingProvider}
                  onClick={closeProviderForm}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={savingProvider} type="submit">
                  {savingProvider
                    ? "Saving…"
                    : editingProviderId
                      ? "Save changes"
                      : "Create provider"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {importOpen ? (
        <div
          aria-label="Resolve CSV import"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={importing ? undefined : () => setImportOpen(false)}
          />
          <section className="admin-users-modal__card">
            <header className="nm-available-modal__header">
              <div>
                <h2>Resolve CSV import</h2>
                <p>
                  Numbers already in inventory or mapped to a tenant will be skipped. Confirm to
                  import the rest.
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={importing}
                onClick={() => setImportOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="nm-inventory-import-body">
              {importError ? (
                <p className="admin-side-overlay__alert" role="alert">
                  {importError}
                </p>
              ) : null}
              {importing && !importPreview ? (
                <p className="admin-users-panel__loading">Analyzing CSV…</p>
              ) : importPreview ? (
                <>
                  <p className="nm-inventory-import-summary">
                    Ready to import: <strong>{importPreview.readyCount || 0}</strong>
                    {" · "}
                    Conflicts (skip): <strong>{importPreview.conflictCount || 0}</strong>
                    {" · "}
                    Invalid: <strong>{importPreview.invalidCount || 0}</strong>
                  </p>
                  {(importPreview.conflicts || []).length > 0 ? (
                    <div className="nm-inventory-import-conflicts">
                      <h3>Will be skipped</h3>
                      <ul>
                        {(importPreview.conflicts || []).map((entry) => (
                          <li key={`${entry.number}-${entry.reason}`}>
                            <strong>{entry.number}</strong>
                            <span>{entry.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(importPreview.invalid || []).length > 0 ? (
                    <div className="nm-inventory-import-conflicts">
                      <h3>Invalid rows</h3>
                      <ul>
                        {(importPreview.invalid || []).map((value) => (
                          <li key={value}>
                            <strong>{value}</strong>
                            <span>Not a valid phone number.</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="admin-side-overlay__footer">
              <button
                className="secondary-button"
                disabled={importing}
                onClick={() => setImportOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={importing || !importPreview || !(importPreview.readyCount > 0)}
                onClick={() => void handleConfirmImport()}
                type="button"
              >
                {importing
                  ? "Importing…"
                  : importPreview?.readyCount
                    ? `Import ${importPreview.readyCount}`
                    : "Nothing to import"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteProviderTarget ? (
        <div
          aria-label="Delete provider"
          aria-modal="true"
          className="admin-users-modal"
          role="dialog"
        >
          <div
            className="admin-users-modal__backdrop"
            onClick={deletingProvider ? undefined : () => setDeleteProviderTarget(null)}
          />
          <section className="admin-users-modal__card">
            <h2>Delete provider?</h2>
            <p>
              This removes <strong>{deleteProviderTarget.name}</strong> and all of its unassigned
              inventory numbers. Mapped numbers are not affected.
            </p>
            <div className="admin-side-overlay__footer">
              <button
                className="secondary-button"
                disabled={deletingProvider}
                onClick={() => setDeleteProviderTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button nm-inventory-delete-confirm"
                disabled={deletingProvider}
                onClick={() => void handleDeleteProvider()}
                type="button"
              >
                {deletingProvider ? "Deleting…" : "Delete provider"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
