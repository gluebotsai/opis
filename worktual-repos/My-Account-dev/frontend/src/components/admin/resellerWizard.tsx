// @ts-nocheck
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { PasswordStrengthBar } from "../PasswordStrengthBar.tsx";
import {
  getCountryForDialCode,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "../../lib/countryDefaults.js";
import { validateEmailAddress } from "../../lib/emailValidation.js";
import { getLeadAddressFormatError } from "../../lib/leadAddresses.js";
import { COUNTRY_OPTIONS } from "../../lib/leads.js";
import { PartnerMobileNumberField } from "./partnerWizard.tsx";

export const RESELLER_WIZARD_STEPS = {
  create: [
    { id: 1, label: "Details", heading: "Add company details for this reseller." },
    { id: 2, label: "Contact", heading: "Add contact information for this reseller." },
    { id: 3, label: "Billing", heading: "Add billing and invoice details." },
    { id: 4, label: "Portal access", heading: "Set up portal login credentials." },
  ],
  edit: [
    { id: 1, label: "Details", heading: "Update company details for this reseller." },
    { id: 2, label: "Contact", heading: "Update contact information for this reseller." },
    { id: 3, label: "Billing", heading: "Update billing and invoice details." },
    { id: 4, label: "Portal access", heading: "Update portal login credentials." },
  ],
};

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

export function validateResellerWizardStep(step, form, { isEdit = false } = {}) {
  if (step === 1) {
    if (!String(form.companyName || "").trim()) {
      return { field: "companyName", message: "Company name is required." };
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
    if (!String(form.invoiceEmail || "").trim()) {
      return { field: "invoiceEmail", message: "Invoice email is required." };
    }
    const invoiceEmailError = validateEmailAddress(form.invoiceEmail, "Invoice email");
    if (invoiceEmailError) {
      return { field: "invoiceEmail", message: invoiceEmailError };
    }
    const invoiceCcError = validateCommaSeparatedEmails(form.invoiceCcEmails, "Invoice CC email");
    if (invoiceCcError) {
      return { field: "invoiceCcEmails", message: invoiceCcError };
    }
    if (!String(form.billingAddress || "").trim()) {
      return { field: "billingAddress", message: "Billing address is required." };
    }
    const billingAddressError = getLeadAddressFormatError(form.billingAddress, "Billing address");
    if (billingAddressError) {
      return { field: "billingAddress", message: billingAddressError };
    }
  }

  if (step === 4) {
    if (!String(form.loginEmail || "").trim()) {
      return { field: "loginEmail", message: "Portal login email is required." };
    }
    const loginEmailError = validateEmailAddress(form.loginEmail, "Portal login email");
    if (loginEmailError) {
      return { field: "loginEmail", message: loginEmailError };
    }
    if (!isEdit && !String(form.password || "").trim()) {
      return { field: "password", message: "Portal password is required." };
    }
  }

  return null;
}

export function ResellerWizardStepFields({ fieldErrors = {}, form, isEdit = false, step, updateField }) {
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
          <span>Company name</span>
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
          <input
            required
            type="email"
            value={form.workEmail}
            onChange={(event) => updateField("workEmail", event.target.value)}
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
        <label className={fieldClass("invoiceEmail")}>
          <span>Invoice email</span>
          <input
            required
            type="email"
            value={form.invoiceEmail}
            onChange={(event) => updateField("invoiceEmail", event.target.value)}
          />
          {fieldMessage("invoiceEmail")}
        </label>
        <label className={fieldClass("taxNumber")}>
          <span>Tax number / GST (optional)</span>
          <input
            value={form.taxNumber}
            onChange={(event) => updateField("taxNumber", event.target.value)}
          />
          {fieldMessage("taxNumber")}
        </label>
        <label className={fieldClass("invoiceCcEmails", "field field--full")}>
          <span>Invoice CC emails (comma-separated)</span>
          <input
            value={form.invoiceCcEmails}
            onChange={(event) => updateField("invoiceCcEmails", event.target.value)}
          />
          {fieldMessage("invoiceCcEmails")}
        </label>
        <label className={fieldClass("billingAddress", "field field--full")}>
          <span>Billing address</span>
          <textarea
            required
            rows={3}
            value={form.billingAddress}
            onChange={(event) => updateField("billingAddress", event.target.value)}
          />
          {fieldMessage("billingAddress")}
        </label>
      </>
    );
  }

  if (step === 4) {
    return (
      <>
        <label className={fieldClass("loginEmail")}>
          <span>Portal login email</span>
          <input
            required
            type="email"
            value={form.loginEmail}
            onChange={(event) => updateField("loginEmail", event.target.value)}
          />
          {fieldMessage("loginEmail")}
        </label>
        <label className="field">
          <span>Portal display name</span>
          <input
            autoComplete="off"
            id="reseller-portal-display-name"
            name="reseller-portal-display-name"
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
              id="reseller-portal-new-password"
              name="reseller-portal-new-password"
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
        {isEdit ? (
          <label className="field field--full checkbox-field">
            <input
              checked={form.isActive}
              type="checkbox"
              onChange={(event) => updateField("isActive", event.target.checked)}
            />
            <span>Active</span>
          </label>
        ) : null}
      </>
    );
  }

  return null;
}
