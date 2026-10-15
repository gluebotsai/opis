// @ts-nocheck
import { useState } from "react";
import { Eye, EyeOff, Plus, Save } from "lucide-react";

import {
  applyCountryDefaultsToLeadForm,
  getCountryForDialCode,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import { PartnerMobileNumberField } from "./partnerWizard.tsx";
import { COUNTRY_OPTIONS } from "../../lib/leads.js";
import { PasswordStrengthBar } from "../PasswordStrengthBar.tsx";

export const emptyPartnerForm = {
  companyName: "",
  contactName: "",
  designation: "",
  workEmail: "",
  country: "India",
  websiteUrl: "",
  mobileCountryCode: "+91",
  mobileNumber: "",
  loginEmail: "",
  password: "",
  displayName: "",
  isActive: true,
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifscOrRouting: "",
  branchName: "",
};

export function partnerToFormValues(partner, bankAccount = null) {
  const primaryUser = partner.users?.[0] || {};
  return {
    companyName: partner.companyName || "",
    contactName: partner.contactName || "",
    designation: partner.designation || "",
    workEmail: partner.workEmail || "",
    country: partner.country || "India",
    websiteUrl: partner.websiteUrl || "",
    mobileCountryCode: partner.mobileCountryCode || "+91",
    mobileNumber: partner.mobileNumber || "",
    loginEmail: primaryUser.email || partner.workEmail || "",
    password: "",
    displayName: primaryUser.displayName || partner.contactName || "",
    isActive: partner.isActive !== false,
    accountHolderName: bankAccount?.accountHolderName || "",
    bankName: bankAccount?.bankName || "",
    accountNumber: bankAccount?.accountNumber || "",
    ifscOrRouting: bankAccount?.ifscOrRouting || "",
    branchName: bankAccount?.branchName || "",
  };
}

function validatePartnerForm(form, { isEdit }) {
  if (!String(form.companyName || "").trim()) {
    return "Company / legal name is required.";
  }
  if (!String(form.contactName || "").trim()) {
    return "Contact name is required.";
  }
  if (!String(form.workEmail || "").trim()) {
    return "Work email is required.";
  }
  if (!String(form.country || "").trim()) {
    return "Country is required.";
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
  if (!isEdit && !String(form.password || "").trim()) {
    return "Portal password is required.";
  }
  return "";
}

export function PartnerForm({ error = "", initialValues, mode = "create", onCancel, onSubmit }) {
  const [form, setForm] = useState(initialValues || emptyPartnerForm);
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
    const message = validatePartnerForm(form, { isEdit });
    if (message) {
      setValidationError(message);
      return;
    }
    setValidationError("");
    const workEmail = String(form.workEmail || "").trim();
    onSubmit({
      ...form,
      workEmail,
      loginEmail: workEmail,
    });
  }

  const mobileFieldError = /mobile number|country code/i.test(validationError)
    ? validationError
    : "";
  const displayError = error || (mobileFieldError ? "" : validationError);

  return (
    <form autoComplete="off" className="form-grid" noValidate onSubmit={handleSubmit}>
      {displayError ? <p className="form-error field--full">{displayError}</p> : null}

      <label className="field field--full">
        <span>Company / legal name</span>
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
      <PartnerMobileNumberField
        countryCode={form.mobileCountryCode || "+91"}
        error={mobileFieldError}
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
      <label className="field field--full">
        <span>Website (optional)</span>
        <input
          value={form.websiteUrl}
          onChange={(event) => updateField("websiteUrl", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Portal display name</span>
        <input
          autoComplete="off"
          id="partner-form-portal-display-name"
          name="partner-form-portal-display-name"
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
            id="partner-form-portal-new-password"
            name="partner-form-portal-new-password"
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
      <div className="field field--full page-header__actions">
        <button className="button button--primary" type="submit">
          {isEdit ? <Save size={16} /> : <Plus size={16} />}
          {isEdit ? "Save changes" : "Create partner"}
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
