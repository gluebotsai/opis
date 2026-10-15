// @ts-nocheck
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { AdminFieldSelect } from "../AdminFieldSelect.tsx";
import { PasswordStrengthBar } from "../PasswordStrengthBar.tsx";
import {
  getCountryForDialCode,
  MOBILE_VALIDATION_RULES,
  mobileInputPattern,
  mobileValidationMessage,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import { validateEmailAddress } from "../../lib/emailValidation.js";
import { COUNTRY_OPTIONS } from "../../lib/leads.js";

const MOBILE_COUNTRY_CODES = Object.keys(MOBILE_VALIDATION_RULES);

export const PARTNER_WIZARD_STEPS = {
  create: [
    { id: 1, label: "Details", heading: "Add company details for this partner." },
    { id: 2, label: "Contact", heading: "Add contact information for this partner." },
    { id: 3, label: "Portal access", heading: "Set up portal login credentials." },
  ],
  edit: [
    { id: 1, label: "Details", heading: "Update company details for this partner." },
    { id: 2, label: "Contact", heading: "Update contact information for this partner." },
    { id: 3, label: "Portal access", heading: "Update portal login credentials." },
    { id: 4, label: "Bank details", heading: "View or update partner payout bank details." },
  ],
};

export function PartnerMobileNumberField({
  countryCode,
  error = "",
  label = "Mobile number",
  onCountryCodeChange,
  onNumberChange,
  required = true,
  value,
}) {
  const rule = MOBILE_VALIDATION_RULES[countryCode] || MOBILE_VALIDATION_RULES["+91"];
  const validationMessage = mobileValidationMessage(countryCode);

  return (
    <label
      className={`admin-users-field admin-users-field--mobile field field--full${
        error ? " is-invalid" : ""
      }`}
    >
      <span>{label}</span>
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
      {error ? <span className="admin-wizard-field__error">{error}</span> : null}
    </label>
  );
}

export function validatePartnerWizardStep(step, form, { isEdit = false } = {}) {
  if (step === 1) {
    if (!String(form.companyName || "").trim()) {
      return { field: "companyName", message: "Company / legal name is required." };
    }
    if (!String(form.contactName || "").trim()) {
      return { field: "contactName", message: "Contact name is required." };
    }
    if (!String(form.country || "").trim()) {
      return { field: "country", message: "Country is required." };
    }
  }

  if (step === 2) {
    if (!String(form.workEmail || "").trim()) {
      return { field: "workEmail", message: "Work email is required." };
    }
    const workEmailError = validateEmailAddress(form.workEmail, "Work email");
    if (workEmailError) {
      return { field: "workEmail", message: workEmailError };
    }
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

  if (step === 3) {
    if (!isEdit && !String(form.password || "").trim()) {
      return { field: "password", message: "Portal password is required." };
    }
  }

  if (step === 4 && isEdit) {
    const hasAnyBankField = [
      form.accountHolderName,
      form.bankName,
      form.accountNumber,
      form.ifscOrRouting,
      form.branchName,
    ].some((value) => String(value || "").trim());

    if (!hasAnyBankField) {
      return null;
    }

    if (!String(form.accountHolderName || "").trim()) {
      return { field: "accountHolderName", message: "Account holder name is required when saving bank details." };
    }
    if (!String(form.bankName || "").trim()) {
      return { field: "bankName", message: "Bank name is required when saving bank details." };
    }
    if (!String(form.accountNumber || "").trim()) {
      return { field: "accountNumber", message: "Account number is required when saving bank details." };
    }
    if (!String(form.ifscOrRouting || "").trim()) {
      return { field: "ifscOrRouting", message: "IFSC / routing is required when saving bank details." };
    }
  }

  return null;
}

export function PartnerWizardStepFields({ fieldErrors = {}, form, isEdit = false, step, updateField }) {
  const [passwordVisible, setPasswordVisible] = useState(false);

  function fieldClass(name, extra = "field") {
    return `${extra}${fieldErrors[name] ? " is-invalid" : ""}`;
  }

  function fieldMessage(name) {
    return fieldErrors[name] ? (
      <span className="admin-wizard-field__error">{fieldErrors[name]}</span>
    ) : null;
  }

  function handleMobileCountryCodeChange(mobileCountryCode) {
    updateField({
      country: getCountryForDialCode(mobileCountryCode, form.country),
      mobileCountryCode,
      mobileNumber: trimMobileNumberForDialCode(form.mobileNumber, mobileCountryCode),
    });
  }

  if (step === 1) {
    return (
      <>
        <label className={fieldClass("companyName", "field field--full")}>
          <span>Company / legal name</span>
          <input
            required
            value={form.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
          />
          {fieldMessage("companyName")}
        </label>
        <label className={fieldClass("contactName")}>
          <span>Contact name</span>
          <input
            required
            value={form.contactName}
            onChange={(event) => updateField("contactName", event.target.value)}
          />
          {fieldMessage("contactName")}
        </label>
        <label className={fieldClass("country")}>
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
          {fieldMessage("country")}
        </label>
        <label className="field field--full">
          <span>Website (optional)</span>
          <input
            value={form.websiteUrl}
            onChange={(event) => updateField("websiteUrl", event.target.value)}
          />
        </label>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <label className={fieldClass("workEmail", "field field--full")}>
          <span>Work email</span>
          <textarea
            className="field__input--wrap"
            inputMode="email"
            onChange={(event) =>
              updateField("workEmail", event.target.value.replace(/[\r\n]/g, ""))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
              }
            }}
            required
            rows={1}
            value={form.workEmail}
          />
          {fieldMessage("workEmail")}
        </label>
        <PartnerMobileNumberField
          countryCode={form.mobileCountryCode || "+91"}
          error={fieldErrors.mobileNumber || ""}
          onCountryCodeChange={handleMobileCountryCodeChange}
          onNumberChange={(value) => updateField("mobileNumber", value)}
          value={form.mobileNumber || ""}
        />
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        <p className="page-header__copy field--full">
          Portal login uses the work email from the Contact step
          {form.workEmail ? `: ${form.workEmail}` : "."}
        </p>
        <label className="field">
          <span>Portal display name</span>
          <input
            autoComplete="off"
            id="partner-portal-display-name"
            name="partner-portal-display-name"
            onFocus={(event) => {
              event.currentTarget.readOnly = false;
            }}
            placeholder="Portal user name"
            readOnly
            value={form.displayName}
            onChange={(event) => updateField("displayName", event.target.value)}
          />
        </label>
        <label className={fieldClass("password", "field field--full")}>
          <span>{isEdit ? "New password (optional)" : "Portal password"}</span>
          <div className="admin-portal-password-field">
            <input
              autoComplete="new-password"
              id="partner-portal-new-password"
              name="partner-portal-new-password"
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
          {fieldMessage("password")}
        </label>
      </>
    );
  }

  if (step === 4 && isEdit) {
    return (
      <>
        <label className={fieldClass("accountHolderName", "field field--full")}>
          <span>Account holder name</span>
          <input
            value={form.accountHolderName || ""}
            onChange={(event) => updateField("accountHolderName", event.target.value)}
          />
          {fieldMessage("accountHolderName")}
        </label>
        <label className={fieldClass("bankName")}>
          <span>Bank name</span>
          <input
            value={form.bankName || ""}
            onChange={(event) => updateField("bankName", event.target.value)}
          />
          {fieldMessage("bankName")}
        </label>
        <label className="field">
          <span>Branch (optional)</span>
          <input
            value={form.branchName || ""}
            onChange={(event) => updateField("branchName", event.target.value)}
          />
        </label>
        <label className={fieldClass("accountNumber")}>
          <span>Account number</span>
          <input
            value={form.accountNumber || ""}
            onChange={(event) => updateField("accountNumber", event.target.value)}
          />
          {fieldMessage("accountNumber")}
        </label>
        <label className={fieldClass("ifscOrRouting")}>
          <span>IFSC / routing</span>
          <input
            value={form.ifscOrRouting || ""}
            onChange={(event) => updateField("ifscOrRouting", event.target.value)}
          />
          {fieldMessage("ifscOrRouting")}
        </label>
        <p className="page-header__copy field--full">
          Leave blank to keep existing bank details unchanged. Fill all required fields to upsert.
        </p>
      </>
    );
  }

  return null;
}
