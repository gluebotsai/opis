// @ts-nocheck
import { useState } from "react";
import { Eye, EyeOff, Plus, Save } from "lucide-react";

import {
  applyCountryDefaultsToLeadForm,
  getCountryForDialCode,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import { validateEmailAddress } from "../../lib/emailValidation.js";
import { getLeadAddressFormatError } from "../../lib/leadAddresses.js";
import { COUNTRY_OPTIONS } from "../../lib/leads.js";
import { PasswordStrengthBar } from "../PasswordStrengthBar.tsx";
import { PartnerMobileNumberField } from "./partnerWizard.tsx";

export const emptyResellerForm = {
  companyName: "",
  contactName: "",
  designation: "",
  workEmail: "",
  invoiceEmail: "",
  invoiceCcEmails: "",
  taxNumber: "",
  billingAddress: "",
  country: "India",
  websiteUrl: "",
  mobileCountryCode: "+91",
  mobileNumber: "",
  loginEmail: "",
  password: "",
  displayName: "",
  isActive: true,
};

export function resellerToFormValues(reseller) {
  const primaryUser = reseller.users?.[0] || {};
  return {
    companyName: reseller.companyName || "",
    contactName: reseller.contactName || "",
    designation: reseller.designation || "",
    workEmail: reseller.workEmail || "",
    invoiceEmail: reseller.invoiceEmail || "",
    invoiceCcEmails: (reseller.invoiceCcEmails || []).join(", "),
    taxNumber: reseller.taxNumber || "",
    billingAddress: reseller.billingAddress || "",
    country: reseller.country || "India",
    websiteUrl: reseller.websiteUrl || "",
    mobileCountryCode: reseller.mobileCountryCode || "+91",
    mobileNumber: reseller.mobileNumber || "",
    loginEmail: primaryUser.email || "",
    password: "",
    displayName: primaryUser.displayName || reseller.contactName || "",
    isActive: reseller.isActive !== false,
  };
}

function validateCommaSeparatedEmails(value, label) {
  const emails = String(value || "")
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const [index, email] of emails.entries()) {
    const error = validateEmailAddress(email, `${label} ${index + 1}`);
    if (error) {
      return error;
    }
  }

  return "";
}

function validateResellerForm(form, { isEdit }) {
  if (!String(form.companyName || "").trim()) {
    return "Company name is required.";
  }
  if (!String(form.contactName || "").trim()) {
    return "Contact name is required.";
  }
  if (!String(form.workEmail || "").trim()) {
    return "Work email is required.";
  }
  const workEmailError = validateEmailAddress(form.workEmail, "Work email");
  if (workEmailError) {
    return workEmailError;
  }
  if (!String(form.invoiceEmail || "").trim()) {
    return "Invoice email is required.";
  }
  const invoiceEmailError = validateEmailAddress(form.invoiceEmail, "Invoice email");
  if (invoiceEmailError) {
    return invoiceEmailError;
  }
  const invoiceCcError = validateCommaSeparatedEmails(form.invoiceCcEmails, "Invoice CC email");
  if (invoiceCcError) {
    return invoiceCcError;
  }
  if (!String(form.country || "").trim()) {
    return "Country is required.";
  }
  if (!String(form.billingAddress || "").trim()) {
    return "Billing address is required.";
  }
  const billingAddressError = getLeadAddressFormatError(form.billingAddress, "Billing address");
  if (billingAddressError) {
    return billingAddressError;
  }
  if (!String(form.mobileNumber || "").trim()) {
    return "Mobile number is required.";
  }
  const mobileError = validateMobileForDialCode(
    form.mobileCountryCode || "+91",
    form.mobileNumber,
  );
  if (mobileError) {
    return mobileError;
  }
  if (!String(form.loginEmail || "").trim()) {
    return "Portal login email is required.";
  }
  const loginEmailError = validateEmailAddress(form.loginEmail, "Portal login email");
  if (loginEmailError) {
    return loginEmailError;
  }
  if (!isEdit && !String(form.password || "").trim()) {
    return "Portal password is required.";
  }
  return "";
}

export function ResellerForm({ error = "", initialValues, mode = "create", onCancel, onSubmit }) {
  const [form, setForm] = useState(initialValues || emptyResellerForm);
  const [validationError, setValidationError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isEdit = mode === "edit";

  function updateField(field, value) {
    setForm((current) => {
      if (typeof field === "object" && field !== null && !Array.isArray(field)) {
        return { ...current, ...field };
      }
      if (field === "country") {
        return applyCountryDefaultsToLeadForm({ ...current, country: value }, value);
      }
      return { ...current, [field]: value };
    });
    setValidationError("");
  }

  function handleSubmit(event) {
    event.preventDefault();
    const message = validateResellerForm(form, { isEdit });
    if (message) {
      setValidationError(message);
      return;
    }
    setValidationError("");
    onSubmit(form);
  }

  const displayError = error || validationError;

  return (
    <form autoComplete="off" className="form-grid" noValidate onSubmit={handleSubmit}>
      {displayError ? <p className="form-error field--full">{displayError}</p> : null}

      <label className="field field--full">
        <span>Company name</span>
        <input
          required
          value={form.companyName}
          onChange={(event) => updateField("companyName", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Contact name</span>
        <input
          required
          value={form.contactName}
          onChange={(event) => updateField("contactName", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Work email</span>
        <input
          required
          type="email"
          value={form.workEmail}
          onChange={(event) => updateField("workEmail", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Invoice email</span>
        <input
          required
          type="email"
          value={form.invoiceEmail}
          onChange={(event) => updateField("invoiceEmail", event.target.value)}
        />
      </label>
      <label className="field field--full">
        <span>Invoice CC emails (comma-separated)</span>
        <input
          value={form.invoiceCcEmails}
          onChange={(event) => updateField("invoiceCcEmails", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Tax number / GST (optional)</span>
        <input
          value={form.taxNumber}
          onChange={(event) => updateField("taxNumber", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Country</span>
        <select
          required
          value={form.country}
          onChange={(event) => updateField("country", event.target.value)}
        >
          {COUNTRY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--full">
        <span>Billing address</span>
        <textarea
          required
          rows={3}
          value={form.billingAddress}
          onChange={(event) => updateField("billingAddress", event.target.value)}
        />
      </label>
      <PartnerMobileNumberField
        countryCode={form.mobileCountryCode || "+91"}
        onCountryCodeChange={(mobileCountryCode) =>
          updateField({
            country: getCountryForDialCode(mobileCountryCode, form.country),
            mobileCountryCode,
            mobileNumber: trimMobileNumberForDialCode(form.mobileNumber, mobileCountryCode),
          })
        }
        onNumberChange={(value) => updateField("mobileNumber", value)}
        value={form.mobileNumber || ""}
      />
      <label className="field">
        <span>Portal login email</span>
        <input
          required
          type="email"
          value={form.loginEmail}
          onChange={(event) => updateField("loginEmail", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Portal display name</span>
        <input
          autoComplete="off"
          id="reseller-form-portal-display-name"
          name="reseller-form-portal-display-name"
          onFocus={(event) => {
            event.currentTarget.readOnly = false;
          }}
          placeholder="Portal user name"
          readOnly
          value={form.displayName}
          onChange={(event) => updateField("displayName", event.target.value)}
        />
      </label>
      <label className="field field--full">
        <span>{isEdit ? "New password (optional)" : "Portal password"}</span>
        <div className="admin-portal-password-field">
          <input
            autoComplete="new-password"
            id="reseller-form-portal-new-password"
            name="reseller-form-portal-new-password"
            onFocus={(event) => {
              event.currentTarget.readOnly = false;
            }}
            readOnly
            required={!isEdit}
            type={passwordVisible ? "text" : "password"}
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
          />
          <button
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            className="icon-button"
            onClick={() => setPasswordVisible((current) => !current)}
            type="button"
          >
            {passwordVisible ? (
              <EyeOff size={18} strokeWidth={1.75} />
            ) : (
              <Eye size={18} strokeWidth={1.75} />
            )}
          </button>
        </div>
        {form.password ? <PasswordStrengthBar password={form.password} /> : null}
      </label>
      <label className="field field--full checkbox-field">
        <input
          checked={form.isActive}
          type="checkbox"
          onChange={(event) => updateField("isActive", event.target.checked)}
        />
        <span>Active</span>
      </label>
      <div className="field field--full page-header__actions">
        <button className="button button--primary" type="submit">
          {isEdit ? <Save size={16} /> : <Plus size={16} />}
          {isEdit ? "Save changes" : "Create reseller"}
        </button>
        {onCancel ? (
          <button className="button button--secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
