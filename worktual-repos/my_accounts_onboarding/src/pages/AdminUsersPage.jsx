import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Clock,
  Download,
  FileUp,
  Filter,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";

import {
  createManagedUser,
  deleteManagedUser,
  fetchManagedUsers,
  formatUserPhone,
  formatUserUpdatedAt,
  getRoleLabel,
  importBulkUserUpload,
  previewBulkUserUpload,
  updateManagedUser,
} from "../lib/users.js";
import {
  applyCountryDefaultsToLeadForm,
  MOBILE_VALIDATION_RULES,
  trimMobileNumberForDialCode,
} from "../lib/countryDefaults.js";
import { COUNTRY_OPTIONS } from "../lib/leads.js";
import {
  BULK_USER_DEFAULT_PASSWORD,
  downloadInvalidUserBulkRecords,
  downloadUserBulkTemplate,
} from "../lib/userBulkUpload.js";
import { PasswordStrengthBar } from "../components/PasswordStrengthBar.jsx";
import { validatePasswordPolicy } from "../lib/passwordPolicy.js";
import "../styles/admin-users-light.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const AVATAR_TONES = ["purple", "teal", "amber", "rose", "blue", "indigo"];
const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);

const emptyForm = {
  email: "",
  password: "",
  role: "sales",
  displayName: "",
  country: "India",
  mobileCountryCode: "+91",
  mobileNumber: "",
  isActive: true,
};

function getAvatarTone(id = "") {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = id.charCodeAt(index) + ((hash << 5) - hash);
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function userInitials(name = "", email = "") {
  const source = String(name || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatSummaryDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function downloadUsersCsv(users) {
  const headers = [
    "Name",
    "Email",
    "Role",
    "Country",
    "Phone",
    "Status",
    "Last Updated",
    "Updated By",
  ];
  const rows = users.map((user) => [
    user.displayName || "",
    user.email,
    getRoleLabel(user.role),
    user.country || "",
    formatUserPhone(user),
    user.isActive === false ? "Inactive" : "Active",
    formatUserUpdatedAt(user.updatedAt),
    user.updatedBy || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktual-user-credentials.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function Field({ label, onChange, required = false, type = "text", value }) {
  return (
    <label className="admin-users-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input onChange={(event) => onChange(event.target.value)} type={type} value={value ?? ""} />
    </label>
  );
}

function UserMobileNumberField({
  countryCode,
  label,
  onCountryCodeChange,
  onNumberChange,
  required = false,
  value,
}) {
  const rule = MOBILE_VALIDATION_RULES[countryCode] || MOBILE_VALIDATION_RULES["+91"];
  const validationMessage = `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;

  return (
    <label className="admin-users-field admin-users-field--mobile">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <div className="mobile-field">
        <span className="mobile-field__country">
          <span className="mobile-field__flag" aria-hidden="true">
            {rule.flag}
          </span>
          <span className="mobile-field__code">{countryCode}</span>
          <span className="mobile-field__chevron" aria-hidden="true">
            ▾
          </span>
          <select
            aria-label={`${label} country code`}
            onChange={(event) => onCountryCodeChange(event.target.value)}
            value={countryCode}
          >
            {MOBILE_COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {MOBILE_VALIDATION_RULES[code].flag} {code}
              </option>
            ))}
          </select>
        </span>
        <input
          inputMode="numeric"
          maxLength={rule.digits}
          minLength={required ? rule.digits : undefined}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            onNumberChange(trimMobileNumberForDialCode(event.target.value, countryCode));
          }}
          onInvalid={(event) => {
            event.currentTarget.setCustomValidity(validationMessage);
          }}
          pattern={required ? `\\d{${rule.digits}}` : undefined}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={value}
        />
      </div>
    </label>
  );
}

function UserForm({ form, isCreate, onChange, onSubmit, submitLabel }) {
  function handleCountryChange(country) {
    onChange(
      applyCountryDefaultsToLeadForm(
        {
          ...form,
          country,
        },
        country,
      ),
    );
  }

  function handleMobileCountryCodeChange(mobileCountryCode) {
    onChange({
      mobileCountryCode,
      mobileNumber: trimMobileNumberForDialCode(form.mobileNumber, mobileCountryCode),
    });
  }

  return (
    <form
      className="admin-users-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="admin-users-form__grid">
        <Field
          label="Work email"
          onChange={(value) => onChange({ email: value })}
          required
          type="email"
          value={form.email}
        />
        <label className="admin-users-field">
          <span>
            {isCreate ? "Password" : "New password"}
            {isCreate ? " *" : ""}
          </span>
          <input
            onChange={(event) => onChange({ password: event.target.value })}
            required={isCreate}
            type="password"
            value={form.password}
          />
          {isCreate || form.password ? <PasswordStrengthBar password={form.password} /> : null}
        </label>
        <label className="admin-users-field">
          <span>Role *</span>
          <select onChange={(event) => onChange({ role: event.target.value })} value={form.role}>
            <option value="sales">Sales</option>
            <option value="finance">Finance</option>
            <option value="sales_admin">Sales Admin</option>
          </select>
        </label>
        <Field
          label="Display name"
          onChange={(value) => onChange({ displayName: value })}
          value={form.displayName}
        />
        <label className="admin-users-field">
          <span>Country</span>
          <select
            onChange={(event) => handleCountryChange(event.target.value)}
            value={form.country || ""}
          >
            <option value="">Select country</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <UserMobileNumberField
          countryCode={form.mobileCountryCode || "+91"}
          label="Mobile number"
          onCountryCodeChange={handleMobileCountryCodeChange}
          onNumberChange={(value) => onChange({ mobileNumber: value })}
          value={form.mobileNumber || ""}
        />
        {!isCreate ? (
          <label className="admin-users-field admin-users-field--checkbox">
            <input
              checked={form.isActive}
              onChange={(event) => onChange({ isActive: event.target.checked })}
              type="checkbox"
            />
            <span>Account active</span>
          </label>
        ) : null}
      </div>
      {!isCreate ? (
        <p className="admin-users-form__hint">Leave password blank to keep the current password.</p>
      ) : null}
      <button className="primary-button" type="submit">
        <Save size={18} />
        {submitLabel}
      </button>
    </form>
  );
}

function BulkRecordsPreviewTable({ rows, variant = "invalid" }) {
  if (!rows.length) {
    return null;
  }

  return (
    <div className="admin-users-bulk__preview-table-wrap">
      <table className="admin-users-bulk__preview-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Work email</th>
            <th>Role</th>
            <th>Display name</th>
            <th>Country</th>
            <th>Mobile</th>
            {variant === "invalid" ? <th>Reason</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${variant}-${row.rowNumber}-${row.email || "row"}`}>
              <td>{row.rowNumber}</td>
              <td>{row.email || "—"}</td>
              <td>{row.role || "—"}</td>
              <td>{row.displayName || "—"}</td>
              <td>{row.country || "—"}</td>
              <td>
                {row.mobileCountryCode || row.mobileNumber
                  ? `${row.mobileCountryCode || ""} ${row.mobileNumber || ""}`.trim()
                  : "—"}
              </td>
              {variant === "invalid" ? (
                <td>{Array.isArray(row.errors) ? row.errors.join("; ") : row.message || "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkUserUploadPanel({
  error,
  fileErrors,
  fileName,
  importing,
  invalidRows,
  onBack,
  onClear,
  onFileSelected,
  onImport,
  previewError,
  previewLoading,
  result,
  totalRows = 0,
  validRows,
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const rejectedRows = invalidRows;

  const uploadedCount = totalRows || validRows.length + rejectedRows.length;
  const summaryMessage = useMemo(() => {
    if (!uploadedCount) {
      return "";
    }

    if (validRows.length && !rejectedRows.length) {
      return uploadedCount === 1
        ? "1 record uploaded — validated and ready to import."
        : `${uploadedCount} records uploaded — all ${validRows.length} are ready to import.`;
    }

    if (!validRows.length && rejectedRows.length) {
      return uploadedCount === 1
        ? "1 record uploaded — rejected. Review the error below."
        : `${uploadedCount} records uploaded — all ${rejectedRows.length} were rejected.`;
    }

    return `${uploadedCount} records uploaded — ${validRows.length} ready to import, ${rejectedRows.length} rejected.`;
  }, [rejectedRows.length, uploadedCount, validRows.length]);

  const previewReady = Boolean(fileName && !previewLoading && !previewError);

  function handleInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  }

  return (
    <div className="admin-users-bulk">
      <button className="admin-users-bulk__back" onClick={onBack} type="button">
        <ArrowLeft size={16} />
        Back to single user
      </button>

      <div className="admin-users-bulk__actions">
        <button className="secondary-button" onClick={downloadUserBulkTemplate} type="button">
          <Download size={16} />
          Download format
        </button>
      </div>

      <p className="admin-users-bulk__hint">
        Download the CSV template and fill in user details. Password is not required — imported users
        receive the default password <strong>{BULK_USER_DEFAULT_PASSWORD}</strong>. Use{" "}
        <strong>+91</strong> format for mobile country code. Save as <strong>CSV UTF-8</strong> from
        Excel. Required columns: Work email, Role, Display name, Country, and Mobile number.
      </p>

      <div
        className={`admin-users-bulk__dropzone ${dragActive ? "is-dragging" : ""} ${
          fileName ? "has-file" : ""
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDrop={handleDrop}
      >
        <FileUp size={28} />
        <strong>Drag and drop CSV here</strong>
        <span>or choose a file from your computer</span>
        {fileName ? <p className="admin-users-bulk__filename">{fileName}</p> : null}
        <button
          className="secondary-button"
          disabled={importing || previewLoading}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload size={16} />
          Upload CSV
        </button>
        <input
          accept=".csv,text/csv"
          className="sr-only"
          onChange={handleInputChange}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {previewLoading ? <p className="admin-users-bulk__loading">Validating uploaded CSV...</p> : null}

      {previewReady && !fileErrors.length && summaryMessage ? (
        <p
          className={`admin-users-bulk__summary admin-users-bulk__summary--${
            rejectedRows.length && !validRows.length
              ? "invalid"
              : rejectedRows.length
                ? "mixed"
                : "valid"
          }`}
        >
          {summaryMessage}
        </p>
      ) : null}

      {fileErrors.length ? (
        <div className="admin-users-bulk__errors" role="alert">
          {fileErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      {previewError ? <p className="form-error">{previewError}</p> : null}

      {previewReady && validRows.length ? (
        <section className="admin-users-bulk__preview" aria-label="Valid records preview">
          <div className="admin-users-bulk__preview-header">
            <h3>Ready to import</h3>
            <span>{validRows.length} record{validRows.length === 1 ? "" : "s"}</span>
          </div>
          <BulkRecordsPreviewTable rows={validRows} variant="valid" />
        </section>
      ) : null}

      {previewReady && rejectedRows.length ? (
        <section className="admin-users-bulk__preview" aria-label="Invalid records preview">
          <div className="admin-users-bulk__preview-header">
            <h3>Rejected records</h3>
            <button
              className="secondary-button"
              onClick={() => downloadInvalidUserBulkRecords(rejectedRows)}
              type="button"
            >
              <Download size={16} />
              Download invalid records
            </button>
          </div>
          <BulkRecordsPreviewTable rows={rejectedRows} variant="invalid" />
        </section>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {result?.created?.length ? (
        <div className="admin-users-bulk__result">
          <p>
            Created {result.created.length} user{result.created.length === 1 ? "" : "s"} with the
            default password.
          </p>
        </div>
      ) : null}

      <div className="admin-users-bulk__footer">
        {fileName ? (
          <button
            className="secondary-button"
            disabled={importing || previewLoading}
            onClick={onClear}
            type="button"
          >
            Clear file
          </button>
        ) : null}
        <button
          className="primary-button"
          disabled={importing || previewLoading || !validRows.length || fileErrors.length > 0}
          onClick={onImport}
          type="button"
        >
          <Upload size={18} />
          {importing
            ? "Importing users..."
            : `Import ${validRows.length} valid user${validRows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function UsersFilterDropdown({
  containerRef,
  onClose,
  onReset,
  onRoleChange,
  onStatusChange,
  roleFilter,
  statusFilter,
}) {
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
    <div className="admin-users-filter-dropdown" role="dialog" aria-label="Filter users">
      <div className="admin-users-filter-dropdown__section">
        <p className="admin-users-filter-dropdown__title">Filter by</p>
        <label className="admin-users-filter-dropdown__field">
          <span>Role</span>
          <select onChange={(event) => onRoleChange(event.target.value)} value={roleFilter}>
            <option value="all">All roles</option>
            <option value="sales">Sales Executive</option>
            <option value="finance">Finance</option>
            <option value="sales_admin">Sales Admin</option>
          </select>
        </label>
        <label className="admin-users-filter-dropdown__field">
          <span>Status</span>
          <select onChange={(event) => onStatusChange(event.target.value)} value={statusFilter}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button className="secondary-button" onClick={onReset} type="button">
          Reset
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Apply
        </button>
      </div>
    </div>
  );
}

export function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mode, setMode] = useState("list");
  const [createPanelMode, setCreatePanelMode] = useState("single");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkFileErrors, setBulkFileErrors] = useState([]);
  const [bulkValidRows, setBulkValidRows] = useState([]);
  const [bulkInvalidRows, setBulkInvalidRows] = useState([]);
  const [bulkTotalRows, setBulkTotalRows] = useState(0);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkPreviewError, setBulkPreviewError] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortDirection, setSortDirection] = useState("desc");
  const filterAnchorRef = useRef(null);

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchManagedUsers();
      setUsers(data.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, roleFilter, statusFilter, pageSize, sortDirection]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [selectedUserId, users],
  );

  const stats = useMemo(() => {
    const activeCount = users.filter((user) => user.isActive !== false).length;
    const inactiveCount = users.length - activeCount;
    const latestUpdatedAt = users.reduce((latest, user) => {
      if (!user.updatedAt) {
        return latest;
      }

      const timestamp = new Date(user.updatedAt).getTime();
      return timestamp > latest ? timestamp : latest;
    }, 0);

    return {
      total: users.length,
      active: activeCount,
      inactive: inactiveCount,
      latestUpdatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : null,
    };
  }, [users]);

  const hasActiveFilters = roleFilter !== "all" || statusFilter !== "all";

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return users
      .filter((user) => {
        const haystack = [
          user.displayName,
          user.email,
          getRoleLabel(user.role),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesSearch = !query || haystack.includes(query);
        const matchesRole = roleFilter === "all" || user.role === roleFilter;
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" ? user.isActive !== false : user.isActive === false);

        return matchesSearch && matchesRole && matchesStatus;
      })
      .sort((left, right) => {
        const leftValue = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        const rightValue = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
        return (leftValue - rightValue) * multiplier;
      });
  }, [roleFilter, searchQuery, sortDirection, statusFilter, users]);

  useEffect(() => {
    if (!loading && filteredUsers.length === 0 && showFilters) {
      setShowFilters(false);
    }
  }, [filteredUsers.length, loading, showFilters]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredUsers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredUsers.length);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  function resetBulkUploadState() {
    setBulkCsvText("");
    setBulkFileName("");
    setBulkFileErrors([]);
    setBulkValidRows([]);
    setBulkInvalidRows([]);
    setBulkTotalRows(0);
    setBulkPreviewLoading(false);
    setBulkPreviewError("");
    setBulkImportResult(null);
  }

  function openCreate() {
    setMode("create");
    setCreatePanelMode("single");
    setBulkImporting(false);
    resetBulkUploadState();
    setSelectedUserId(null);
    setCreateForm(emptyForm);
    setSuccess("");
    setError("");
  }

  function closeModal() {
    setMode("list");
    setCreatePanelMode("single");
    setBulkImporting(false);
    resetBulkUploadState();
    setSelectedUserId(null);
    setShowDeleteConfirm(false);
    setDeleting(false);
  }

  function openEdit(user) {
    setMode("edit");
    setShowDeleteConfirm(false);
    setDeleting(false);
    setSelectedUserId(user.id);
    setEditForm({
      email: user.email,
      password: "",
      role: user.role,
      displayName: user.displayName || "",
      country: user.country || "",
      mobileCountryCode: user.mobileCountryCode || "+91",
      mobileNumber: user.mobileNumber || "",
      isActive: user.isActive !== false,
    });
    setSuccess("");
    setError("");
  }

  function resetFilters() {
    setRoleFilter("all");
    setStatusFilter("all");
  }

  async function handleBulkFileSelected(file) {
    setError("");
    setSuccess("");
    setBulkPreviewError("");
    setBulkImportResult(null);
    setBulkFileName(file.name);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setBulkCsvText("");
      setBulkFileErrors(["Please upload a .csv file saved as CSV UTF-8."]);
      setBulkValidRows([]);
      setBulkInvalidRows([]);
      setBulkTotalRows(0);
      return;
    }

    const text = await file.text();
    setBulkCsvText(text);
    setBulkPreviewLoading(true);
    setBulkFileErrors([]);
    setBulkValidRows([]);
    setBulkInvalidRows([]);
    setBulkTotalRows(0);

    try {
      const preview = await previewBulkUserUpload(text);
      setBulkFileErrors(preview.fileErrors || []);
      setBulkValidRows(preview.validRows || []);
      setBulkInvalidRows(preview.invalidRows || []);
      setBulkTotalRows(preview.totalRows || 0);
    } catch (previewFailure) {
      setBulkPreviewError(
        previewFailure instanceof Error ? previewFailure.message : "Could not validate CSV.",
      );
      setBulkValidRows([]);
      setBulkInvalidRows([]);
      setBulkTotalRows(0);
    } finally {
      setBulkPreviewLoading(false);
    }
  }

  async function handleBulkImport() {
    if (!bulkCsvText.trim()) {
      setError("Upload a CSV file before importing.");
      return;
    }

    setError("");
    setSuccess("");
    setBulkImportResult(null);
    setBulkImporting(true);

    try {
      const result = await importBulkUserUpload(bulkCsvText);
      const mergedInvalidRows = [
        ...(result.invalidRows || []),
        ...(result.importInvalidRows || []),
      ];

      setBulkFileErrors(result.fileErrors || []);
      setBulkValidRows(result.created || []);
      setBulkInvalidRows(mergedInvalidRows);
      setBulkTotalRows(result.totalRows || mergedInvalidRows.length + (result.created?.length || 0));
      setBulkImportResult(
        result.created?.length
          ? {
              created: result.created,
            }
          : null,
      );
      await loadUsers();

      const createdCount = result.created?.length || 0;
      const rejectedCount = mergedInvalidRows.length;

      if (createdCount && !rejectedCount) {
        setSuccess(`Created ${createdCount} user${createdCount === 1 ? "" : "s"} from CSV.`);
        closeModal();
        return;
      }

      if (createdCount) {
        setSuccess(`Created ${createdCount} user${createdCount === 1 ? "" : "s"} from CSV.`);
      }

      if (!createdCount) {
        setError(
          rejectedCount
            ? "No users were imported. Review the rejected records below."
            : "No users were imported.",
        );
      }
    } catch (importFailure) {
      setError(importFailure instanceof Error ? importFailure.message : "Could not import users.");
    } finally {
      setBulkImporting(false);
    }
  }

  function toggleSortDirection() {
    setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
  }

  async function handleCreate() {
    setError("");
    setSuccess("");

    try {
      validatePasswordPolicy(createForm.password);
      await createManagedUser(createForm);
      setSuccess("User credentials created.");
      closeModal();
      setCreateForm(emptyForm);
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create user.");
    }
  }

  async function handleUpdate() {
    if (!selectedUserId) {
      return;
    }

    setError("");
    setSuccess("");

    const payload = {
      email: editForm.email,
      role: editForm.role,
      displayName: editForm.displayName,
      country: editForm.country,
      mobileCountryCode: editForm.mobileCountryCode,
      mobileNumber: editForm.mobileNumber,
      isActive: editForm.isActive,
    };

    if (editForm.password.trim()) {
      try {
        validatePasswordPolicy(editForm.password);
      } catch (passwordError) {
        setError(passwordError instanceof Error ? passwordError.message : "Invalid password.");
        return;
      }
      payload.password = editForm.password;
    }

    try {
      await updateManagedUser(selectedUserId, payload);
      setSuccess("User credentials updated.");
      closeModal();
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not update user.");
    }
  }

  async function handleDelete() {
    if (!selectedUserId) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      await deleteManagedUser(selectedUserId);
      setSuccess("User credentials deleted.");
      closeModal();
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete user.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="admin-users-page">
      <header className="admin-users-page__header">
        <div>
          <p className="admin-users-page__eyebrow">Admin</p>
          <h1>User credentials</h1>
          <p className="admin-users-page__subtitle">
            Create and manage sales, finance, and sales admin login details. Users can update their
            own profile afterward.
          </p>
        </div>
        <button className="primary-button admin-users-page__create" onClick={openCreate} type="button">
          <Plus size={18} />
          Create user
        </button>
      </header>

      {error ? <p className="form-error-banner">{error}</p> : null}
      {success ? <p className="admin-users-page__success">{success}</p> : null}

      <div className="admin-users-kpi-grid">
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--total">
            <Users size={20} />
          </div>
          <div>
            <span>Total users</span>
            <strong>{stats.total}</strong>
            <small>All managed accounts</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active">
            <UserCheck size={20} />
          </div>
          <div>
            <span>Active users</span>
            <strong>{stats.active}</strong>
            <small>Currently active</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--inactive">
            <UserX size={20} />
          </div>
          <div>
            <span>Inactive users</span>
            <strong>{stats.inactive}</strong>
            <small>Currently inactive</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--updated">
            <Clock size={20} />
          </div>
          <div>
            <span>Last updated</span>
            <strong>{formatSummaryDate(stats.latestUpdatedAt)}</strong>
            <small>Most recent update</small>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All users</h2>
            <p>{filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"} in view</p>
          </div>
        </header>
        <div className="admin-users-panel__toolbar">
          <label className="admin-users-panel__search">
            <Search size={18} />
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, email, or role..."
              type="search"
              value={searchQuery}
            />
          </label>

          <div className="admin-users-panel__toolbar-actions">
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
                <UsersFilterDropdown
                  containerRef={filterAnchorRef}
                  onClose={() => setShowFilters(false)}
                  onReset={resetFilters}
                  onRoleChange={setRoleFilter}
                  onStatusChange={setStatusFilter}
                  roleFilter={roleFilter}
                  statusFilter={statusFilter}
                />
              ) : null}
            </div>

            <button
              className="admin-users-panel__tool-button"
              disabled={filteredUsers.length === 0}
              onClick={() => downloadUsersCsv(filteredUsers)}
              type="button"
            >
              <Download size={16} />
              Download
            </button>
          </div>
        </div>

        <div className="admin-users-panel__body">
        {loading ? (
          <p className="admin-users-panel__loading">Loading users...</p>
        ) : filteredUsers.length === 0 ? (
          <p className="admin-users-panel__empty">
            {users.length === 0
              ? "No users yet. Create sales or finance credentials to get started."
              : "No users match your search or filters."}
          </p>
        ) : (
          <div className="admin-users-panel__table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Country</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>
                    <button
                      className="admin-users-table__sort"
                      onClick={toggleSortDirection}
                      type="button"
                    >
                      Last updated
                      <ChevronDown
                        className={sortDirection === "asc" ? "is-asc" : ""}
                        size={14}
                      />
                    </button>
                  </th>
                  <th>Updated by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
                  <tr key={user.id} className={user.isActive === false ? "is-inactive" : ""}>
                    <td>
                      <div className="admin-users-name-cell">
                        <span
                          className={`admin-users-name-cell__avatar admin-users-name-cell__avatar--${getAvatarTone(
                            user.id,
                          )}`}
                        >
                          {userInitials(user.displayName, user.email)}
                        </span>
                        <span>{user.displayName || "—"}</span>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`admin-users-role admin-users-role--${user.role}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td>{user.country || "—"}</td>
                    <td>{formatUserPhone(user) || "—"}</td>
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
                    <td>{formatUserUpdatedAt(user.updatedAt)}</td>
                    <td>{user.updatedBy || "—"}</td>
                    <td>
                      <div className="admin-users-table__actions">
                        <button
                          className="admin-users-table__edit"
                          onClick={() => openEdit(user)}
                          type="button"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>

        {!loading && filteredUsers.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} to {pageEnd} of {filteredUsers.length} users
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
                  <ChevronDown aria-hidden="true" size={14} />
                </span>
              </label>

              <nav aria-label="Users pagination" className="admin-users-panel__pagination">
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

      {mode === "create" ? (
        <div className="admin-users-modal" role="dialog" aria-modal="true" aria-label="Create user">
          <button
            aria-label="Close create user dialog"
            className="admin-users-modal__backdrop"
            onClick={closeModal}
            type="button"
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Create credentials</h2>
                <p>Add a new sales, finance, or sales admin login.</p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                onClick={closeModal}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            {createPanelMode === "single" ? (
              <>
                <UserForm
                  form={createForm}
                  isCreate
                  onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
                  onSubmit={handleCreate}
                  submitLabel="Create user"
                />
                {error ? <p className="form-error">{error}</p> : null}
                <button
                  className="secondary-button admin-users-bulk-trigger"
                  onClick={() => {
                    setCreatePanelMode("bulk");
                    setError("");
                    resetBulkUploadState();
                  }}
                  type="button"
                >
                  <Upload size={16} />
                  Bulk upload
                </button>
              </>
            ) : (
              <BulkUserUploadPanel
                error={error}
                fileErrors={bulkFileErrors}
                fileName={bulkFileName}
                importing={bulkImporting}
                invalidRows={bulkInvalidRows}
                onBack={() => {
                  setCreatePanelMode("single");
                  setError("");
                  resetBulkUploadState();
                }}
                onClear={resetBulkUploadState}
                onFileSelected={handleBulkFileSelected}
                onImport={handleBulkImport}
                previewError={bulkPreviewError}
                previewLoading={bulkPreviewLoading}
                result={bulkImportResult}
                totalRows={bulkTotalRows}
                validRows={bulkValidRows}
              />
            )}
          </section>
        </div>
      ) : null}

      {mode === "edit" && selectedUser ? (
        <div
          className="admin-users-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${selectedUser.displayName || selectedUser.email}`}
        >
          <button
            aria-label="Close edit user dialog"
            className="admin-users-modal__backdrop"
            onClick={closeModal}
            type="button"
          />
          <section className="admin-users-modal__card">
            <header className="admin-users-modal__header">
              <div>
                <h2>Edit {selectedUser.displayName || selectedUser.email}</h2>
                <p>Update login details, role, or account status.</p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                onClick={closeModal}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <UserForm
              form={editForm}
              onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
            />
            {error ? <p className="form-error">{error}</p> : null}
            {["sales", "finance", "sales_admin"].includes(selectedUser.role) ? (
            <section className="admin-users-delete">
              <div>
                <h3>Delete credentials</h3>
                <p>
                  Permanently remove this login. The user will no longer be able to sign in and
                  active sessions will be revoked.
                </p>
              </div>
              {showDeleteConfirm ? (
                <div className="admin-users-delete__confirm">
                  <p>
                    Delete <strong>{selectedUser.email}</strong>? This action cannot be undone.
                  </p>
                  <div className="admin-users-delete__actions">
                    <button
                      className="secondary-button"
                      disabled={deleting}
                      onClick={() => setShowDeleteConfirm(false)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="danger-button"
                      disabled={deleting}
                      onClick={handleDelete}
                      type="button"
                    >
                      <Trash2 size={16} />
                      {deleting ? "Deleting..." : "Confirm delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="danger-button"
                  onClick={() => {
                    setShowDeleteConfirm(true);
                    setError("");
                  }}
                  type="button"
                >
                  <Trash2 size={16} />
                  Delete user
                </button>
              )}
            </section>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
