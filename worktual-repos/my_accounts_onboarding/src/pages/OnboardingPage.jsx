import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Factory,
  Mail,
  MapPin,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";

import { createId } from "../lib/id.js";
import {
  applyProfileToBranchEntry,
  branchAddressFromApi,
  branchAddressToPayload,
  buildFieldCopyOptions,
  buildIndustryCopyOptions,
  buildMobileCopyOptions,
  buildProfileSources,
  createEmptyBranchAddress,
} from "../lib/branchProfile.js";
import {
  applyCountryDefaultsToLeadForm,
  getLeadCountryDefaults,
  MOBILE_VALIDATION_RULES,
} from "../lib/countryDefaults.js";
import {
  COMPANY_SIZE_OPTIONS,
  COUNTRY_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  createLead,
  getLeadById,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  updateLead,
} from "../lib/leads.js";

const STEPS = [
  { id: 1, label: "Basic details" },
  { id: 2, label: "Address & billing" },
];

const initialFormState = {
  companyName: "",
  industrySelection: "",
  customIndustryType: "",
  businessType: "",
  country: "",
  companySize: "",
  contactName: "",
  designation: "",
  isDecisionMaker: true,
  decisionMakerName: "",
  workEmail: "",
  mobileCountryCode: "+91",
  mobileNumber: "",
  secondaryMobileCountryCode: "+91",
  secondaryMobileNumber: "",
  billingAddress: "",
  websiteUrl: "",
  hasMultipleAddresses: false,
  additionalAddresses: [],
  adminEmail: "",
  taxNumber: "",
  adminEmailDifferentFromWorkEmail: false,
};

const mobileValidationRules = MOBILE_VALIDATION_RULES;

const countryCodes = Object.keys(mobileValidationRules);

const stepOneRequiredFields = [
  "companyName",
  "businessType",
  "country",
  "companySize",
  "contactName",
  "designation",
  "workEmail",
  "mobileNumber",
];

const stepTwoRequiredFields = ["billingAddress", "adminEmail"];

function resolveIndustryType(formData) {
  if (formData.industrySelection === INDUSTRY_OTHER) {
    return formData.customIndustryType.trim();
  }

  return formData.industrySelection.trim();
}

function industrySummaryLabel(formData) {
  if (!formData.industrySelection) {
    return "Industry pending";
  }

  if (formData.industrySelection === INDUSTRY_OTHER) {
    return formData.customIndustryType.trim() || "Other (specify)";
  }

  return formData.industrySelection;
}

function decisionMakerSummary(formData) {
  if (formData.isDecisionMaker) {
    return formData.contactName || "Contact is decision maker";
  }

  return formData.decisionMakerName.trim() || "Decision maker pending";
}

function createEmptyAddress(country = "") {
  return {
    ...createEmptyBranchAddress(country),
    id: createId(),
  };
}

function leadToFormState(lead) {
  const isKnownIndustry = INDUSTRY_OPTIONS.includes(lead.industryType);
  const isCustomIndustry = lead.industryType && !isKnownIndustry;
  const additionalAddresses = (lead.additionalAddresses || []).map((entry) => ({
    ...branchAddressFromApi(entry, lead.country || ""),
    id: entry.id || createId(),
  }));

  return {
    companyName: lead.companyName || "",
    industrySelection: isKnownIndustry
      ? lead.industryType
      : isCustomIndustry
        ? INDUSTRY_OTHER
        : "",
    customIndustryType: isCustomIndustry ? lead.industryType : "",
    businessType: lead.businessType || "",
    country: lead.country || "",
    companySize: lead.companySize || "",
    contactName: lead.contactName || "",
    designation: lead.designation || "",
    isDecisionMaker: lead.isDecisionMaker !== false,
    decisionMakerName: lead.decisionMakerName || "",
    workEmail: lead.workEmail || "",
    mobileCountryCode: lead.mobileCountryCode || "+91",
    mobileNumber: lead.mobileNumber || "",
    secondaryMobileCountryCode: lead.secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: lead.secondaryMobileNumber || "",
    billingAddress: lead.billingAddress || "",
    websiteUrl: lead.websiteUrl || "",
    hasMultipleAddresses: additionalAddresses.length > 0,
    additionalAddresses: additionalAddresses.length
      ? additionalAddresses
      : [createEmptyAddress(lead.country || "")],
    adminEmail: lead.adminEmail || "",
    taxNumber: lead.taxNumber || "",
    adminEmailDifferentFromWorkEmail: lead.adminEmail !== lead.workEmail,
  };
}

function addressSummaryLabel(formData) {
  const extraCount = formData.hasMultipleAddresses
    ? formData.additionalAddresses.filter((entry) => entry.address.trim()).length
    : 0;

  if (!formData.billingAddress.trim()) {
    return "Billing address pending";
  }

  if (extraCount === 0) {
    return formData.billingAddress;
  }

  return `${formData.billingAddress} (+${extraCount} more)`;
}

function validateStepOne(formData) {
  const missing = stepOneRequiredFields.filter((field) => !String(formData[field] || "").trim());
  if (missing.length) {
    return "Please complete all required fields in basic details.";
  }

  if (!formData.industrySelection) {
    return "Please select an industry type.";
  }

  if (!formData.businessType) {
    return "Please select a business type.";
  }

  const industryType = resolveIndustryType(formData);
  if (!industryType) {
    return "Please enter a custom industry type.";
  }

  if (!formData.isDecisionMaker && !formData.decisionMakerName.trim()) {
    return "Please enter the decision maker name.";
  }

  return "";
}

function validateStepTwo(formData) {
  const missing = stepTwoRequiredFields.filter((field) => !String(formData[field] || "").trim());
  if (missing.length) {
    return "Please complete all required address and billing fields.";
  }

  const additionalAddresses = formData.hasMultipleAddresses
    ? formData.additionalAddresses
        .filter((entry) => entry.address.trim())
        .map((entry) => branchAddressToPayload(entry, formData.country.trim()))
    : [];

  if (formData.hasMultipleAddresses && additionalAddresses.length === 0) {
    return "Please add at least one additional address or uncheck multiple addresses.";
  }

  return "";
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { leadId } = useParams();
  const isEditMode = Boolean(leadId);
  const [formData, setFormData] = useState(initialFormState);
  const [currentStep, setCurrentStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    let cancelled = false;

    getLeadById(leadId).then((lead) => {
      if (cancelled) {
        return;
      }

      if (!lead) {
        navigate("/products", { replace: true });
        return;
      }

      setFormData(applyCountryDefaultsToLeadForm(leadToFormState(lead), lead.country || "India"));
    });

    return () => {
      cancelled = true;
    };
  }, [isEditMode, leadId, navigate]);

  function updateField(field, value) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => {
      const next = {
        ...current,
        [field]: value,
        ...(field === "workEmail" && !current.adminEmailDifferentFromWorkEmail
          ? { adminEmail: value }
          : {}),
        ...(field === "adminEmailDifferentFromWorkEmail" && value === false
          ? { adminEmail: current.workEmail }
          : {}),
        ...(field === "isDecisionMaker" && value === true ? { decisionMakerName: "" } : {}),
      };

      if (field === "country") {
        return applyCountryDefaultsToLeadForm(next, value);
      }

      return next;
    });
  }

  function updateMobileField(countryField, numberField, nextCountryCode, nextNumber) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => {
      const countryCode = nextCountryCode ?? current[countryField];
      const maxDigits = mobileValidationRules[countryCode].digits;
      const mobileNumber = String(nextNumber ?? current[numberField])
        .replace(/\D/g, "")
        .slice(0, maxDigits);

      return {
        ...current,
        [countryField]: countryCode,
        [numberField]: mobileNumber,
      };
    });
  }

  function updateAdditionalAddress(id, field, value) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => ({
      ...current,
      additionalAddresses: current.additionalAddresses.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry,
      ),
    }));
  }

  function applyBranchProfile(id, profile) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => ({
      ...current,
      additionalAddresses: current.additionalAddresses.map((entry) =>
        entry.id === id ? applyProfileToBranchEntry(entry, profile) : entry,
      ),
    }));
  }

  function updateBranchMobileField(id, countryField, numberField, nextCountryCode, nextNumber) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => ({
      ...current,
      additionalAddresses: current.additionalAddresses.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }

        const countryCode = nextCountryCode ?? entry[countryField];
        const maxDigits = mobileValidationRules[countryCode].digits;
        const mobileNumber = String(nextNumber ?? entry[numberField])
          .replace(/\D/g, "")
          .slice(0, maxDigits);

        return {
          ...entry,
          [countryField]: countryCode,
          [numberField]: mobileNumber,
        };
      }),
    }));
  }

  function addAdditionalAddress() {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => ({
      ...current,
      additionalAddresses: [
        ...current.additionalAddresses,
        createEmptyAddress(current.country || ""),
      ],
    }));
  }

  function removeAdditionalAddress(id) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => {
      const nextAddresses = current.additionalAddresses.filter((entry) => entry.id !== id);
      return {
        ...current,
        additionalAddresses: nextAddresses.length
          ? nextAddresses
          : [createEmptyAddress(current.country || "")],
      };
    });
  }

  function toggleMultipleAddresses(enabled) {
    setSubmitted(false);
    setSaveError("");
    setFormData((current) => ({
      ...current,
      hasMultipleAddresses: enabled,
      additionalAddresses: enabled
        ? current.additionalAddresses.length
          ? current.additionalAddresses
          : [createEmptyAddress(current.country || "")]
        : current.additionalAddresses,
    }));
  }

  function handleContinue() {
    const error = validateStepOne(formData);
    if (error) {
      setSaveError(error);
      return;
    }

    setSaveError("");
    setCurrentStep(2);
  }

  function handleBack() {
    setSaveError("");
    setCurrentStep(1);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaveError("");

    const stepOneError = validateStepOne(formData);
    if (stepOneError) {
      setSaveError(stepOneError);
      setCurrentStep(1);
      return;
    }

    const stepTwoError = validateStepTwo(formData);
    if (stepTwoError) {
      setSaveError(stepTwoError);
      return;
    }

    const industryType = resolveIndustryType(formData);
    const additionalAddresses = formData.hasMultipleAddresses
      ? formData.additionalAddresses
          .filter((entry) => entry.address.trim())
          .map((entry) => branchAddressToPayload(entry, formData.country.trim()))
      : [];

    const payload = {
      companyName: formData.companyName,
      industryType,
      businessType: formData.businessType,
      country: formData.country,
      companySize: formData.companySize,
      contactName: formData.contactName,
      designation: formData.designation,
      isDecisionMaker: formData.isDecisionMaker,
      decisionMakerName: formData.isDecisionMaker ? "" : formData.decisionMakerName.trim(),
      workEmail: formData.workEmail,
      mobileCountryCode: formData.mobileCountryCode,
      mobileNumber: formData.mobileNumber,
      secondaryMobileCountryCode: formData.secondaryMobileCountryCode,
      secondaryMobileNumber: formData.secondaryMobileNumber,
      billingAddress: formData.billingAddress,
      websiteUrl: formData.websiteUrl,
      additionalAddresses,
      adminEmail: formData.adminEmail,
      taxNumber: formData.taxNumber,
    };

    try {
      if (isEditMode) {
        await updateLead(leadId, payload);
      } else {
        await createLead(payload);
      }

      setSubmitted(true);
      navigate("/products", { replace: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save lead.");
    }
  }

  const countryDefaults = getLeadCountryDefaults(formData.country);

  return (
    <section className="lead-creation-page">
      <div className="onboarding-layout">
        <div
          aria-labelledby="onboarding-title"
          aria-modal="true"
          className={`onboarding-modal onboarding-modal--step-${currentStep}`}
          role="dialog"
        >
          <header className="onboarding-modal__header">
            <div className="onboarding-modal__intro">
              <h1 id="onboarding-title">{isEditMode ? "Edit lead" : "Company information"}</h1>
              <p>
                {currentStep === 1
                  ? "Step 1 of 2 — company profile and primary contact."
                  : "Step 2 of 2 — billing address and workspace admin."}
              </p>
            </div>
            <StepIndicator currentStep={currentStep} />
          </header>

          <form
            className={`onboarding-modal__body onboarding-modal__body--step-${currentStep}`}
            onSubmit={handleSubmit}
          >
            {currentStep === 1 ? (
              <div className="form-grid">
                <FormInput
                  label="Company Name"
                  name="companyName"
                  onChange={updateField}
                  required
                  value={formData.companyName}
                />
                <IndustryTypeField formData={formData} onChange={updateField} />
                <SelectField
                  label="Business type"
                  name="businessType"
                  onChange={updateField}
                  options={BUSINESS_TYPE_OPTIONS}
                  placeholder="Select business type"
                  required
                  value={formData.businessType}
                />
                <SelectField
                  label="Country"
                  name="country"
                  onChange={updateField}
                  options={COUNTRY_OPTIONS}
                  placeholder="Select country"
                  required
                  value={formData.country}
                />
                <p className="field-hint field--full">
                  Pricing region: {countryDefaults.pricingRegion} ({countryDefaults.currency}) ·{" "}
                  {countryDefaults.taxLabel} applies on quotes
                </p>
                <SelectField
                  label="Company size"
                  name="companySize"
                  onChange={updateField}
                  options={COMPANY_SIZE_OPTIONS}
                  placeholder="Select company size"
                  required
                  value={formData.companySize}
                />
                <FormInput
                  label="Website URL"
                  name="websiteUrl"
                  onChange={updateField}
                  placeholder="https://example.com"
                  type="url"
                  value={formData.websiteUrl}
                />
                <FormInput
                  label="Contact Name"
                  name="contactName"
                  onChange={updateField}
                  required
                  value={formData.contactName}
                />
                <FormInput
                  label="Designation"
                  name="designation"
                  onChange={updateField}
                  required
                  value={formData.designation}
                />
                <label className="checkbox-field field--full">
                  <input
                    checked={formData.isDecisionMaker}
                    onChange={(event) => updateField("isDecisionMaker", event.target.checked)}
                    type="checkbox"
                  />
                  <span>Contact is the decision maker</span>
                </label>
                {!formData.isDecisionMaker ? (
                  <FormInput
                    className="field--full"
                    label="Decision maker name"
                    name="decisionMakerName"
                    onChange={updateField}
                    placeholder="Enter decision maker name"
                    required
                    value={formData.decisionMakerName}
                  />
                ) : null}
                <FormInput
                  label="Work Email"
                  name="workEmail"
                  onChange={updateField}
                  required
                  type="email"
                  value={formData.workEmail}
                />
                <MobileNumberField
                  countryCode={formData.mobileCountryCode}
                  countryField="mobileCountryCode"
                  label="Mobile Number"
                  numberField="mobileNumber"
                  numberValue={formData.mobileNumber}
                  onChange={updateMobileField}
                  required
                />
                <MobileNumberField
                  countryCode={formData.secondaryMobileCountryCode}
                  countryField="secondaryMobileCountryCode"
                  label="Secondary Mobile Number"
                  numberField="secondaryMobileNumber"
                  numberValue={formData.secondaryMobileNumber}
                  onChange={updateMobileField}
                />
              </div>
            ) : (
              <div className="form-grid">
                <section className="location-section location-section--hq field--full">
                  <div className="location-section__header">
                    <span className="location-section__badge location-section__badge--hq">
                      Head office
                    </span>
                    <div>
                      <strong>Primary billing location</strong>
                      <p className="location-section__subtitle">
                        Country: {formData.country || "Set in step 1"} · used for HQ pricing and tax
                      </p>
                    </div>
                  </div>

                  <FormTextarea
                    className="field--full"
                    label="Head office address"
                    name="billingAddress"
                    onChange={updateField}
                    required
                    value={formData.billingAddress}
                  />

                  <div className="tax-id-field tax-id-field--hq field--full">
                    <label className="field">
                      <span className="tax-id-field__label">
                        Head office {countryDefaults.taxFieldLabel}
                      </span>
                      <input
                        name="taxNumber"
                        onChange={(event) => updateField("taxNumber", event.target.value)}
                        placeholder={countryDefaults.taxPlaceholder}
                        type="text"
                        value={formData.taxNumber}
                      />
                    </label>
                    <p className="tax-id-field__hint">
                      Tax ID for invoices billed to head office ({formData.country || "lead country"}).
                    </p>
                  </div>
                </section>

                <label className="checkbox-field field--full">
                  <input
                    checked={formData.hasMultipleAddresses}
                    onChange={(event) => toggleMultipleAddresses(event.target.checked)}
                    type="checkbox"
                  />
                  <span>This company has other offices or branches in different locations</span>
                </label>

                {formData.hasMultipleAddresses ? (
                  <AdditionalAddressesField
                    addresses={formData.additionalAddresses}
                    defaultCountry={formData.country}
                    formData={formData}
                    headOfficeTaxLabel={countryDefaults.taxFieldLabel}
                    onAdd={addAdditionalAddress}
                    onApplyProfile={applyBranchProfile}
                    onChange={updateAdditionalAddress}
                    onMobileChange={updateBranchMobileField}
                    onRemove={removeAdditionalAddress}
                  />
                ) : null}

                <FormInput
                  label="Admin Email"
                  name="adminEmail"
                  onChange={updateField}
                  readOnly={!formData.adminEmailDifferentFromWorkEmail}
                  required
                  type="email"
                  value={formData.adminEmail}
                />

                <label className="checkbox-field field--full">
                  <input
                    checked={formData.adminEmailDifferentFromWorkEmail}
                    onChange={(event) =>
                      updateField("adminEmailDifferentFromWorkEmail", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Admin Email is different from Work Email</span>
                </label>
              </div>
            )}
          </form>

          {saveError ? <p className="form-error onboarding-modal__error">{saveError}</p> : null}

          {submitted ? (
            <p className="form-success onboarding-modal__success">
              <CheckCircle2 size={18} />
              {isEditMode
                ? "Lead updated. Redirecting to quote generation..."
                : "Lead saved. Redirecting to quote generation..."}
            </p>
          ) : null}

          <footer className="onboarding-modal__footer">
            {currentStep > 1 ? (
              <button className="secondary-button" onClick={handleBack} type="button">
                <ArrowLeft size={16} />
                Back
              </button>
            ) : (
              <span />
            )}

            {currentStep < 2 ? (
              <button className="primary-button" onClick={handleContinue} type="button">
                <span>Continue</span>
                <ArrowRight size={20} />
              </button>
            ) : (
              <button className="primary-button" onClick={handleSubmit} type="button">
                <span>{isEditMode ? "Save changes" : "Submit lead"}</span>
                <ArrowRight size={20} />
              </button>
            )}
          </footer>
        </div>

        <LeadSummaryPanel formData={formData} />
      </div>
    </section>
  );
}

function LeadSummaryPanel({ formData }) {
  const countryDefaults = getLeadCountryDefaults(formData.country);

  return (
    <aside className="onboarding-summary-panel" aria-label="Lead preview">
      <div className="onboarding-summary-panel__header">
        <strong>Lead preview</strong>
        <small>Updates as you fill the form</small>
      </div>

      <div className="onboarding-summary-panel__items">
        <div className="summary-item">
          <span>
            <Building2 size={18} />
          </span>
          <div>
            <strong>{formData.companyName || "Company not added"}</strong>
            <small>Workspace identity</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Factory size={18} />
          </span>
          <div>
            <strong>{industrySummaryLabel(formData)}</strong>
            <small>
              {[
                formData.businessType || "Business type pending",
                formData.country || "Country pending",
                formData.companySize || "Size pending",
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Factory size={18} />
          </span>
          <div>
            <strong>
              {countryDefaults.pricingRegion} · {countryDefaults.currency}
            </strong>
            <small>
              {countryDefaults.taxLabel} pricing and tax for this lead
            </small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <UserRound size={18} />
          </span>
          <div>
            <strong>{formData.contactName || "Primary contact"}</strong>
            <small>{formData.designation || "Designation pending"}</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <UserRound size={18} />
          </span>
          <div>
            <strong>{decisionMakerSummary(formData)}</strong>
            <small>Decision maker</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <MapPin size={18} />
          </span>
          <div>
            <strong>{addressSummaryLabel(formData)}</strong>
            <small>Billing and branch locations</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Mail size={18} />
          </span>
          <div>
            <strong>{formData.adminEmail || "Admin email pending"}</strong>
            <small>Workspace administrator</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Phone size={18} />
          </span>
          <div>
            <strong>
              {formData.mobileNumber
                ? `${formData.mobileCountryCode} ${formData.mobileNumber}`
                : "Mobile pending"}
            </strong>
            <small>Primary mobile number</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StepIndicator({ currentStep }) {
  return (
    <ol className="onboarding-steps" aria-label="Lead creation steps">
      {STEPS.map((step) => (
        <li
          key={step.id}
          className={`onboarding-steps__item ${
            step.id === currentStep ? "is-active" : step.id < currentStep ? "is-done" : ""
          }`}
        >
          <span>{step.id}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function SelectField({
  className = "",
  label,
  name,
  onChange,
  options,
  placeholder,
  required = false,
  value,
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      <select
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        required={required}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CopyFromSelect({ ariaLabel, onSelect, options }) {
  if (!options.length) {
    return null;
  }

  return (
    <select
      aria-label={ariaLabel}
      className="field-with-source__picker"
      onChange={(event) => {
        const index = event.target.value;
        if (index === "") {
          return;
        }

        onSelect(options[Number(index)]);
        event.target.value = "";
      }}
      value=""
    >
      <option value="">Copy from…</option>
      {options.map((option, index) => (
        <option key={`${option.sourceLabel}-${index}`} value={index}>
          {option.sourceLabel}: {option.displayValue ?? option.value}
        </option>
      ))}
    </select>
  );
}

function FieldWithCopy({ ariaLabel, children, copyOptions, label, onCopy }) {
  return (
    <div className="field-with-source">
      <div className="field-with-source__header">
        <span className="field-with-source__label">{label}</span>
        <CopyFromSelect ariaLabel={ariaLabel} onSelect={onCopy} options={copyOptions} />
      </div>
      {children}
    </div>
  );
}

function BranchIndustryField({ copyOptions, entry, onChange }) {
  const showCustomInput = entry.industrySelection === INDUSTRY_OTHER;

  return (
    <>
      <FieldWithCopy
        ariaLabel="Copy industry type from another location"
        copyOptions={copyOptions}
        label="Industry type"
        onCopy={(option) => {
          onChange(entry.id, "industrySelection", option.industrySelection);
          onChange(entry.id, "customIndustryType", option.customIndustryType);
        }}
      >
        <select
          onChange={(event) => onChange(entry.id, "industrySelection", event.target.value)}
          value={entry.industrySelection}
        >
          <option value="">Select industry type</option>
          {INDUSTRY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </FieldWithCopy>

      {showCustomInput ? (
        <label className="field">
          <span>Custom industry type</span>
          <input
            onChange={(event) => onChange(entry.id, "customIndustryType", event.target.value)}
            placeholder="Enter industry type"
            type="text"
            value={entry.customIndustryType}
          />
        </label>
      ) : null}
    </>
  );
}

function BranchMobileFieldWithCopy({
  copyOptions,
  countryCode,
  countryField,
  entryId,
  label,
  numberField,
  numberValue,
  onChange,
  onMobileChange,
}) {
  const rule = mobileValidationRules[countryCode];
  const validationMessage = `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;

  function handleInvalid(event) {
    event.currentTarget.setCustomValidity(validationMessage);
  }

  function handleNumberChange(event) {
    event.currentTarget.setCustomValidity("");
    onMobileChange(entryId, countryField, numberField, null, event.target.value);
  }

  function handleCountryChange(event) {
    onMobileChange(entryId, countryField, numberField, event.target.value, numberValue);
  }

  return (
    <FieldWithCopy
      ariaLabel={`Copy ${label.toLowerCase()} from another location`}
      copyOptions={copyOptions}
      label={label}
      onCopy={(option) => {
        onChange(entryId, countryField, option.countryCode);
        onChange(entryId, numberField, option.number);
      }}
    >
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
            onChange={handleCountryChange}
            value={countryCode}
          >
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {mobileValidationRules[code].flag} {code}
              </option>
            ))}
          </select>
        </span>
        <input
          inputMode="numeric"
          maxLength={rule.digits}
          minLength={rule.digits}
          onChange={handleNumberChange}
          onInvalid={handleInvalid}
          pattern={`\\d{${rule.digits}}`}
          placeholder={`${rule.digits} digits`}
          type="tel"
          value={numberValue}
        />
      </div>
      <small className="field__hint">{validationMessage}</small>
    </FieldWithCopy>
  );
}

function AdditionalAddressesField({
  addresses,
  defaultCountry,
  formData,
  headOfficeTaxLabel = "Tax ID",
  onAdd,
  onApplyProfile,
  onChange,
  onMobileChange,
  onRemove,
}) {
  return (
    <div className="address-list field--full">
      <div className="address-list__header">
        <div>
          <span className="location-section__badge location-section__badge--branch">
            Other branches
          </span>
          <strong className="address-list__title">Branch offices & locations</strong>
        </div>
        <button className="secondary-button address-list__add" onClick={onAdd} type="button">
          <Plus size={16} />
          Add branch
        </button>
      </div>

      <p className="address-list__hint">
        Each branch can have its own profile, country, and {headOfficeTaxLabel}. Use the copy
        dropdowns to reuse values from head office or earlier branches.
      </p>

      {addresses.map((entry, index) => {
        const branchCountry = entry.country || defaultCountry || "";
        const taxDefaults = getLeadCountryDefaults(branchCountry);
        const branchTitle = entry.label.trim() || `Branch ${index + 1}`;
        const profileSources = buildProfileSources(formData, addresses, index);
        const copyAllOptions = profileSources.map((source) => ({
          sourceLabel: source.label,
          displayValue: "All profile fields",
          profile: source.profile,
        }));

        return (
          <div className="address-card address-card--branch" key={entry.id}>
            <div className="address-card__header">
              <div>
                <span className="location-section__badge location-section__badge--branch">
                  Branch office
                </span>
                <strong className="address-card__title">{branchTitle}</strong>
              </div>
              {addresses.length > 1 ? (
                <button
                  aria-label={`Remove address ${index + 1}`}
                  className="address-card__remove"
                  onClick={() => onRemove(entry.id)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>

            {copyAllOptions.length ? (
              <div className="branch-copy-all field--full">
                <CopyFromSelect
                  ariaLabel={`Copy all profile fields for ${branchTitle}`}
                  onSelect={(option) => onApplyProfile(entry.id, option.profile)}
                  options={copyAllOptions}
                />
              </div>
            ) : null}

            <label className="field">
              <span>Branch label</span>
              <input
                onChange={(event) => onChange(entry.id, "label", event.target.value)}
                placeholder="Example: Mumbai branch, London office"
                type="text"
                value={entry.label}
              />
            </label>

            <FieldWithCopy
              ariaLabel="Copy country from another location"
              copyOptions={buildFieldCopyOptions("country", profileSources)}
              label="Branch country"
              onCopy={(option) => onChange(entry.id, "country", option.value)}
            >
              <select
                onChange={(event) => onChange(entry.id, "country", event.target.value)}
                value={entry.country || defaultCountry || ""}
              >
                <option value="">Select country</option>
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FieldWithCopy>

            <p className="field-hint field--full">
              Pricing region: {taxDefaults.pricingRegion} ({taxDefaults.currency}) ·{" "}
              {taxDefaults.taxLabel} applies on quotes
            </p>

            <label className="field field--full">
              <span>Address</span>
              <textarea
                onChange={(event) => onChange(entry.id, "address", event.target.value)}
                placeholder="Enter the full address"
                rows="3"
                value={entry.address}
              />
            </label>

            <FieldWithCopy
              ariaLabel="Copy tax ID from another location"
              copyOptions={buildFieldCopyOptions("taxNumber", profileSources)}
              label={`Branch ${taxDefaults.taxFieldLabel}`}
              onCopy={(option) => onChange(entry.id, "taxNumber", option.value)}
            >
              <input
                name={`branch-tax-${entry.id}`}
                onChange={(event) => onChange(entry.id, "taxNumber", event.target.value)}
                placeholder={taxDefaults.taxPlaceholder}
                type="text"
                value={entry.taxNumber || ""}
              />
            </FieldWithCopy>
            <p className="tax-id-field__hint field--full">
              Local tax ID for {branchTitle} ({branchCountry || "branch country"}) — not the head
              office {headOfficeTaxLabel.toLowerCase()}.
            </p>

            <div className="branch-profile-grid form-grid field--full">
              <BranchIndustryField
                copyOptions={buildIndustryCopyOptions(profileSources)}
                entry={entry}
                onChange={onChange}
              />

              <FieldWithCopy
                ariaLabel="Copy business type from another location"
                copyOptions={buildFieldCopyOptions("businessType", profileSources)}
                label="Business type"
                onCopy={(option) => onChange(entry.id, "businessType", option.value)}
              >
                <select
                  onChange={(event) => onChange(entry.id, "businessType", event.target.value)}
                  value={entry.businessType}
                >
                  <option value="">Select business type</option>
                  {BUSINESS_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </FieldWithCopy>

              <FieldWithCopy
                ariaLabel="Copy company size from another location"
                copyOptions={buildFieldCopyOptions("companySize", profileSources)}
                label="Company size"
                onCopy={(option) => onChange(entry.id, "companySize", option.value)}
              >
                <select
                  onChange={(event) => onChange(entry.id, "companySize", event.target.value)}
                  value={entry.companySize}
                >
                  <option value="">Select company size</option>
                  {COMPANY_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </FieldWithCopy>

              <FieldWithCopy
                ariaLabel="Copy website URL from another location"
                copyOptions={buildFieldCopyOptions("websiteUrl", profileSources)}
                label="Website URL"
                onCopy={(option) => onChange(entry.id, "websiteUrl", option.value)}
              >
                <input
                  onChange={(event) => onChange(entry.id, "websiteUrl", event.target.value)}
                  placeholder="https://example.com"
                  type="url"
                  value={entry.websiteUrl}
                />
              </FieldWithCopy>

              <FieldWithCopy
                ariaLabel="Copy contact name from another location"
                copyOptions={buildFieldCopyOptions("contactName", profileSources)}
                label="Contact name"
                onCopy={(option) => onChange(entry.id, "contactName", option.value)}
              >
                <input
                  onChange={(event) => onChange(entry.id, "contactName", event.target.value)}
                  type="text"
                  value={entry.contactName}
                />
              </FieldWithCopy>

              <FieldWithCopy
                ariaLabel="Copy designation from another location"
                copyOptions={buildFieldCopyOptions("designation", profileSources)}
                label="Designation"
                onCopy={(option) => onChange(entry.id, "designation", option.value)}
              >
                <input
                  onChange={(event) => onChange(entry.id, "designation", event.target.value)}
                  type="text"
                  value={entry.designation}
                />
              </FieldWithCopy>

              <FieldWithCopy
                ariaLabel="Copy work email from another location"
                copyOptions={buildFieldCopyOptions("workEmail", profileSources)}
                label="Work email"
                onCopy={(option) => onChange(entry.id, "workEmail", option.value)}
              >
                <input
                  onChange={(event) => onChange(entry.id, "workEmail", event.target.value)}
                  type="email"
                  value={entry.workEmail}
                />
              </FieldWithCopy>

              <BranchMobileFieldWithCopy
                copyOptions={buildMobileCopyOptions(
                  "mobileCountryCode",
                  "mobileNumber",
                  profileSources,
                )}
                countryCode={entry.mobileCountryCode}
                countryField="mobileCountryCode"
                entryId={entry.id}
                label="Mobile number"
                numberField="mobileNumber"
                numberValue={entry.mobileNumber}
                onChange={onChange}
                onMobileChange={onMobileChange}
              />

              <BranchMobileFieldWithCopy
                copyOptions={buildMobileCopyOptions(
                  "secondaryMobileCountryCode",
                  "secondaryMobileNumber",
                  profileSources,
                )}
                countryCode={entry.secondaryMobileCountryCode}
                countryField="secondaryMobileCountryCode"
                entryId={entry.id}
                label="Secondary mobile number"
                numberField="secondaryMobileNumber"
                numberValue={entry.secondaryMobileNumber}
                onChange={onChange}
                onMobileChange={onMobileChange}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IndustryTypeField({ formData, onChange }) {
  const showCustomInput = formData.industrySelection === INDUSTRY_OTHER;

  return (
    <>
      <label className="field">
        <span>Industry Type</span>
        <select
          name="industrySelection"
          onChange={(event) => onChange("industrySelection", event.target.value)}
          required
          value={formData.industrySelection}
        >
          <option value="">Select industry type</option>
          {INDUSTRY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      {showCustomInput ? (
        <FormInput
          label="Custom industry type"
          name="customIndustryType"
          onChange={onChange}
          placeholder="Enter industry type"
          required
          value={formData.customIndustryType}
        />
      ) : null}
    </>
  );
}

function MobileNumberField({
  countryCode,
  countryField,
  label,
  numberField,
  numberValue,
  onChange,
  required = false,
}) {
  const rule = mobileValidationRules[countryCode];
  const validationMessage = `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;

  function handleInvalid(event) {
    event.currentTarget.setCustomValidity(validationMessage);
  }

  function handleNumberChange(event) {
    event.currentTarget.setCustomValidity("");
    onChange(countryField, numberField, null, event.target.value);
  }

  function handleCountryChange(event) {
    onChange(countryField, numberField, event.target.value, numberValue);
  }

  return (
    <label className="field">
      <span>{label}</span>
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
            onChange={handleCountryChange}
            value={countryCode}
          >
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {mobileValidationRules[code].flag} {code}
              </option>
            ))}
          </select>
        </span>
        <input
          inputMode="numeric"
          maxLength={rule.digits}
          minLength={rule.digits}
          name={numberField}
          onChange={handleNumberChange}
          onInvalid={handleInvalid}
          pattern={`\\d{${rule.digits}}`}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={numberValue}
        />
      </div>
      <small className="field__hint">{validationMessage}</small>
    </label>
  );
}

function FormTextarea({
  className = "",
  label,
  name,
  onChange,
  placeholder = "",
  required = false,
  rows = 3,
  value,
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      <textarea
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function FormInput({
  className = "",
  label,
  name,
  onChange,
  placeholder = "",
  readOnly = false,
  required = false,
  type = "text",
  value,
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      <input
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}
