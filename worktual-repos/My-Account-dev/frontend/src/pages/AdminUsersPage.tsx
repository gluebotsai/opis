// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Clock,
  Download,
  FileUp,
  Filter,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
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
  forceLogoutManagedUser,
  formatUserPhone,
  formatUserUpdatedAt,
  getRoleLabel,
  importBulkUserUpload,
  previewBulkUserUpload,
  updateManagedUser,
} from "../lib/users.js";
import { reassignAllLeadsFromAgent } from "../lib/salesOversight.js";
import {
  applyCountryDefaultsToLeadForm,
  getCountryForDialCode,
  MOBILE_VALIDATION_RULES,
  mobileInputPattern,
  mobileValidationMessage,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../lib/countryDefaults.js";
import { validateEmailAddress } from "../lib/emailValidation.js";
import { COUNTRY_OPTIONS } from "../lib/leads.js";
import {
  BULK_USER_DEFAULT_PASSWORD,
  downloadInvalidUserBulkRecords,
  downloadUserBulkTemplate,
} from "../lib/userBulkUpload.js";
import {
  AdminFieldSelect,
  isAdminFieldSelectMenuTarget,
} from "../components/AdminFieldSelect.tsx";
import { PasswordStrengthBar } from "../components/PasswordStrengthBar.tsx";
import { ProfileAvatar } from "../components/ProfileAvatar.tsx";
import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { SideOverlayDraftIsland } from "../components/SideOverlayDraftIsland.tsx";
import { useSideOverlayDraftDismiss } from "../hooks/useSideOverlayDraftDismiss.js";
import {
  isUserBulkUploadDirty,
  isUserCreateFormEmpty,
  isUserEditFormDirty,
} from "../lib/sideOverlayFormDraft.js";
import { validatePasswordPolicy } from "../lib/passwordPolicy.js";
import "../styles/admin-users-light.css";

const ROLE_OPTIONS = [
  { value: "sales", label: "Sales" },
  { value: "finance", label: "Finance" },
  { value: "sales_admin", label: "Sales Admin" },
  { value: "number_management", label: "Number Management" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);
const ROW_MENU_VIEWPORT_PADDING = 8;
const ROW_MENU_GAP = 6;

function getRowMenuPosition(anchorEl, menuEl) {
  if (!anchorEl) {
    return null;
  }

  const rect = anchorEl.getBoundingClientRect();
  const menuHeight = menuEl?.offsetHeight || 200;
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
  email: "",
  password: "",
  role: "sales",
  displayName: "",
  country: "India",
  mobileCountryCode: "+91",
  mobileNumber: "",
  isActive: true,
};

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

function RequiredMark() {
  return (
    <span aria-hidden="true" className="admin-users-field__required">
      *
    </span>
  );
}

function Field({
  autoComplete,
  error = "",
  label,
  name,
  onChange,
  readOnlyUntilFocus = false,
  required = false,
  type = "text",
  value,
}) {
  return (
    <label className={`admin-users-field${error ? " is-invalid" : ""}`}>
      <span>
        {label}
        {required ? (
          <>
            {" "}
            <RequiredMark />
          </>
        ) : null}
      </span>
      <input
        aria-invalid={error ? "true" : undefined}
        autoComplete={autoComplete}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        onFocus={
          readOnlyUntilFocus
            ? (event) => {
                event.currentTarget.readOnly = false;
              }
            : undefined
        }
        readOnly={readOnlyUntilFocus || undefined}
        required={required}
        type={type}
        value={value ?? ""}
      />
      {error ? <span className="admin-users-field__error">{error}</span> : null}
    </label>
  );
}

function validateUserForm(form, { isCreate }) {
  if (!String(form.email || "").trim()) {
    return { field: "email", message: "Work email is required." };
  }

  const emailError = validateEmailAddress(form.email, "Work email");
  if (emailError) {
    return { field: "email", message: emailError };
  }

  if (isCreate && !String(form.password || "").trim()) {
    return { field: "password", message: "Password is required." };
  }

  if (!String(form.role || "").trim()) {
    return { field: "role", message: "Role is required." };
  }

  if (isCreate && !String(form.displayName || "").trim()) {
    return { field: "displayName", message: "Display name is required." };
  }

  if (isCreate && !String(form.country || "").trim()) {
    return { field: "country", message: "Country is required." };
  }

  if (isCreate) {
    if (!String(form.mobileNumber || "").trim()) {
      return { field: "mobileNumber", message: "Mobile number is required." };
    }
    const mobileError = validateMobileForDialCode(
      form.mobileCountryCode || "+91",
      form.mobileNumber,
    );
    if (mobileError) {
      return { field: "mobileNumber", message: mobileError };
    }
  }

  return null;
}

function UserMobileNumberField({
  countryCode,
  error = "",
  label,
  onCountryCodeChange,
  onNumberChange,
  required = false,
  value,
}) {
  const rule = MOBILE_VALIDATION_RULES[countryCode] || MOBILE_VALIDATION_RULES["+91"];
  const validationMessage = mobileValidationMessage(countryCode);

  return (
    <label
      className={`admin-users-field admin-users-field--mobile${error ? " is-invalid" : ""}`}
    >
      <span>
        {label}
        {required ? (
          <>
            {" "}
            <RequiredMark />
          </>
        ) : null}
      </span>
      <div className="mobile-field">
        <AdminFieldSelect
          aria-label={`${label} country code`}
          className="admin-field-select--mobile-code"
          menuMinWidth={160}
          onChange={onCountryCodeChange}
          options={MOBILE_COUNTRY_CODES.map((code) => ({
            value: code,
            label: `${MOBILE_VALIDATION_RULES[code].flag} ${code}`,
          }))}
          value={countryCode}
        />
        <input
          aria-invalid={error ? "true" : undefined}
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
          pattern={required || value ? mobileInputPattern(countryCode) : undefined}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={value}
        />
      </div>
      {error ? <span className="admin-users-field__error">{error}</span> : null}
    </label>
  );
}

function UserForm({
  children = null,
  error = "",
  fieldErrors = {},
  form,
  isCreate,
  onCancel,
  onChange,
  onSubmit,
  submitLabel,
}) {
  function handleCountryChange(country) {
    const next = applyCountryDefaultsToLeadForm({ ...form, country }, country);
    onChange({
      country: next.country,
      mobileCountryCode: next.mobileCountryCode,
      mobileNumber: next.mobileNumber,
    });
  }

  function handleMobileCountryCodeChange(mobileCountryCode) {
    onChange({
      country: getCountryForDialCode(mobileCountryCode, form.country),
      mobileCountryCode,
      mobileNumber: trimMobileNumberForDialCode(form.mobileNumber, mobileCountryCode),
    });
  }

  return (
    <form
      autoComplete="off"
      className="admin-users-form admin-side-overlay__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="admin-side-overlay__body">
        {error ? (
          <p className="admin-users-form__inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-users-form__grid">
          <Field
            autoComplete={isCreate ? "off" : "email"}
            error={fieldErrors.email || ""}
            label="Work email"
            name={isCreate ? "staff-work-email" : "email"}
            onChange={(value) => onChange({ email: value })}
            readOnlyUntilFocus={isCreate}
            required
            type="email"
            value={form.email}
          />
          <label className={`admin-users-field${fieldErrors.password ? " is-invalid" : ""}`}>
            <span>
              {isCreate ? "Password" : "New password"}
              {isCreate ? (
                <>
                  {" "}
                  <RequiredMark />
                </>
              ) : null}
            </span>
            <input
              aria-invalid={fieldErrors.password ? "true" : undefined}
              autoComplete={isCreate ? "new-password" : "new-password"}
              name={isCreate ? "staff-new-password" : "new-password"}
              onChange={(event) => onChange({ password: event.target.value })}
              onFocus={
                isCreate
                  ? (event) => {
                      event.currentTarget.readOnly = false;
                    }
                  : undefined
              }
              readOnly={isCreate || undefined}
              required={isCreate}
              type="password"
              value={form.password}
            />
            {isCreate || form.password ? <PasswordStrengthBar password={form.password} /> : null}
            {fieldErrors.password ? (
              <span className="admin-users-field__error">{fieldErrors.password}</span>
            ) : null}
          </label>
          <label className={`admin-users-field${fieldErrors.role ? " is-invalid" : ""}`}>
            <span>
              Role <RequiredMark />
            </span>
            <AdminFieldSelect
              aria-label="Role"
              invalid={Boolean(fieldErrors.role)}
              onChange={(role) => onChange({ role })}
              options={ROLE_OPTIONS}
              required
              value={form.role}
            />
            {fieldErrors.role ? (
              <span className="admin-users-field__error">{fieldErrors.role}</span>
            ) : null}
          </label>
          <Field
            error={fieldErrors.displayName || ""}
            label="Display name"
            onChange={(value) => onChange({ displayName: value })}
            required={isCreate}
            value={form.displayName}
          />
          <label className={`admin-users-field${fieldErrors.country ? " is-invalid" : ""}`}>
            <span>
              Country
              {isCreate ? (
                <>
                  {" "}
                  <RequiredMark />
                </>
              ) : null}
            </span>
            <AdminFieldSelect
              aria-label="Country"
              invalid={Boolean(fieldErrors.country)}
              onChange={handleCountryChange}
              options={[
                { value: "", label: "Select country" },
                ...COUNTRY_OPTIONS.map((country) => ({ value: country, label: country })),
              ]}
              placeholder="Select country"
              required={isCreate}
              value={form.country || ""}
            />
            {fieldErrors.country ? (
              <span className="admin-users-field__error">{fieldErrors.country}</span>
            ) : null}
          </label>
          <UserMobileNumberField
            countryCode={form.mobileCountryCode || "+91"}
            error={fieldErrors.mobileNumber || ""}
            label="Mobile number"
            onCountryCodeChange={handleMobileCountryCodeChange}
            onNumberChange={(value) => onChange({ mobileNumber: value })}
            required={isCreate}
            value={form.mobileNumber || ""}
          />
        </div>
        {!isCreate ? (
          <p className="admin-users-form__hint">Leave password blank to keep the current password.</p>
        ) : null}
        {children}
      </div>
      <div className="admin-side-overlay__footer">
        {onCancel ? (
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
        ) : null}
        <button className="primary-button" type="submit">
          {submitLabel}
        </button>
      </div>
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
    <div className="admin-users-bulk admin-side-overlay__form">
      <div className="admin-side-overlay__body">
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
      </div>

      <div className="admin-side-overlay__footer admin-users-bulk__footer">
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
      // AdminFieldSelect menus portal to document.body — ignore those clicks.
      if (isAdminFieldSelectMenuTarget(event.target)) {
        return;
      }
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
        <div className="admin-users-filter-dropdown__field">
          <span>Role</span>
          <AdminFieldSelect
            aria-label="Filter by role"
            onChange={onRoleChange}
            options={[
              { value: "all", label: "All roles" },
              { value: "sales", label: "Sales Executive" },
              { value: "finance", label: "Finance" },
              { value: "sales_admin", label: "Sales Admin" },
              { value: "number_management", label: "Number Management" },
            ]}
            value={roleFilter}
          />
        </div>
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
  const [fieldErrors, setFieldErrors] = useState({});
  const [mode, setMode] = useState("list");
  const [createPanelMode, setCreatePanelMode] = useState("single");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteToUserId, setDeleteToUserId] = useState("");
  const [deleteReason, setDeleteReason] = useState("Sales executive left / account transfer");
  const [deleteError, setDeleteError] = useState("");
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
  const [editBaseline, setEditBaseline] = useState(null);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [overlayMinimized, setOverlayMinimized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortDirection, setSortDirection] = useState("desc");
  const [forcingLogoutUserId, setForcingLogoutUserId] = useState(null);
  const [togglingActiveUserId, setTogglingActiveUserId] = useState(null);
  const [forceLogoutTarget, setForceLogoutTarget] = useState(null);
  const [reassignFromUser, setReassignFromUser] = useState(null);
  const [reassignToUserId, setReassignToUserId] = useState("");
  const [reassignReason, setReassignReason] = useState("Sales executive left / account transfer");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateToUserId, setDeactivateToUserId] = useState("");
  const [deactivateReason, setDeactivateReason] = useState(
    "Sales executive left / account transfer",
  );
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [rowMenuAnchorEl, setRowMenuAnchorEl] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);
  const filterAnchorRef = useRef(null);
  const rowMenuRef = useRef(null);

  function closeRowMenu() {
    setOpenRowMenuId(null);
    setRowMenuAnchorEl(null);
    setRowMenuPosition(null);
  }

  function toggleRowMenu(userId, trigger) {
    if (openRowMenuId === userId) {
      closeRowMenu();
      return;
    }
    setOpenRowMenuId(userId);
    setRowMenuAnchorEl(trigger);
  }

  async function loadUsers({ signal } = {}) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchManagedUsers({ signal });
      if (signal?.aborted) {
        return;
      }
      setUsers(data.users || []);
    } catch (loadError) {
      if (signal?.aborted || loadError?.name === "AbortError") {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Could not load users.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadUsers({ signal: controller.signal });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, roleFilter, statusFilter, pageSize, sortDirection]);

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
    if (!openRowMenuId) {
      return undefined;
    }

    function handlePointerDown(event) {
      const target = event.target;
      if (rowMenuRef.current?.contains(target) || rowMenuAnchorEl?.contains?.(target)) {
        return;
      }
      closeRowMenu();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeRowMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRowMenuId, rowMenuAnchorEl]);

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

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredUsers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredUsers.length);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);
  const openMenuUser = openRowMenuId
    ? users.find((user) => user.id === openRowMenuId) || null
    : null;

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
    setCreateForm({ ...emptyForm });
    setCreateFormKey((current) => current + 1);
    setOverlayMinimized(false);
    setFieldErrors({});
    setSuccess("");
    setError("");
  }

  function closeModal() {
    setMode("list");
    setCreatePanelMode("single");
    setBulkImporting(false);
    resetBulkUploadState();
    setSelectedUserId(null);
    setEditBaseline(null);
    setOverlayMinimized(false);
    setDeleting(false);
    setFieldErrors({});
  }

  const isOverlayDirty = useCallback(() => {
    if (mode === "create") {
      if (createPanelMode === "bulk") {
        return isUserBulkUploadDirty({
          bulkCsvText,
          bulkFileName,
          bulkValidRows,
        });
      }
      return !isUserCreateFormEmpty(createForm);
    }
    if (mode === "edit") {
      return isUserEditFormDirty(editForm, editBaseline);
    }
    return false;
  }, [
    bulkCsvText,
    bulkFileName,
    bulkValidRows,
    createForm,
    createPanelMode,
    editBaseline,
    editForm,
    mode,
  ]);

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    enabled: mode === "create" || mode === "edit",
    isBusy: bulkImporting || deleting,
    isDirty: isOverlayDirty,
    minimized: overlayMinimized,
    onClose: closeModal,
    onExpand: () => setOverlayMinimized(false),
    onMinimize: () => setOverlayMinimized(true),
  });

  function openEdit(user) {
    setMode("edit");
    setDeleting(false);
    setSelectedUserId(user.id);
    setOverlayMinimized(false);
    setFieldErrors({});
    const baseline = {
      email: user.email,
      password: "",
      role: user.role,
      displayName: user.displayName || "",
      country: user.country || "",
      mobileCountryCode: user.mobileCountryCode || "+91",
      mobileNumber: user.mobileNumber || "",
      isActive: user.isActive !== false,
    };
    setEditForm(baseline);
    setEditBaseline(baseline);
    setSuccess("");
    setError("");
  }

  function openDelete(user) {
    if (!user?.id || deleting) {
      return;
    }
    closeRowMenu();
    setError("");
    setSuccess("");
    setDeleteError("");
    setDeleteTarget(user);
    setDeleteToUserId("");
    setDeleteReason("Sales executive left / account transfer");
  }

  function closeDeleteModal() {
    if (deleting) {
      return;
    }
    setDeleteTarget(null);
    setDeleteToUserId("");
    setDeleteError("");
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
      const emailSentCount = Number(result.emailSentCount || 0);
      const emailFailedCount = Number(result.emailFailedCount || 0);
      const emailNote =
        createdCount > 0
          ? emailFailedCount > 0
            ? ` Login email sent for ${emailSentCount}/${createdCount}; ${emailFailedCount} failed.`
            : ` Login email sent for ${emailSentCount} user${emailSentCount === 1 ? "" : "s"}.`
          : "";

      if (createdCount && !rejectedCount) {
        setSuccess(`Created ${createdCount} user${createdCount === 1 ? "" : "s"} from CSV.${emailNote}`);
        closeModal();
        return;
      }

      if (createdCount) {
        setSuccess(`Created ${createdCount} user${createdCount === 1 ? "" : "s"} from CSV.${emailNote}`);
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
    setFieldErrors({});

    const validationError = validateUserForm(createForm, { isCreate: true });
    if (validationError) {
      setFieldErrors({ [validationError.field]: validationError.message });
      return;
    }

    try {
      validatePasswordPolicy(createForm.password);
    } catch (passwordError) {
      setFieldErrors({
        password: passwordError instanceof Error ? passwordError.message : "Invalid password.",
      });
      return;
    }

    try {
      const result = await createManagedUser(createForm);
      if (result?.emailSent) {
        setSuccess("User created and login email sent.");
        setError("");
      } else {
        const detail = result?.emailError
          ? result.emailError
          : "Login email could not be sent. Connect the admin Outlook mailbox or check ADMIN_EMAIL / MAIL_DRY_RUN.";
        setSuccess("User created.");
        setError(`Login email was not sent: ${detail}`);
      }
      closeModal();
      setCreateForm(emptyForm);
      await loadUsers();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not create user.";
      if (/email|already|exists/i.test(message)) {
        setFieldErrors({ email: message });
      } else if (/password/i.test(message)) {
        setFieldErrors({ password: message });
      } else {
        setError(message);
      }
    }
  }

  function needsLeadReassignment(user) {
    return ["sales", "sales_admin"].includes(user?.role);
  }

  function openMarkInactive(user) {
    if (!user?.id || togglingActiveUserId || deactivateSubmitting) {
      return;
    }
    closeRowMenu();
    setError("");
    setSuccess("");
    setDeactivateError("");
    setDeactivateTarget(user);
    setDeactivateToUserId("");
    setDeactivateReason("Sales executive left / account transfer");
  }

  function closeDeactivateModal() {
    if (deactivateSubmitting) {
      return;
    }
    setDeactivateTarget(null);
    setDeactivateToUserId("");
    setDeactivateError("");
  }

  async function toggleUserActive(user, { nextActive = user.isActive === false } = {}) {
    if (!user?.id || togglingActiveUserId) {
      return;
    }

    setTogglingActiveUserId(user.id);
    setError("");
    setSuccess("");
    closeRowMenu();
    setUsers((current) =>
      current.map((row) => (row.id === user.id ? { ...row, isActive: nextActive } : row)),
    );

    try {
      await updateManagedUser(user.id, {
        email: user.email,
        role: user.role,
        displayName: user.displayName || "",
        country: user.country || "",
        mobileCountryCode: user.mobileCountryCode || "+91",
        mobileNumber: user.mobileNumber || "",
        isActive: nextActive,
      });
      setSuccess(
        nextActive
          ? `Activated ${user.displayName || user.email}.`
          : `Deactivated ${user.displayName || user.email}.`,
      );
    } catch (toggleError) {
      setUsers((current) =>
        current.map((row) =>
          row.id === user.id ? { ...row, isActive: user.isActive !== false } : row,
        ),
      );
      throw toggleError;
    } finally {
      setTogglingActiveUserId(null);
    }
  }

  async function handleMarkActive(user) {
    try {
      await toggleUserActive(user, { nextActive: true });
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "Could not update account status.",
      );
    }
  }

  async function confirmMarkInactive(event) {
    event?.preventDefault?.();
    if (!deactivateTarget?.id || deactivateSubmitting) {
      return;
    }

    const requiresReassign = needsLeadReassignment(deactivateTarget);
    if (requiresReassign && !deactivateToUserId) {
      setDeactivateError("Select a sales executive to receive these leads and customers.");
      return;
    }

    setDeactivateSubmitting(true);
    setDeactivateError("");
    setError("");
    setSuccess("");

    try {
      let transferred = 0;
      if (requiresReassign) {
        const result = await reassignAllLeadsFromAgent(deactivateTarget.id, {
          toUserId: deactivateToUserId,
          reason: deactivateReason,
        });
        transferred = Number(result?.transferred) || 0;
      }

      await toggleUserActive(deactivateTarget, { nextActive: false });
      setDeactivateTarget(null);
      setDeactivateToUserId("");
      setSuccess(
        requiresReassign
          ? `Reassigned ${transferred} customer${transferred === 1 ? "" : "s"} and deactivated ${
              deactivateTarget.displayName || deactivateTarget.email
            }.`
          : `Deactivated ${deactivateTarget.displayName || deactivateTarget.email}.`,
      );
    } catch (deactivateFailure) {
      setDeactivateError(
        deactivateFailure instanceof Error
          ? deactivateFailure.message
          : "Could not mark this account inactive.",
      );
    } finally {
      setDeactivateSubmitting(false);
    }
  }

  async function handleUpdate() {
    if (!selectedUserId) {
      return;
    }

    setError("");
    setSuccess("");
    setFieldErrors({});

    const validationError = validateUserForm(editForm, { isCreate: false });
    if (validationError) {
      setFieldErrors({ [validationError.field]: validationError.message });
      return;
    }

    const payload = {
      email: editForm.email,
      role: editForm.role,
      displayName: editForm.displayName,
      country: editForm.country,
      mobileCountryCode: editForm.mobileCountryCode,
      mobileNumber: editForm.mobileNumber,
    };

    if (editForm.password.trim()) {
      try {
        validatePasswordPolicy(editForm.password);
      } catch (passwordError) {
        setFieldErrors({
          password: passwordError instanceof Error ? passwordError.message : "Invalid password.",
        });
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
      const message =
        submitError instanceof Error ? submitError.message : "Could not update user.";
      const enriched = message.includes("Reassign")
        ? `${message} Use Reassign customers below, or Sales Oversight → Agents.`
        : message;
      if (/email|already|exists/i.test(message)) {
        setFieldErrors({ email: enriched });
      } else if (/password/i.test(message)) {
        setFieldErrors({ password: enriched });
      } else {
        setError(enriched);
      }
    }
  }

  async function confirmDeleteUser(event) {
    event?.preventDefault?.();
    if (!deleteTarget?.id || deleting) {
      return;
    }

    const requiresReassign = needsLeadReassignment(deleteTarget);
    if (requiresReassign && !deleteToUserId) {
      setDeleteError("Select a sales executive to receive these leads and customers.");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    setError("");
    setSuccess("");

    try {
      let transferred = 0;
      if (requiresReassign) {
        const result = await reassignAllLeadsFromAgent(deleteTarget.id, {
          toUserId: deleteToUserId,
          reason: deleteReason,
        });
        transferred = Number(result?.transferred) || 0;
      }

      await deleteManagedUser(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteToUserId("");
      setSuccess(
        requiresReassign
          ? `Reassigned ${transferred} customer${transferred === 1 ? "" : "s"} and deleted ${
              deleteTarget.displayName || deleteTarget.email
            }.`
          : `Deleted ${deleteTarget.displayName || deleteTarget.email}.`,
      );
      await loadUsers();
    } catch (deleteFailure) {
      const message =
        deleteFailure instanceof Error ? deleteFailure.message : "Could not delete user.";
      setDeleteError(
        message.includes("Reassign")
          ? `${message} Choose a sales executive above, then confirm again.`
          : message,
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleReassignAllCustomers(event) {
    event.preventDefault();
    if (!reassignFromUser?.id || !reassignToUserId) {
      setError("Select a sales executive to receive these customers.");
      return;
    }

    setReassignSubmitting(true);
    setError("");
    try {
      const result = await reassignAllLeadsFromAgent(reassignFromUser.id, {
        toUserId: reassignToUserId,
        reason: reassignReason,
      });
      setSuccess(
        `Reassigned ${result?.transferred ?? 0} customer${
          (result?.transferred ?? 0) === 1 ? "" : "s"
        } from ${reassignFromUser.email}.`,
      );
      setReassignFromUser(null);
      setReassignToUserId("");
    } catch (reassignError) {
      setError(
        reassignError instanceof Error ? reassignError.message : "Could not reassign customers.",
      );
    } finally {
      setReassignSubmitting(false);
    }
  }

  function openForceLogout(user) {
    setForceLogoutTarget(user);
    setError("");
    setSuccess("");
  }

  async function confirmForceLogout() {
    if (!forceLogoutTarget) {
      return;
    }

    const email = forceLogoutTarget.email || "this user";
    setForcingLogoutUserId(forceLogoutTarget.id);
    setError("");
    setSuccess("");

    try {
      await forceLogoutManagedUser(forceLogoutTarget.id);
      setSuccess(`Forced logout for ${email}. They must sign in again.`);
      setForceLogoutTarget(null);
    } catch (forceError) {
      setError(forceError instanceof Error ? forceError.message : "Could not force logout user.");
      setForceLogoutTarget(null);
    } finally {
      setForcingLogoutUserId(null);
    }
  }

  return (
    <div className="admin-users-page admin-users-credentials-page">
      <header className="admin-users-page__header">
        <div>
          <h1>User credentials</h1>
          <p className="admin-users-page__subtitle" title="Create and manage sales, finance, and sales admin login details. Users can update their own profile afterward.">
            Create and manage sales, finance, and sales admin login details. Users can update their
            own profile afterward.
          </p>
        </div>
        <button className="primary-button admin-users-page__create" onClick={openCreate} type="button">
          <Plus size={18} />
          Create user
        </button>
      </header>

      {mode === "list" ? (
        <AdminPageToast
          error={error}
          onDismiss={() => {
            setError("");
            setSuccess("");
          }}
          success={success}
        />
      ) : null}

      <div className="admin-users-kpi-grid">
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--total">
            <Users size={20} />
          </div>
          <div>
            <span title="Total users">Total users</span>
            <strong title={String(stats.total)}>{stats.total}</strong>
            <small title="All managed accounts">All managed accounts</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--active">
            <UserCheck size={20} />
          </div>
          <div>
            <span title="Active users">Active users</span>
            <strong title={String(stats.active)}>{stats.active}</strong>
            <small title="Currently active">Currently active</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--inactive">
            <UserX size={20} />
          </div>
          <div>
            <span title="Inactive users">Inactive users</span>
            <strong title={String(stats.inactive)}>{stats.inactive}</strong>
            <small title="Currently inactive">Currently inactive</small>
          </div>
        </article>
        <article className="admin-users-kpi-card">
          <div className="admin-users-kpi-card__icon admin-users-kpi-card__icon--updated">
            <Clock size={20} />
          </div>
          <div>
            <span title="Last updated">Last updated</span>
            <strong title={formatSummaryDate(stats.latestUpdatedAt)}>
              {formatSummaryDate(stats.latestUpdatedAt)}
            </strong>
            <small title="Most recent update">Most recent update</small>
          </div>
        </article>
      </div>

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All users</h2>
            <p>{filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"} in view</p>
          </div>

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
              <button
                className="admin-users-panel__tool-button"
                disabled={filteredUsers.length === 0}
                onClick={() => downloadUsersCsv(filteredUsers)}
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
            </div>
          </div>
        </header>

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
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const displayName = user.displayName || "—";
                  const phone = formatUserPhone(user) || "—";
                  const updatedAt = formatUserUpdatedAt(user.updatedAt);
                  const updatedBy = user.updatedBy || "—";
                  const country = user.country || "—";
                  const roleLabel = getRoleLabel(user.role);

                  return (
                  <tr key={user.id} className={user.isActive === false ? "is-inactive" : ""}>
                    <td>
                      <div className="admin-users-name-cell">
                        <ProfileAvatar
                          className="admin-users-name-cell__avatar"
                          email={user.email}
                          name={user.displayName}
                          seed={user.id}
                        />
                        <span title={displayName}>{displayName}</span>
                      </div>
                    </td>
                    <td title={user.email}>{user.email}</td>
                    <td>
                      <span
                        className={`admin-users-role admin-users-role--${user.role}`}
                        title={roleLabel}
                      >
                        {roleLabel}
                      </span>
                    </td>
                    <td title={country}>{country}</td>
                    <td title={phone}>{phone}</td>
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
                    <td title={updatedAt}>{updatedAt}</td>
                    <td title={updatedBy}>{updatedBy}</td>
                    <td>
                      {user.role === "admin" ? (
                        <span className="admin-users-table__menu-placeholder" aria-hidden="true" />
                      ) : (
                        <div className="admin-users-table__menu-anchor">
                          <button
                            aria-expanded={openRowMenuId === user.id}
                            aria-haspopup="menu"
                            aria-label={`Actions for ${user.displayName || user.email}`}
                            className="admin-users-table__menu-trigger"
                            onClick={(event) => toggleRowMenu(user.id, event.currentTarget)}
                            type="button"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
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

      {openMenuUser && rowMenuAnchorEl && typeof document !== "undefined"
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
                  openEdit(openMenuUser);
                }}
                role="menuitem"
                type="button"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                disabled={
                  togglingActiveUserId === openMenuUser.id ||
                  (deactivateTarget?.id === openMenuUser.id && deactivateSubmitting)
                }
                onClick={() => {
                  if (openMenuUser.isActive === false) {
                    void handleMarkActive(openMenuUser);
                    return;
                  }
                  openMarkInactive(openMenuUser);
                }}
                role="menuitem"
                type="button"
              >
                {openMenuUser.isActive === false ? (
                  <UserCheck size={14} />
                ) : (
                  <UserX size={14} />
                )}
                {togglingActiveUserId === openMenuUser.id
                  ? "Updating…"
                  : openMenuUser.isActive === false
                    ? "Mark active"
                    : "Mark inactive"}
              </button>
              {openMenuUser.role !== "admin" ? (
                <button
                  disabled={forcingLogoutUserId === openMenuUser.id}
                  onClick={() => {
                    closeRowMenu();
                    openForceLogout(openMenuUser);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <LogOut size={14} />
                  {forcingLogoutUserId === openMenuUser.id ? "Signing out…" : "Force logout"}
                </button>
              ) : null}
              {["sales", "finance", "sales_admin", "number_management"].includes(
                openMenuUser.role,
              ) ? (
                <button
                  className="admin-users-row-menu__danger"
                  onClick={() => {
                    closeRowMenu();
                    openDelete(openMenuUser);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 size={14} />
                  Delete user
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {mode === "create" ? (
        overlayMinimized ? (
          isOverlayDirty() ? (
            <SideOverlayDraftIsland
              draftKind="create"
              icon={Users}
              label={createPanelMode === "bulk" ? "Bulk upload" : "Create user"}
              onDiscard={discardDraft}
              onOpen={expandDraft}
            />
          ) : null
        ) : (
        <div
          aria-label="Create user"
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Minimize create user form to draft"
            className="admin-side-overlay__backdrop"
            disabled={bulkImporting}
            onClick={requestDismiss}
            type="button"
          />
          <section
            className={`admin-side-overlay__panel${
              createPanelMode === "bulk" ? " admin-side-overlay__panel--wide" : ""
            }`}
          >
            <header className="admin-side-overlay__header">
              <div>
                <h2>{createPanelMode === "bulk" ? "Bulk upload" : "Create user"}</h2>
                <p>
                  {createPanelMode === "bulk"
                    ? "Import multiple sales, finance, or sales admin logins from CSV."
                    : "Add a new sales, finance, or sales admin login."}
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={bulkImporting}
                onClick={requestDismiss}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            {createPanelMode === "single" ? (
              <UserForm
                error={error}
                fieldErrors={fieldErrors}
                form={createForm}
                isCreate
                key={createFormKey}
                onCancel={requestDismiss}
                onChange={(patch) => {
                  setError("");
                  setFieldErrors((current) => {
                    const next = { ...current };
                    Object.keys(patch).forEach((key) => {
                      delete next[key];
                    });
                    return next;
                  });
                  setCreateForm((current) => ({ ...current, ...patch }));
                }}
                onSubmit={handleCreate}
                submitLabel="Create user"
              >
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
              </UserForm>
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
        )
      ) : null}

      {mode === "edit" && selectedUser ? (
        overlayMinimized ? (
          isOverlayDirty() ? (
            <SideOverlayDraftIsland
              draftKind="edit"
              icon={Users}
              label={selectedUser.displayName || selectedUser.email || "Edit user"}
              onDiscard={discardDraft}
              onOpen={expandDraft}
            />
          ) : null
        ) : (
        <div
          aria-label={`Edit ${selectedUser.displayName || selectedUser.email}`}
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Minimize edit user form to draft"
            className="admin-side-overlay__backdrop"
            disabled={deleting}
            onClick={requestDismiss}
            type="button"
          />
          <section className="admin-side-overlay__panel">
            <header className="admin-side-overlay__header">
              <div>
                <h2 title={selectedUser.displayName || selectedUser.email}>
                  Edit {selectedUser.displayName || selectedUser.email}
                </h2>
                <p>Update login details or role.</p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={deleting}
                onClick={requestDismiss}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <UserForm
              error={error}
              fieldErrors={fieldErrors}
              form={editForm}
              onCancel={requestDismiss}
              onChange={(patch) => {
                setError("");
                setFieldErrors((current) => {
                  const next = { ...current };
                  Object.keys(patch).forEach((key) => {
                    delete next[key];
                  });
                  return next;
                });
                setEditForm((current) => ({ ...current, ...patch }));
              }}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
            >
              {["sales", "sales_admin"].includes(selectedUser.role) ? (
                <section className="admin-users-delete">
                  <div>
                    <h3>Reassign customers</h3>
                    <p>
                      Transfer all leads owned by this user to another active sales executive before
                      deactivating the account (⋯ Mark inactive) or deleting from the table menu.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setError("");
                      setReassignFromUser(selectedUser);
                      setReassignToUserId("");
                      setReassignReason("Sales executive left / account transfer");
                    }}
                    type="button"
                  >
                    Reassign customers
                  </button>
                </section>
              ) : null}
            </UserForm>
          </section>
        </div>
        )
      ) : null}

      {deleteTarget ? (
        <div
          aria-label="Delete user"
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={deleting ? undefined : closeDeleteModal}
          />
          <form className="confirm-modal" onSubmit={confirmDeleteUser}>
            <header className="confirm-modal__header">
              <div className="confirm-modal__icon confirm-modal__icon--remove">
                <Trash2 size={22} />
              </div>
              <div>
                <p className="eyebrow">User credentials</p>
                <h2>Delete user</h2>
                <p className="confirm-modal__copy">
                  Permanently delete{" "}
                  <strong>{deleteTarget.displayName || deleteTarget.email}</strong>
                  {needsLeadReassignment(deleteTarget)
                    ? " after reassigning their leads and customers."
                    : "? This cannot be undone."}
                </p>
              </div>
              <button
                aria-label="Close"
                className="confirm-modal__close"
                disabled={deleting}
                onClick={closeDeleteModal}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            {needsLeadReassignment(deleteTarget) ? (
              <>
                <div className="confirm-modal__note">
                  <p>
                    Active sales accounts must transfer every owned lead and customer to another
                    active sales executive before the login can be deleted.
                  </p>
                </div>
                <label className="admin-users-field">
                  <span>New sales executive *</span>
                  <select
                    disabled={deleting}
                    onChange={(event) => {
                      setDeleteError("");
                      setDeleteToUserId(event.target.value);
                    }}
                    value={deleteToUserId}
                  >
                    <option value="">Select agent</option>
                    {users
                      .filter(
                        (user) =>
                          user.role === "sales" &&
                          user.isActive !== false &&
                          user.id !== deleteTarget.id,
                      )
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName || user.email}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="admin-users-field">
                  <span>Reason</span>
                  <input
                    disabled={deleting}
                    onChange={(event) => setDeleteReason(event.target.value)}
                    value={deleteReason}
                  />
                </label>
              </>
            ) : (
              <div className="confirm-modal__note">
                <p>
                  They will no longer be able to sign in and active sessions will be revoked. This
                  cannot be undone.
                </p>
              </div>
            )}

            {deleteError ? <p className="form-error">{deleteError}</p> : null}

            <div className="confirm-modal__footer">
              <button
                className="secondary-button"
                disabled={deleting}
                onClick={closeDeleteModal}
                type="button"
              >
                Cancel
              </button>
              <button className="danger-button" disabled={deleting} type="submit">
                <Trash2 size={16} />
                {deleting
                  ? needsLeadReassignment(deleteTarget)
                    ? "Reassigning…"
                    : "Deleting…"
                  : needsLeadReassignment(deleteTarget)
                    ? "Reassign & delete"
                    : "Confirm delete"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deactivateTarget ? (
        <div
          aria-label="Mark inactive"
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={deactivateSubmitting ? undefined : closeDeactivateModal}
          />
          <form className="confirm-modal" onSubmit={confirmMarkInactive}>
            <header className="confirm-modal__header">
              <div className="confirm-modal__icon confirm-modal__icon--remove">
                <UserX size={22} />
              </div>
              <div>
                <p className="eyebrow">User credentials</p>
                <h2>Mark inactive</h2>
                <p className="confirm-modal__copy">
                  Deactivate{" "}
                  <strong>{deactivateTarget.displayName || deactivateTarget.email}</strong>
                  {needsLeadReassignment(deactivateTarget)
                    ? " after reassigning their leads and customers."
                    : "."}
                </p>
              </div>
              <button
                aria-label="Close"
                className="confirm-modal__close"
                disabled={deactivateSubmitting}
                onClick={closeDeactivateModal}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            {needsLeadReassignment(deactivateTarget) ? (
              <>
                <div className="confirm-modal__note">
                  <p>
                    Active sales accounts must transfer every owned lead and customer to another
                    active sales executive before they can be marked inactive.
                  </p>
                </div>
                <label className="admin-users-field">
                  <span>New sales executive *</span>
                  <select
                    disabled={deactivateSubmitting}
                    onChange={(event) => {
                      setDeactivateError("");
                      setDeactivateToUserId(event.target.value);
                    }}
                    value={deactivateToUserId}
                  >
                    <option value="">Select agent</option>
                    {users
                      .filter(
                        (user) =>
                          user.role === "sales" &&
                          user.isActive !== false &&
                          user.id !== deactivateTarget.id,
                      )
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName || user.email}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="admin-users-field">
                  <span>Reason</span>
                  <input
                    disabled={deactivateSubmitting}
                    onChange={(event) => setDeactivateReason(event.target.value)}
                    value={deactivateReason}
                  />
                </label>
              </>
            ) : (
              <div className="confirm-modal__note">
                <p>
                  This user will lose sign-in access and active sessions will be revoked. You can
                  mark them active again later.
                </p>
              </div>
            )}

            {deactivateError ? <p className="form-error">{deactivateError}</p> : null}

            <div className="confirm-modal__footer">
              <button
                className="secondary-button"
                disabled={deactivateSubmitting}
                onClick={closeDeactivateModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button confirm-modal__approve"
                disabled={deactivateSubmitting}
                type="submit"
              >
                <UserX size={16} />
                {deactivateSubmitting
                  ? needsLeadReassignment(deactivateTarget)
                    ? "Reassigning…"
                    : "Updating…"
                  : needsLeadReassignment(deactivateTarget)
                    ? "Reassign & mark inactive"
                    : "Confirm mark inactive"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {reassignFromUser ? (
        <div
          aria-label="Reassign customers"
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={reassignSubmitting ? undefined : () => setReassignFromUser(null)}
          />
          <form className="confirm-modal" onSubmit={handleReassignAllCustomers}>
            <header className="confirm-modal__header">
              <div>
                <h2>Reassign customers</h2>
                <p className="confirm-modal__copy">
                  Move every customer owned by{" "}
                  <strong>{reassignFromUser.displayName || reassignFromUser.email}</strong> to
                  another active sales executive.
                </p>
              </div>
              <button
                aria-label="Close"
                className="confirm-modal__close"
                disabled={reassignSubmitting}
                onClick={() => setReassignFromUser(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <label className="admin-users-field">
              <span>New sales executive *</span>
              <select
                onChange={(event) => setReassignToUserId(event.target.value)}
                value={reassignToUserId}
              >
                <option value="">Select agent</option>
                {users
                  .filter(
                    (user) =>
                      user.role === "sales" &&
                      user.isActive !== false &&
                      user.id !== reassignFromUser.id,
                  )
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName || user.email}
                    </option>
                  ))}
              </select>
            </label>
            <label className="admin-users-field">
              <span>Reason</span>
              <input
                onChange={(event) => setReassignReason(event.target.value)}
                value={reassignReason}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="confirm-modal__footer">
              <button
                className="secondary-button"
                disabled={reassignSubmitting}
                onClick={() => setReassignFromUser(null)}
                type="button"
              >
                Cancel
              </button>
              <button className="primary-button" disabled={reassignSubmitting} type="submit">
                {reassignSubmitting ? "Reassigning..." : "Reassign all"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {forceLogoutTarget ? (
        <div
          aria-label="Force logout"
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={forcingLogoutUserId ? undefined : () => setForceLogoutTarget(null)}
          />
          <div className="confirm-modal">
            <header className="confirm-modal__header">
              <div className="confirm-modal__icon confirm-modal__icon--remove">
                <LogOut size={22} />
              </div>
              <div>
                <p className="eyebrow">User credentials</p>
                <h2>Force logout</h2>
                <p className="confirm-modal__copy">
                  Sign out all active sessions for{" "}
                  <strong>{forceLogoutTarget.email || "this user"}</strong>?
                </p>
              </div>
              <button
                aria-label="Close"
                className="confirm-modal__close"
                disabled={Boolean(forcingLogoutUserId)}
                onClick={() => setForceLogoutTarget(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="confirm-modal__note">
              <p>
                This user will be signed out from every active session and must sign in again.
              </p>
            </div>

            <footer className="confirm-modal__footer">
              <button
                className="secondary-button"
                disabled={Boolean(forcingLogoutUserId)}
                onClick={() => setForceLogoutTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button confirm-modal__approve"
                disabled={Boolean(forcingLogoutUserId)}
                onClick={confirmForceLogout}
                type="button"
              >
                <LogOut size={16} />
                {forcingLogoutUserId ? "Signing out…" : "Confirm force logout"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
