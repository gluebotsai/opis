// @ts-nocheck
import { useRef, useState } from "react";

import {
  applyCountryDefaultsToLeadForm,
  getDivisionLabelForCountry,
  getDivisionPlaceholderForCountry,
  getLeadCountryDefaults,
  MOBILE_VALIDATION_RULES,
  getStateOptionsForCountry,
  mobileInputPattern,
  requiresStateForCountry,
  validateMobileForDialCode,
} from "../lib/countryDefaults.js";
import {
  BUSINESS_TYPE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  COUNTRY_OPTIONS,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
} from "../lib/leads.js";
import { validateEmailAddress } from "../lib/emailValidation.js";
import { getLeadAddressFormatError } from "../lib/leadAddresses.js";
import { AdminFieldSelect } from "./AdminFieldSelect.tsx";
import { TaxNumberInput } from "./TaxNumberInput.tsx";
import {
  normalizeTaxNumber,
  sanitizeTaxNumberInput,
  validateGstinRemote,
  validateTaxNumberForCountry,
} from "../lib/taxNumber.js";

const initialFormState = {
  companyName: "",
  industrySelection: "",
  customIndustryType: "",
  businessType: "",
  country: "India",
  companySize: "",
  contactName: "",
  designation: "",
  workEmail: "",
  mobileCountryCode: "+91",
  mobileNumber: "",
  billingAddress: "",
  websiteUrl: "",
  adminEmail: "",
  taxNumber: "",
  state: "",
};

function resolveIndustryType(formData) {
  if (formData.industrySelection === INDUSTRY_OTHER) {
    return formData.customIndustryType.trim();
  }
  return formData.industrySelection.trim();
}

function buildPayload(formData) {
  return {
    companyName: formData.companyName.trim(),
    industryType: resolveIndustryType(formData),
    businessType: formData.businessType,
    country: formData.country,
    companySize: formData.companySize,
    contactName: formData.contactName.trim(),
    designation: formData.designation.trim(),
    isDecisionMaker: true,
    decisionMakerName: "",
    workEmail: formData.workEmail.trim(),
    mobileCountryCode: formData.mobileCountryCode,
    mobileNumber: formData.mobileNumber.trim(),
    secondaryMobileCountryCode: formData.mobileCountryCode,
    secondaryMobileNumber: "",
    billingAddress: formData.billingAddress.trim(),
    websiteUrl: formData.websiteUrl.trim(),
    additionalAddresses: [],
    adminEmail: formData.adminEmail.trim(),
    taxNumber: normalizeTaxNumber(formData.taxNumber),
    state: formData.state.trim(),
  };
}

export function ExternalLeadForm({
  title,
  description,
  submitLabel = "Submit lead",
  onSubmit,
}) {
  const [formData, setFormData] = useState(initialFormState);
  const [error, setError] = useState("");
  const [taxHint, setTaxHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [submittedLead, setSubmittedLead] = useState(null);
  const gstinRequestId = useRef(0);

  const countryDefaults = getLeadCountryDefaults(formData.country);
  const mobileRule = MOBILE_VALIDATION_RULES[formData.mobileCountryCode];

  function updateField(field, value) {
    setError("");
    if (field === "taxNumber") {
      setTaxHint("");
    }
    setFormData((current) => {
      if (field === "country") {
        return applyCountryDefaultsToLeadForm({ ...current, country: value }, value);
      }
      const nextValue = field === "taxNumber" ? sanitizeTaxNumberInput(value) : value;
      return { ...current, [field]: nextValue };
    });
  }

  async function verifyGstinOnBlur() {
    if (String(formData.country || "").trim() !== "India") {
      return;
    }
    const gstin = normalizeTaxNumber(formData.taxNumber);
    if (!gstin) {
      setTaxHint("");
      return;
    }
    const localError = validateTaxNumberForCountry(formData.country, gstin, {
      state: formData.state || "",
    });
    if (localError) {
      setError(localError);
      setTaxHint("");
      return;
    }
    if (gstin.length !== 15) {
      return;
    }

    const requestId = gstinRequestId.current + 1;
    gstinRequestId.current = requestId;
    const remote = await validateGstinRemote(gstin, { state: formData.state || "" });
    if (gstinRequestId.current !== requestId) {
      return;
    }
    if (!remote.valid) {
      setError(remote.reason || "Enter a valid GSTIN.");
      setTaxHint("");
      return;
    }
    setError("");
    setTaxHint(remote.legalName || remote.tradeName || "");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const required = [
      ["companyName", "Company name"],
      ["industrySelection", "Industry"],
      ["businessType", "Business type"],
      ["country", "Country"],
      ["companySize", "Company size"],
      ["contactName", "Contact name"],
      ["designation", "Designation"],
      ["workEmail", "Work email"],
      ["mobileNumber", "Mobile number"],
      ["billingAddress", "Billing address"],
      ["adminEmail", "Admin email"],
    ];

    for (const [field, label] of required) {
      if (!String(formData[field] || "").trim()) {
        setError(`${label} is required.`);
        return;
      }
    }

    const addressFormatError = getLeadAddressFormatError(
      formData.billingAddress,
      "Billing address",
    );
    if (addressFormatError) {
      setError(addressFormatError);
      return;
    }

    if (
      formData.industrySelection === INDUSTRY_OTHER &&
      !formData.customIndustryType.trim()
    ) {
      setError("Please specify the industry.");
      return;
    }

    const workEmailError = validateEmailAddress(formData.workEmail, "Work email");
    if (workEmailError) {
      setError(workEmailError);
      return;
    }

    const adminEmailError = validateEmailAddress(formData.adminEmail, "Admin email");
    if (adminEmailError) {
      setError(adminEmailError);
      return;
    }

    if (
      (requiresStateForCountry(formData.country) || formData.taxNumber.trim()) &&
      !formData.state.trim()
    ) {
      setError("State is required when country is India or a tax number is provided.");
      return;
    }

    const taxError = validateTaxNumberForCountry(formData.country, formData.taxNumber, {
      state: formData.state || "",
    });
    if (taxError) {
      setError(taxError);
      return;
    }

    if (String(formData.country || "").trim() === "India" && normalizeTaxNumber(formData.taxNumber)) {
      const remote = await validateGstinRemote(formData.taxNumber, {
        state: formData.state || "",
      });
      if (!remote.valid) {
        setError(remote.reason || "Enter a valid GSTIN.");
        return;
      }
      if (remote.legalName || remote.tradeName) {
        setTaxHint(remote.legalName || remote.tradeName);
      }
    }

    const mobileError = validateMobileForDialCode(
      formData.mobileCountryCode,
      formData.mobileNumber,
    );
    if (mobileError) {
      setError(mobileError);
      return;
    }

    setLoading(true);
    try {
      const lead = await onSubmit(buildPayload(formData));
      setSubmittedLead(lead);
      setFormData(initialFormState);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit lead.");
    } finally {
      setLoading(false);
    }
  }

  if (submittedLead) {
    return (
      <div className="onboarding-card">
        <h2>Lead submitted</h2>
        <p className="page-header__copy">
          <strong>{submittedLead.companyName}</strong> was submitted successfully
          {submittedLead.tenantId ? ` (ID ${submittedLead.tenantId})` : ""}. Your sales team will
          follow up — you can track status from your referrals list. You cannot create quotes from
          this portal.
        </p>
        <button
          className="secondary-button"
          onClick={() => setSubmittedLead(null)}
          type="button"
        >
          Submit another lead
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding-card">
      <header className="page-header">
        <div>
          {title ? <h2>{title}</h2> : null}
          {description ? <p className="page-header__copy">{description}</p> : null}
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field field--full">
          <span>Company name *</span>
          <input
            required
            value={formData.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Industry *</span>
          <select
            required
            value={formData.industrySelection}
            onChange={(event) => updateField("industrySelection", event.target.value)}
          >
            <option value="">Select industry</option>
            {INDUSTRY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {formData.industrySelection === INDUSTRY_OTHER ? (
          <label className="field">
            <span>Custom industry *</span>
            <input
              required
              value={formData.customIndustryType}
              onChange={(event) => updateField("customIndustryType", event.target.value)}
            />
          </label>
        ) : null}
        <label className="field">
          <span>Business type *</span>
          <select
            required
            value={formData.businessType}
            onChange={(event) => updateField("businessType", event.target.value)}
          >
            <option value="">Select type</option>
            {BUSINESS_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Country *</span>
          <select
            required
            value={formData.country}
            onChange={(event) => updateField("country", event.target.value)}
          >
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Company size *</span>
          <select
            required
            value={formData.companySize}
            onChange={(event) => updateField("companySize", event.target.value)}
          >
            <option value="">Select size</option>
            {COMPANY_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Contact name *</span>
          <input
            required
            value={formData.contactName}
            onChange={(event) => updateField("contactName", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Designation *</span>
          <input
            required
            value={formData.designation}
            onChange={(event) => updateField("designation", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Work email *</span>
          <input
            required
            type="email"
            value={formData.workEmail}
            onChange={(event) => updateField("workEmail", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Mobile code</span>
          <select
            value={formData.mobileCountryCode}
            onChange={(event) => updateField("mobileCountryCode", event.target.value)}
          >
            {Object.keys(MOBILE_VALIDATION_RULES).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mobile number *</span>
          <input
            maxLength={mobileRule?.digits || 15}
            pattern={mobileRule ? mobileInputPattern(formData.mobileCountryCode) : undefined}
            placeholder={mobileRule ? `${mobileRule.digits} digits` : ""}
            required
            type="tel"
            value={formData.mobileNumber}
            onChange={(event) =>
              updateField(
                "mobileNumber",
                event.target.value.replace(/\D/g, "").slice(0, mobileRule?.digits || 15),
              )
            }
          />
        </label>
        <label className="field field--full">
          <span>Billing address *</span>
          <textarea
            required
            rows={3}
            value={formData.billingAddress}
            onChange={(event) => updateField("billingAddress", event.target.value)}
          />
        </label>
        <ExternalStateField
          country={formData.country}
          onChange={(value) => updateField("state", value)}
          requiresState={
            requiresStateForCountry(formData.country) || Boolean(formData.taxNumber.trim())
          }
          value={formData.state}
        />
        <label className="field">
          <span>Admin email *</span>
          <input
            required
            type="email"
            value={formData.adminEmail}
            onChange={(event) => updateField("adminEmail", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{countryDefaults.taxFieldLabel}</span>
          <TaxNumberInput
            maxLength={formData.country === "India" ? 15 : 64}
            placeholder={countryDefaults.taxPlaceholder}
            value={formData.taxNumber}
            onBlur={() => void verifyGstinOnBlur()}
            onValueChange={(next) => updateField("taxNumber", next)}
          />
          {taxHint ? (
            <small className="tax-id-field__hint tax-id-field__hint--verified">
              Verified: {taxHint}
            </small>
          ) : null}
        </label>
        <label className="field field--full">
          <span>Website (optional)</span>
          <input
            value={formData.websiteUrl}
            onChange={(event) => updateField("websiteUrl", event.target.value)}
          />
        </label>
        <div className="field field--full">
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? "Submitting…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExternalStateField({ country, onChange, requiresState, value }) {
  const stateOptions = getStateOptionsForCountry(country);
  const divisionLabel = getDivisionLabelForCountry(country);

  if (stateOptions) {
    // Keep any previously stored free-text value visible even if it isn't in the curated list.
    const options =
      value && !stateOptions.includes(value) ? [value, ...stateOptions] : stateOptions;
    const selectOptions = [
      { value: "", label: `Select ${divisionLabel.toLowerCase()}` },
      ...options.map((option) => ({ value: option, label: option })),
    ];
    return (
      <label className="field">
        <span>
          {divisionLabel}
          {requiresState ? " *" : ""}
        </span>
        <AdminFieldSelect
          aria-label={divisionLabel}
          onChange={onChange}
          options={selectOptions}
          placeholder={`Select ${divisionLabel.toLowerCase()}`}
          required={requiresState}
          value={value || ""}
        />
      </label>
    );
  }

  return (
    <label className="field">
      <span>
        {divisionLabel}
        {requiresState ? " *" : ""}
      </span>
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={getDivisionPlaceholderForCountry(country)}
        required={requiresState}
        type="text"
        value={value}
      />
    </label>
  );
}
