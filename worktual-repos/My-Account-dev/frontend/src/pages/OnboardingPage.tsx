// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Factory,
  Mail,
  MapPin,
  Minimize2,
  Phone,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { preventEnterFormSubmit } from "../lib/formEnterKey.js";
import { createId } from "../lib/id.js";
import {
  LeadCreateDraftIsland,
} from "../components/leads/LeadCreateDraftIsland.tsx";
import {
  shouldLeadOverlayMinimizeOnDismiss,
} from "../lib/leadFormDraft.js";
import { AdminFieldSelect } from "../components/AdminFieldSelect.tsx";
import { TaxNumberInput } from "../components/TaxNumberInput.tsx";
import {
  applyProfileToBranchEntry,
  branchAddressFromApi,
  branchAddressToPayload,
  buildProfileSources,
  createEmptyBranchAddress,
} from "../lib/branchProfile.js";
import {
  applyCountryDefaultsToLeadForm,
  getDivisionLabelForCountry,
  getDivisionPlaceholderForCountry,
  getLeadCountryDefaults,
  MOBILE_VALIDATION_RULES,
  getStateOptionsForCountry,
  mobileInputPattern,
  mobileValidationMessage,
  normalizeLeadDialCode,
  requiresStateForCountry,
  validateMobileForDialCode,
} from "../lib/countryDefaults.js";
import { validateEmailAddress } from "../lib/emailValidation.js";
import {
  normalizeTaxNumber,
  sanitizeTaxNumberInput,
  validateGstinRemote,
  validateTaxNumberForCountry,
} from "../lib/taxNumber.js";
import {
  COMPANY_SIZE_OPTIONS,
  COUNTRY_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  createLead,
  getLeadById,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  updateLead,
  validateLeadContacts,
  validateLeadPhoneAvailability,
} from "../lib/leads.js";
import { createPartnerLead, fetchPartnerLeadById, updatePartnerLead } from "../lib/partnerAuth.js";
import { createResellerLead, fetchResellerLeadById, updateResellerLead } from "../lib/resellerAuth.js";
import { findDuplicateLeadAddresses, collectLeadAddressFormatErrors } from "../lib/leadAddresses.js";
import { findDuplicateLeadWorkEmails } from "../lib/leadWorkEmails.js";

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
  state: "",
};

const mobileValidationRules = MOBILE_VALIDATION_RULES;

const countryCodes = Object.keys(mobileValidationRules);

function RequiredMark() {
  return (
    <span aria-hidden="true" className="field__required">
      *
    </span>
  );
}

function FieldLabel({ children, required = false }) {
  return (
    <span>
      {children}
      {required ? (
        <>
          {" "}
          <RequiredMark />
        </>
      ) : null}
    </span>
  );
}

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

const stepTwoRequiredFields = ["billingAddress"];

function resolveIndustryType(formData) {
  const selection = String(formData.industrySelection || "").trim();
  if (selection === INDUSTRY_OTHER) {
    return String(formData.customIndustryType || "").trim();
  }

  return selection;
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
    adminEmail: lead.workEmail || lead.adminEmail || "",
    taxNumber: lead.taxNumber || "",
    state: lead.state || "",
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

function getStepOneFieldErrors(formData) {
  const errors = {};

  for (const field of stepOneRequiredFields) {
    if (!String(formData[field] || "").trim()) {
      errors[field] = "This field is required.";
    }
  }

  if (!formData.industrySelection) {
    errors.industrySelection = "Please select an industry type.";
  } else if (formData.industrySelection === INDUSTRY_OTHER && !formData.customIndustryType.trim()) {
    errors.customIndustryType = "Please enter a custom industry type.";
  }

  const workEmailError = validateEmailAddress(formData.workEmail, "Work email");
  if (workEmailError) {
    errors.workEmail = workEmailError;
  }

  const adminEmailError = validateEmailAddress(formData.adminEmail, "Admin email");
  if (adminEmailError) {
    errors.adminEmail = adminEmailError;
  }

  const primaryDial = String(formData.mobileCountryCode || "").trim();
  if (!primaryDial || !mobileValidationRules[primaryDial]) {
    errors.mobileNumber = "Please select a country code.";
  } else {
    const primaryMobileError = validateMobileForDialCode(primaryDial, formData.mobileNumber);
    if (primaryMobileError) {
      errors.mobileNumber = primaryMobileError;
    } else if (!String(formData.mobileNumber || "").replace(/\D/g, "")) {
      errors.mobileNumber = "This field is required.";
    }
  }

  const secondaryDigits = String(formData.secondaryMobileNumber || "").replace(/\D/g, "");
  const secondaryDial = String(formData.secondaryMobileCountryCode || "").trim();
  if (secondaryDigits) {
    if (!secondaryDial || !mobileValidationRules[secondaryDial]) {
      errors.secondaryMobileNumber = "Please select a country code.";
    } else {
      const secondaryMobileError = validateMobileForDialCode(secondaryDial, formData.secondaryMobileNumber);
      if (secondaryMobileError) {
        errors.secondaryMobileNumber = secondaryMobileError;
      }
    }
  }

  return errors;
}

function branchFieldErrorKey(branchId, field) {
  return `branch.${branchId}.${field}`;
}

function getStepTwoFieldErrors(formData) {
  const errors = {};

  for (const field of stepTwoRequiredFields) {
    if (!String(formData[field] || "").trim()) {
      errors[field] = "This field is required.";
    }
  }

  const additionalAddresses = formData.hasMultipleAddresses
    ? formData.additionalAddresses
    : [];

  if (formData.hasMultipleAddresses && additionalAddresses.length === 0) {
    errors.additionalAddresses = "Add at least one branch address or uncheck multiple addresses.";
  }

  if (
    (requiresStateForCountry(formData.country) || formData.taxNumber.trim()) &&
    !String(formData.state || "").trim()
  ) {
    errors.state = "State is required for head office when country is India or a tax number is provided.";
  }

  for (const [index, entry] of additionalAddresses.entries()) {
    const branchCountry = entry.country || formData.country;

    if (!String(entry.address || "").trim()) {
      errors[branchFieldErrorKey(entry.id, "address")] =
        `Branch ${index + 1}: Address is required.`;
    }

    if (
      (requiresStateForCountry(branchCountry) || String(entry.taxNumber || "").trim()) &&
      !String(entry.state || "").trim()
    ) {
      errors[branchFieldErrorKey(entry.id, "state")] =
        `State is required for branch ${index + 1} when a tax number is provided or country is India.`;
    }

    if (String(entry.taxNumber || "").trim()) {
      const branchTaxError = validateTaxNumberForCountry(branchCountry, entry.taxNumber, {
        state: entry.state || "",
      });
      if (branchTaxError) {
        errors[branchFieldErrorKey(entry.id, "taxNumber")] =
          `Branch ${index + 1}: ${branchTaxError}`;
      }
    }

    const branchEmailError = validateEmailAddress(entry.workEmail, `Branch ${index + 1} work email`);
    if (branchEmailError) {
      errors[branchFieldErrorKey(entry.id, "workEmail")] = branchEmailError;
    }

    const branchAdminEmailError = validateEmailAddress(
      entry.adminEmail,
      `Branch ${index + 1} admin email`,
    );
    if (branchAdminEmailError) {
      errors[branchFieldErrorKey(entry.id, "adminEmail")] = branchAdminEmailError;
    }

    if (!String(entry.mobileNumber || "").trim()) {
      errors[branchFieldErrorKey(entry.id, "mobileNumber")] =
        `Branch ${index + 1}: Mobile number is required.`;
    } else {
      const branchMobileError = validateMobileForDialCode(
        entry.mobileCountryCode || formData.mobileCountryCode,
        entry.mobileNumber,
      );
      if (branchMobileError) {
        errors[branchFieldErrorKey(entry.id, "mobileNumber")] =
          `Branch ${index + 1}: ${branchMobileError}`;
      }
    }

    const branchSecondaryError = validateMobileForDialCode(
      entry.secondaryMobileCountryCode || formData.secondaryMobileCountryCode,
      entry.secondaryMobileNumber,
    );
    if (branchSecondaryError) {
      errors[branchFieldErrorKey(entry.id, "secondaryMobileNumber")] =
        `Branch ${index + 1}: ${branchSecondaryError}`;
    }
  }

  if (String(formData.taxNumber || "").trim()) {
    const hqTaxError = validateTaxNumberForCountry(formData.country, formData.taxNumber, {
      state: formData.state || "",
    });
    if (hqTaxError) {
      errors.taxNumber = hqTaxError;
    }
  }

  const duplicateWorkEmails = findDuplicateLeadWorkEmails({
    ...formData,
    additionalAddresses,
  });
  if (duplicateWorkEmails) {
    Object.assign(errors, duplicateWorkEmails.fields);
  }

  const duplicateAddresses = findDuplicateLeadAddresses({
    ...formData,
    additionalAddresses,
  });
  if (duplicateAddresses) {
    Object.assign(errors, duplicateAddresses.fields);
  }

  const addressFormatErrors = collectLeadAddressFormatErrors({
    ...formData,
    additionalAddresses,
  });
  if (addressFormatErrors) {
    Object.assign(errors, addressFormatErrors);
  }

  return errors;
}

async function validateIndiaGstinsRemote(formData) {
  const errors = {};
  const hints = {};

  async function checkOne(country, taxNumber, state, errorKey) {
    if (String(country || "").trim() !== "India") {
      return;
    }
    const gstin = normalizeTaxNumber(taxNumber);
    if (!gstin || gstin.length !== 15) {
      return;
    }
    const localError = validateTaxNumberForCountry(country, gstin, { state });
    if (localError) {
      errors[errorKey] = localError;
      return;
    }
    const remote = await validateGstinRemote(gstin, { state });
    if (!remote.valid) {
      errors[errorKey] = remote.reason || "Enter a valid GSTIN.";
      return;
    }
    if (remote.legalName || remote.tradeName) {
      hints[errorKey] = remote.legalName || remote.tradeName;
    }
  }

  await checkOne(formData.country, formData.taxNumber, formData.state || "", "taxNumber");

  const additionalAddresses = formData.hasMultipleAddresses
    ? formData.additionalAddresses
    : [];

  for (const [index, entry] of additionalAddresses.entries()) {
    const branchCountry = entry.country || formData.country;
    const errorKey = branchFieldErrorKey(entry.id, "taxNumber");
    await checkOne(branchCountry, entry.taxNumber, entry.state || "", errorKey);
    if (errors[errorKey] && !String(errors[errorKey]).startsWith("Branch ")) {
      errors[errorKey] = `Branch ${index + 1}: ${errors[errorKey]}`;
    }
  }

  return { errors, hints };
}

function validateStepOne(formData) {
  const fields = getStepOneFieldErrors(formData);
  if (!Object.keys(fields).length) {
    return { message: "", fields: {} };
  }

  return {
    message: "Please complete all highlighted fields in basic details.",
    fields,
  };
}

function getStepTwoSummaryMessage(fields, formData) {
  const taxError = Object.entries(fields).find(
    ([field]) => field === "taxNumber" || field.endsWith(".taxNumber"),
  );
  if (taxError) {
    const [field, message] = taxError;
    const country = formData.country || "";
    const taxLabel = getLeadCountryDefaults(country).taxLabel || "tax";
    const location =
      field === "taxNumber" ? `Head office ${taxLabel} Number` : `Branch ${taxLabel} Number`;
    return `${location}: ${message}`;
  }

  const duplicateEmail = findDuplicateLeadWorkEmails(formData);
  if (duplicateEmail?.message) {
    return duplicateEmail.message;
  }

  const duplicateAddress = findDuplicateLeadAddresses(formData);
  if (duplicateAddress?.message) {
    return duplicateAddress.message;
  }

  const mobileError = Object.entries(fields).find(([field]) =>
    field.endsWith(".mobileNumber"),
  );
  if (mobileError) {
    return mobileError[1];
  }

  const divisionLabel = getDivisionLabelForCountry(formData.country || "");
  const labels = Object.keys(fields).map((field) => {
    if (field === "billingAddress") {
      return "Head office address";
    }
    if (field === "state") {
      return `Head office ${divisionLabel}`;
    }
    if (field === "additionalAddresses") {
      return "Branch offices";
    }
    if (field.endsWith(".state")) {
      return `Branch ${divisionLabel}`;
    }
    if (field.endsWith(".address")) {
      return "Branch address";
    }
    if (field.endsWith(".mobileNumber")) {
      return "Branch mobile number";
    }
    return field;
  });

  if (labels.length === 1) {
    return `Please fix the highlighted field: ${labels[0]}.`;
  }

  return `Please complete all highlighted fields in address and billing (${labels.join(", ")}).`;
}

function validateStepTwo(formData) {
  const fields = getStepTwoFieldErrors(formData);
  if (!Object.keys(fields).length) {
    return { message: "", fields: {} };
  }

  return {
    message: getStepTwoSummaryMessage(fields, formData),
    fields,
  };
}

function mapLeadSaveError(message, contactConflict = null, formData = null) {
  const normalized = String(message || "").trim();
  const fields = {};

  if (!normalized && !contactConflict) {
    return { fields, saveError: "Could not save lead.", step: null };
  }

  if (contactConflict?.field) {
    const conflictMessage = contactConflict.message || normalized || "Contact details are already used.";
    if (contactConflict.scope === "branch") {
      const branchId =
        contactConflict.branchId ||
        (formData?.additionalAddresses || []).find(
          (entry) =>
            String(entry.label || "").trim() === String(contactConflict.branchLabel || "").trim(),
        )?.id ||
        null;
      if (branchId) {
        fields[branchFieldErrorKey(branchId, contactConflict.field)] = conflictMessage;
      } else {
        fields.additionalAddresses = conflictMessage;
      }
      return { fields, saveError: conflictMessage, step: 2 };
    }

    fields[contactConflict.field] = conflictMessage;
    return { fields, saveError: conflictMessage, step: 1 };
  }

  const branchLabelMatch = normalized.match(/^Branch "([^"]+)":\s*(.+)$/i);
  if (branchLabelMatch && formData) {
    const [, branchLabel, detail] = branchLabelMatch;
    const branch = (formData.additionalAddresses || []).find(
      (entry) => String(entry.label || "").trim() === branchLabel,
    );
    let field = "workEmail";
    if (/secondary mobile/i.test(detail)) {
      field = "secondaryMobileNumber";
    } else if (/mobile/i.test(detail)) {
      field = "mobileNumber";
    } else if (/admin email/i.test(detail)) {
      field = "adminEmail";
    }
    if (branch?.id) {
      fields[branchFieldErrorKey(branch.id, field)] = normalized;
    } else {
      fields.additionalAddresses = normalized;
    }
    return { fields, saveError: normalized, step: 2 };
  }

  if (/^Head office:\s*/i.test(normalized)) {
    const detail = normalized.replace(/^Head office:\s*/i, "");
    if (/secondary mobile/i.test(detail)) {
      fields.secondaryMobileNumber = normalized;
    } else if (/mobile/i.test(detail)) {
      fields.mobileNumber = normalized;
    } else if (/admin email/i.test(detail)) {
      fields.adminEmail = normalized;
    } else {
      fields.workEmail = normalized;
    }
    return { fields, saveError: normalized, step: 1 };
  }

  if (/work email/i.test(normalized) && /unique|both|each branch/i.test(normalized)) {
    fields.workEmail = normalized;
    fields.additionalAddresses = normalized;
  } else if (/address is used by both/i.test(normalized) || (/address must be unique/i.test(normalized))) {
    fields.billingAddress = normalized;
    fields.additionalAddresses = normalized;
  } else if (/work email/i.test(normalized)) {
    fields.workEmail = normalized;
  } else if (/admin email/i.test(normalized)) {
    fields.adminEmail = normalized;
  } else if (/secondary mobile/i.test(normalized)) {
    fields.secondaryMobileNumber = normalized;
  } else if (/mobile number/i.test(normalized)) {
    fields.mobileNumber = normalized;
  } else if (/email.*staff user/i.test(normalized)) {
    fields.workEmail = normalized;
  } else if (/head office/i.test(normalized) && /state/i.test(normalized)) {
    fields.state = normalized;
  } else if (/branch/i.test(normalized) && /state/i.test(normalized)) {
    fields.additionalAddresses = normalized;
  } else if (/different state/i.test(normalized) || /registered to another company/i.test(normalized)) {
    if (/branch/i.test(normalized)) {
      fields.additionalAddresses = normalized;
    } else {
      fields.taxNumber = normalized;
    }
  } else if (/tax|gst/i.test(normalized)) {
    fields.taxNumber = normalized;
  }

  const step =
    Object.keys(fields).some((key) => key.startsWith("branch.")) || fields.additionalAddresses
      ? 2
      : fields.workEmail ||
          fields.mobileNumber ||
          fields.secondaryMobileNumber ||
          fields.adminEmail
        ? 1
        : null;

  return { fields, saveError: normalized, step };
}

function scrollToFirstInvalidField() {
  requestAnimationFrame(() => {
    const element = document.querySelector(
      [
        ".onboarding-modal .tax-id-field.field--invalid",
        ".onboarding-modal .field.field--invalid",
        ".onboarding-modal .field-with-source.field--invalid",
        ".onboarding-modal .address-list.field--invalid",
      ].join(", "),
    );
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = element?.querySelector?.("input, select, textarea");
    if (focusable && typeof focusable.focus === "function") {
      focusable.focus({ preventScroll: true });
    }
  });
}

function clearFieldError(setFieldErrors, fieldName) {
  setFieldErrors((current) => {
    if (!current[fieldName]) {
      return current;
    }

    const next = { ...current };
    delete next[fieldName];
    return next;
  });
}

export function OnboardingPage({
  mode = "sales",
  variant = "page",
  draftKind = "create",
  minimized = false,
  stackIndex = 0,
  leadId: leadIdProp = null,
  leadKind = "standard",
  onClose,
  onCreated,
  onUpdated,
  onExpand,
  onMinimize,
} = {}) {
  const navigate = useNavigate();
  const { leadId: routeLeadId } = useParams();
  const resolvedLeadId = leadIdProp || routeLeadId || "";
  const isPartnerMode = mode === "partner";
  const isResellerMode = mode === "reseller";
  const isExternalPortalMode = isPartnerMode || isResellerMode;
  const isPortalEditMode =
    isExternalPortalMode && draftKind === "edit" && Boolean(resolvedLeadId);
  const isEditMode =
    Boolean(resolvedLeadId) && (!isExternalPortalMode || isPortalEditMode);
  const isOverlay = variant === "overlay";
  const [formData, setFormData] = useState(initialFormState);
  const [initialFormSnapshot, setInitialFormSnapshot] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [submittedLead, setSubmittedLead] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [taxHints, setTaxHints] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mobileAvailabilityTimers = useRef({});
  const mobileAvailabilityRequestIds = useRef({});
  const gstinRequestIds = useRef({});

  function shouldMinimizeToDraft() {
    return shouldLeadOverlayMinimizeOnDismiss(formData, {
      baseline: initialFormSnapshot,
      isEditMode,
    });
  }

  function minimizeOverlay() {
    if (isSubmitting) {
      return;
    }
    if (shouldMinimizeToDraft()) {
      (onMinimize || onClose)?.();
      return;
    }
    onClose?.();
  }

  useEffect(() => {
    if (!isOverlay || !minimized) {
      return;
    }
    if (!shouldMinimizeToDraft()) {
      onClose?.();
    }
  }, [formData, initialFormSnapshot, isEditMode, isOverlay, minimized, onClose]);

  useEffect(() => {
    if (!isOverlay || minimized) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && !isSubmitting) {
        minimizeOverlay();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [formData, initialFormSnapshot, isEditMode, isOverlay, isSubmitting, minimized]);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    let cancelled = false;
    const fallbackPath = isPartnerMode
      ? "/partner/leads"
      : isResellerMode
        ? "/reseller/leads"
        : "/products";
    const loadPromise = isPartnerMode
      ? fetchPartnerLeadById(resolvedLeadId)
      : isResellerMode
        ? fetchResellerLeadById(resolvedLeadId)
        : getLeadById(resolvedLeadId);

    loadPromise
      .then((lead) => {
        if (cancelled) {
          return;
        }

        if (!lead) {
          if (isOverlay) {
            onClose?.();
            return;
          }
          navigate(fallbackPath, { replace: true });
          return;
        }

        const nextForm = applyCountryDefaultsToLeadForm(
          leadToFormState(lead),
          lead.country || "India",
        );
        setFormData(nextForm);
        setInitialFormSnapshot(nextForm);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        if (isOverlay) {
          onClose?.();
          return;
        }
        navigate(fallbackPath, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isEditMode, isOverlay, isPartnerMode, navigate, onClose, resolvedLeadId]);

  useEffect(() => {
    const timers = mobileAvailabilityTimers.current;
    return () => {
      for (const timerId of Object.values(timers)) {
        clearTimeout(timerId);
      }
    };
  }, []);

  function updateField(field, value) {
    setSubmitted(false);
    setSaveError("");
    clearFieldError(setFieldErrors, field);
    if (field === "taxNumber") {
      setTaxHints((current) => {
        if (!current.taxNumber) {
          return current;
        }
        const next = { ...current };
        delete next.taxNumber;
        return next;
      });
    }
    if (field === "industrySelection") {
      clearFieldError(setFieldErrors, "customIndustryType");
    }
    const nextValue = field === "taxNumber" ? sanitizeTaxNumberInput(value) : value;
    setFormData((current) => {
      const next = {
        ...current,
        [field]: nextValue,
        ...(field === "workEmail" ? { adminEmail: nextValue } : {}),
      };

      if (field === "country") {
        return applyCountryDefaultsToLeadForm(next, value);
      }

      return next;
    });
  }

  async function verifyGstinField({
    country,
    taxNumber,
    state,
    errorKey,
    requestBucket = errorKey,
  }) {
    if (String(country || "").trim() !== "India") {
      return;
    }
    const gstin = normalizeTaxNumber(taxNumber);
    if (!gstin) {
      clearFieldError(setFieldErrors, errorKey);
      setTaxHints((current) => {
        if (!current[errorKey]) {
          return current;
        }
        const next = { ...current };
        delete next[errorKey];
        return next;
      });
      return;
    }

    const localError = validateTaxNumberForCountry(country, gstin, { state });
    if (localError) {
      setFieldErrors((current) => ({ ...current, [errorKey]: localError }));
      return;
    }

    if (gstin.length !== 15) {
      return;
    }

    const requestId = (gstinRequestIds.current[requestBucket] || 0) + 1;
    gstinRequestIds.current[requestBucket] = requestId;

    const remote = await validateGstinRemote(gstin, { state });
    if (gstinRequestIds.current[requestBucket] !== requestId) {
      return;
    }

    if (!remote.valid) {
      setFieldErrors((current) => ({
        ...current,
        [errorKey]: remote.reason || "Enter a valid GSTIN.",
      }));
      setTaxHints((current) => {
        if (!current[errorKey]) {
          return current;
        }
        const next = { ...current };
        delete next[errorKey];
        return next;
      });
      return;
    }

    clearFieldError(setFieldErrors, errorKey);
    const hint = remote.legalName || remote.tradeName || "";
    setTaxHints((current) => {
      if (!hint) {
        if (!current[errorKey]) {
          return current;
        }
        const next = { ...current };
        delete next[errorKey];
        return next;
      }
      return { ...current, [errorKey]: hint };
    });
  }

  function scheduleMobileAvailabilityCheck(numberField, countryCode, mobileNumber) {
    if (mobileAvailabilityTimers.current[numberField]) {
      clearTimeout(mobileAvailabilityTimers.current[numberField]);
    }

    const formatError = validateMobileForDialCode(countryCode, mobileNumber);
    if (formatError || !String(mobileNumber || "").trim()) {
      return;
    }

    const requestId = (mobileAvailabilityRequestIds.current[numberField] || 0) + 1;
    mobileAvailabilityRequestIds.current[numberField] = requestId;

    mobileAvailabilityTimers.current[numberField] = setTimeout(async () => {
      try {
        await validateLeadPhoneAvailability({
          mobileCountryCode: countryCode,
          mobileNumber,
          phoneKind: numberField === "secondaryMobileNumber" ? "secondary" : "mobile",
          leadId: isEditMode ? resolvedLeadId : undefined,
        });
        if (mobileAvailabilityRequestIds.current[numberField] !== requestId) {
          return;
        }
        clearFieldError(setFieldErrors, numberField);
      } catch (error) {
        if (mobileAvailabilityRequestIds.current[numberField] !== requestId) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "This mobile number is unavailable.";
        setFieldErrors((current) => ({
          ...current,
          [numberField]: message,
        }));
        setSaveError(message);
      }
    }, 350);
  }

  function updateMobileField(countryField, numberField, nextCountryCode, nextNumber) {
    setSubmitted(false);
    setSaveError("");
    clearFieldError(setFieldErrors, numberField);

    const countryCode = nextCountryCode ?? formData[countryField];
    const maxDigits = mobileValidationRules[countryCode].digits;
    const mobileNumber = String(nextNumber ?? formData[numberField])
      .replace(/\D/g, "")
      .slice(0, maxDigits);

    setFormData((current) => ({
      ...current,
      [countryField]: countryCode,
      [numberField]: mobileNumber,
    }));

    scheduleMobileAvailabilityCheck(numberField, countryCode, mobileNumber);
  }

  function updateAdditionalAddress(id, field, value) {
    setSubmitted(false);
    setSaveError("");
    clearFieldError(setFieldErrors, "additionalAddresses");
    clearFieldError(setFieldErrors, branchFieldErrorKey(id, field));
    if (field === "industrySelection") {
      clearFieldError(setFieldErrors, branchFieldErrorKey(id, "customIndustryType"));
    }
    if (field === "workEmail") {
      clearFieldError(setFieldErrors, branchFieldErrorKey(id, "adminEmail"));
    }
    if (field === "taxNumber") {
      const hintKey = branchFieldErrorKey(id, "taxNumber");
      setTaxHints((current) => {
        if (!current[hintKey]) {
          return current;
        }
        const next = { ...current };
        delete next[hintKey];
        return next;
      });
    }
    const nextValue = field === "taxNumber" ? sanitizeTaxNumberInput(value) : value;
    setFormData((current) => ({
      ...current,
      additionalAddresses: current.additionalAddresses.map((entry) =>
        entry.id === id ? { ...entry, [field]: nextValue } : entry,
      ),
    }));
  }

  function applyBranchProfile(id, profile) {
    setSubmitted(false);
    setSaveError("");
    clearFieldError(setFieldErrors, "additionalAddresses");
    setFieldErrors((current) => {
      const prefix = `branch.${id}.`;
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) {
          delete next[key];
        }
      }
      return next;
    });
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
    clearFieldError(setFieldErrors, branchFieldErrorKey(id, numberField));
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
    clearFieldError(setFieldErrors, "additionalAddresses");
    setFieldErrors((current) => {
      const prefix = `branch.${id}.`;
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) {
          delete next[key];
        }
      }
      return next;
    });
    setFormData((current) => {
      const nextAddresses = current.additionalAddresses.filter((entry) => entry.id !== id);
      if (!nextAddresses.length) {
        return {
          ...current,
          hasMultipleAddresses: false,
          additionalAddresses: [],
        };
      }
      return {
        ...current,
        hasMultipleAddresses: true,
        additionalAddresses: nextAddresses,
      };
    });
  }

  function toggleMultipleAddresses(enabled) {
    setSubmitted(false);
    setSaveError("");
    clearFieldError(setFieldErrors, "additionalAddresses");
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

  async function validateStepOneContactAvailability(currentForm) {
    const contactFields = {};
    let contactMessage = "";

    const phoneChecks = [
      {
        numberField: "mobileNumber",
        countryCode: currentForm.mobileCountryCode,
        mobileNumber: currentForm.mobileNumber,
        phoneKind: "mobile",
      },
      {
        numberField: "secondaryMobileNumber",
        countryCode: currentForm.secondaryMobileCountryCode,
        mobileNumber: currentForm.secondaryMobileNumber,
        phoneKind: "secondary",
      },
    ];

    for (const check of phoneChecks) {
      if (!String(check.mobileNumber || "").trim()) {
        continue;
      }
      if (validateMobileForDialCode(check.countryCode, check.mobileNumber)) {
        continue;
      }

      try {
        await validateLeadPhoneAvailability({
          mobileCountryCode: check.countryCode,
          mobileNumber: check.mobileNumber,
          phoneKind: check.phoneKind,
          leadId: isEditMode ? resolvedLeadId : undefined,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "This mobile number is unavailable.";
        contactFields[check.numberField] = message;
        contactMessage = contactMessage || message;
      }
    }

    if (Object.keys(contactFields).length) {
      return { fields: contactFields, saveError: contactMessage };
    }

    try {
      await validateLeadContacts({
        workEmail: currentForm.workEmail,
        adminEmail: currentForm.workEmail,
        mobileCountryCode: currentForm.mobileCountryCode,
        mobileNumber: currentForm.mobileNumber,
        secondaryMobileCountryCode: currentForm.secondaryMobileCountryCode,
        secondaryMobileNumber: currentForm.secondaryMobileNumber,
        leadId: isEditMode ? resolvedLeadId : undefined,
        id: isEditMode ? resolvedLeadId : undefined,
        // GST / tax IDs are collected on step 2 — do not block Continue for them.
        skipTaxValidation: true,
      });
      return { fields: {}, saveError: "" };
    } catch (error) {
      return mapLeadSaveError(
        error instanceof Error ? error.message : "",
        error?.contactConflict || null,
        currentForm,
      );
    }
  }

  async function handleContinue() {
    const { message, fields } = validateStepOne(formData);
    if (message) {
      setFieldErrors(fields);
      setSaveError(message);
      scrollToFirstInvalidField();
      return;
    }

    setFieldErrors({});
    setSaveError("");

    const contactResult = await validateStepOneContactAvailability(formData);
    if (contactResult.saveError) {
      setFieldErrors(contactResult.fields);
      setSaveError(contactResult.saveError);
      scrollToFirstInvalidField();
      return;
    }

    setCurrentStep(2);
  }

  function handleBack() {
    setSaveError("");
    setFieldErrors({});
    setCurrentStep(1);
  }

  function goToStep(stepId) {
    if (stepId >= currentStep || isSubmitting) {
      return;
    }
    setSaveError("");
    setFieldErrors({});
    setCurrentStep(stepId);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaveError("");

    const stepOneResult = validateStepOne(formData);
    if (stepOneResult.message) {
      setFieldErrors(stepOneResult.fields);
      setSaveError(stepOneResult.message);
      setCurrentStep(1);
      scrollToFirstInvalidField();
      return;
    }

    const stepTwoResult = validateStepTwo(formData);
    if (stepTwoResult.message) {
      setFieldErrors(stepTwoResult.fields);
      setSaveError(stepTwoResult.message);
      scrollToFirstInvalidField();
      return;
    }

    const remoteGstin = await validateIndiaGstinsRemote(formData);
    if (Object.keys(remoteGstin.errors).length) {
      setFieldErrors(remoteGstin.errors);
      setSaveError(getStepTwoSummaryMessage(remoteGstin.errors, formData));
      scrollToFirstInvalidField();
      return;
    }
    if (Object.keys(remoteGstin.hints).length) {
      setTaxHints((current) => ({ ...current, ...remoteGstin.hints }));
    }

    setFieldErrors({});

    const industryType = resolveIndustryType(formData);
    const mobileCountryCode = normalizeLeadDialCode(formData.mobileCountryCode);
    const secondaryMobileCountryCode = normalizeLeadDialCode(formData.secondaryMobileCountryCode);
    const additionalAddresses = formData.hasMultipleAddresses
      ? formData.additionalAddresses
          .filter((entry) => entry.address.trim())
          .map((entry) => branchAddressToPayload(entry, formData.country.trim()))
      : [];

    const payload = {
      companyName: formData.companyName,
      industryType,
      industrySelection: formData.industrySelection,
      customIndustryType: formData.customIndustryType,
      businessType: formData.businessType,
      country: formData.country,
      companySize: formData.companySize,
      contactName: formData.contactName,
      designation: formData.designation,
      isDecisionMaker: true,
      decisionMakerName: "",
      workEmail: formData.workEmail,
      mobileCountryCode,
      mobileNumber: formData.mobileNumber,
      secondaryMobileCountryCode,
      secondaryMobileNumber: formData.secondaryMobileNumber,
      billingAddress: formData.billingAddress,
      websiteUrl: formData.websiteUrl,
      additionalAddresses,
      adminEmail: formData.workEmail,
      taxNumber: formData.taxNumber,
      state: formData.state,
      leadKind: String(leadKind || "").toLowerCase() === "temporary" ? "temporary" : "standard",
    };

    setIsSubmitting(true);
    try {
      if (isEditMode) {
        if (isPartnerMode) {
          await updatePartnerLead(resolvedLeadId, payload);
        } else if (isResellerMode) {
          await updateResellerLead(resolvedLeadId, payload);
        } else {
          await updateLead(resolvedLeadId, payload);
        }
        if (isOverlay) {
          onUpdated?.("Lead updated.");
          return;
        }
      } else if (isPartnerMode || isResellerMode) {
        const lead = isPartnerMode
          ? await createPartnerLead(payload)
          : await createResellerLead(payload);
        if (isOverlay) {
          const company = String(lead?.companyName || "").trim();
          onCreated?.(
            company
              ? `${company} submitted. Sales admin will create the quote.`
              : "Lead submitted. Sales admin will create the quote.",
          );
          return;
        }
        setSubmitted(true);
        setSubmittedLead(lead);
        setCurrentStep(1);
        setFormData(initialFormState);
        setFieldErrors({});
        setTaxHints({});
        setSaveError("");
        return;
      } else {
        await createLead(payload);
      }

      if (isOverlay) {
        onCreated?.("Lead created.");
        return;
      }

      setSubmitted(true);
      navigate("/products", { replace: true });
    } catch (error) {
      const { fields, saveError: message, step } = mapLeadSaveError(
        error instanceof Error ? error.message : "",
        error?.contactConflict || null,
        formData,
      );
      setFieldErrors(fields);
      setSaveError(message);
      if (step === 1) {
        setCurrentStep(1);
      } else if (step === 2) {
        setCurrentStep(2);
      }
      scrollToFirstInvalidField();
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetPartnerForm() {
    setSubmittedLead(null);
    setSubmitted(false);
    setCurrentStep(1);
    setFormData(initialFormState);
    setFieldErrors({});
    setTaxHints({});
    setSaveError("");
  }

  const countryDefaults = getLeadCountryDefaults(formData.country);
  const isEditLoading = isEditMode && isOverlay && !initialFormSnapshot;

  const stepFieldsForm = (
    <form
      className={`onboarding-modal__body onboarding-modal__body--step-${currentStep}`}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={(event) => {
        // Step actions are explicit buttons — do not submit/navigate on Enter in fields.
        event.preventDefault();
      }}
    >
      {currentStep === 1 ? (
        <div className="form-grid">
          <FormInput
            error={fieldErrors.companyName}
            label="Company Name"
            name="companyName"
            onChange={updateField}
            required
            value={formData.companyName}
          />
          <IndustryTypeField
            errors={{
              industrySelection: fieldErrors.industrySelection,
              customIndustryType: fieldErrors.customIndustryType,
            }}
            formData={formData}
            onChange={updateField}
          />
          <SelectField
            error={fieldErrors.businessType}
            label="Business type"
            name="businessType"
            onChange={updateField}
            options={BUSINESS_TYPE_OPTIONS}
            placeholder="Select business type"
            required
            value={formData.businessType}
          />
          <SelectField
            error={fieldErrors.country}
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
            error={fieldErrors.companySize}
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
            error={fieldErrors.contactName}
            label="Contact Name"
            name="contactName"
            onChange={updateField}
            required
            value={formData.contactName}
          />
          <FormInput
            error={fieldErrors.designation}
            label="Designation"
            name="designation"
            onChange={updateField}
            required
            value={formData.designation}
          />
          <FormInput
            error={fieldErrors.workEmail}
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
            error={fieldErrors.mobileNumber}
            label="Mobile Number"
            numberField="mobileNumber"
            numberValue={formData.mobileNumber}
            onChange={updateMobileField}
            required
          />
          <MobileNumberField
            countryCode={formData.secondaryMobileCountryCode}
            countryField="secondaryMobileCountryCode"
            error={fieldErrors.secondaryMobileNumber}
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
              error={fieldErrors.billingAddress}
              label="Head office address"
              name="billingAddress"
              onChange={updateField}
              required
              value={formData.billingAddress}
            />

            <StateField
              className="field--full"
              country={formData.country}
              error={fieldErrors.state}
              label={`Head office ${getDivisionLabelForCountry(formData.country)}`}
              onChange={(value) => updateField("state", value)}
              required={
                requiresStateForCountry(formData.country) ||
                Boolean(String(formData.taxNumber || "").trim())
              }
              value={formData.state}
            />

            <div
              className={`tax-id-field tax-id-field--hq field--full ${
                fieldErrors.taxNumber ? "field--invalid" : ""
              }`.trim()}
            >
              <label
                className={`field ${fieldErrors.taxNumber ? "field--invalid" : ""}`.trim()}
              >
                <span className="tax-id-field__label">
                  <FieldLabel>Head office {countryDefaults.taxFieldLabel}</FieldLabel>
                </span>
                <TaxNumberInput
                  aria-invalid={Boolean(fieldErrors.taxNumber)}
                  maxLength={formData.country === "India" ? 15 : 64}
                  name="taxNumber"
                  onBlur={() =>
                    void verifyGstinField({
                      country: formData.country,
                      taxNumber: formData.taxNumber,
                      state: formData.state || "",
                      errorKey: "taxNumber",
                    })
                  }
                  onValueChange={(next) => updateField("taxNumber", next)}
                  placeholder={countryDefaults.taxPlaceholder}
                  value={formData.taxNumber}
                />
              </label>
              {fieldErrors.taxNumber ? (
                <small className="field__error">{fieldErrors.taxNumber}</small>
              ) : taxHints.taxNumber ? (
                <p className="tax-id-field__hint tax-id-field__hint--verified">
                  Verified: {taxHints.taxNumber}
                </p>
              ) : (
                <p className="tax-id-field__hint">
                  Tax ID for invoices billed to head office ({formData.country || "lead country"}
                  ).
                  {formData.country === "India"
                    ? " India GSTIN must be exactly 15 letters and numbers."
                    : ""}
                </p>
              )}
            </div>
          </section>

          {/* Hidden for now — multi-branch offices UI not needed.
          <label className="checkbox-field field--full">
            <input
              checked={formData.hasMultipleAddresses}
              onChange={(event) => toggleMultipleAddresses(event.target.checked)}
              type="checkbox"
            />
            <span>This company has other offices or branches in different locations</span>
          </label>
          */}

          {formData.hasMultipleAddresses ? (
            <AdditionalAddressesField
              addresses={formData.additionalAddresses}
              defaultCountry={formData.country}
              error={fieldErrors.additionalAddresses}
              fieldErrors={fieldErrors}
              formData={formData}
              headOfficeTaxLabel={countryDefaults.taxFieldLabel}
              onAdd={addAdditionalAddress}
              onApplyProfile={applyBranchProfile}
              onChange={(id, field, value) => {
                updateAdditionalAddress(id, field, value);
              }}
              onMobileChange={updateBranchMobileField}
              onRemove={removeAdditionalAddress}
              onTaxBlur={(entry) =>
                void verifyGstinField({
                  country: entry.country || formData.country,
                  taxNumber: entry.taxNumber,
                  state: entry.state || "",
                  errorKey: branchFieldErrorKey(entry.id, "taxNumber"),
                })
              }
              taxHints={taxHints}
            />
          ) : null}
        </div>
      )}
    </form>
  );

  if (isOverlay) {
    const overlayTitle = isEditMode
      ? "Edit lead"
      : isExternalPortalMode
        ? "Lead creation"
        : "Create lead";
    const draftTitle = formData.companyName.trim() || overlayTitle;
    const islandDraftKind = isEditMode ? "edit" : draftKind;

    if (minimized) {
      if (!shouldMinimizeToDraft()) {
        return null;
      }

      return (
        <LeadCreateDraftIsland
          draftKind={islandDraftKind}
          label={draftTitle}
          onDiscard={onClose}
          onOpen={() => onExpand?.()}
          stackIndex={stackIndex}
          step={currentStep}
        />
      );
    }

    return (
      <div
        aria-label={overlayTitle}
        aria-modal="true"
        className="admin-side-overlay"
        role="dialog"
      >
        <button
          aria-label={`Minimize ${overlayTitle.toLowerCase()} to draft`}
          className="admin-side-overlay__backdrop"
          disabled={isSubmitting}
          onClick={minimizeOverlay}
          type="button"
        />
        <section className="admin-side-overlay__panel admin-side-overlay__panel--wide admin-side-overlay__panel--with-steps">
          <header className="admin-side-overlay__header">
            <div>
              <h2>{overlayTitle}</h2>
              <p>
                {currentStep === 1
                  ? "Step 1 of 2 — company profile and primary contact."
                  : isExternalPortalMode
                    ? "Step 2 of 2 — billing address. Sales admin creates the quote after submit."
                    : "Step 2 of 2 — billing address and workspace admin."}
              </p>
            </div>
            <button
              aria-label="Minimize to draft"
              className="admin-users-panel__icon-button"
              disabled={isSubmitting}
              onClick={minimizeOverlay}
              title="Minimize to draft"
              type="button"
            >
              <Minimize2 size={18} />
            </button>
          </header>

          <nav aria-label={isEditMode ? "Lead edit steps" : "Lead creation steps"} className="admin-overlay-steps">
            <ol className="admin-overlay-steps__list">
              {STEPS.map((step, index) => {
                const status =
                  step.id === currentStep ? "active" : step.id < currentStep ? "done" : "upcoming";
                const clickable = step.id < currentStep && !isSubmitting;

                return (
                  <li
                    className={`admin-overlay-steps__item is-${status}${
                      clickable ? " is-clickable" : ""
                    }`}
                    key={step.id}
                  >
                    <button
                      aria-current={status === "active" ? "step" : undefined}
                      className="admin-overlay-steps__button"
                      disabled={!clickable}
                      onClick={() => goToStep(step.id)}
                      type="button"
                    >
                      <span className="admin-overlay-steps__marker">
                        {status === "done" ? "✓" : step.id}
                      </span>
                      <span className="admin-overlay-steps__label">{step.label}</span>
                    </button>
                    {index < STEPS.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={`admin-overlay-steps__connector${
                          step.id < currentStep ? " is-complete" : ""
                        }`}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="admin-side-overlay__body admin-lead-create-overlay__body">
            {isEditLoading ? (
              <p className="admin-users-field__hint">Loading lead…</p>
            ) : (
              <>
                {saveError ? (
                  <p className="admin-users-form__inline-error" role="alert">
                    {saveError}
                  </p>
                ) : null}
                {stepFieldsForm}
              </>
            )}
          </div>

          <div className="admin-side-overlay__footer">
            <button
              className="secondary-button"
              disabled={isSubmitting || isEditLoading}
              onClick={minimizeOverlay}
              type="button"
            >
              Cancel
            </button>
            {currentStep > 1 ? (
              <button
                className="secondary-button"
                disabled={isSubmitting || isEditLoading}
                onClick={handleBack}
                type="button"
              >
                Back
              </button>
            ) : null}
            {currentStep < 2 ? (
              <button
                className="primary-button"
                disabled={isSubmitting || isEditLoading}
                onClick={handleContinue}
                type="button"
              >
                Continue
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={isSubmitting || isEditLoading}
                onClick={handleSubmit}
                type="button"
              >
                {isSubmitting
                  ? isEditMode
                    ? "Saving…"
                    : "Creating…"
                  : isEditMode
                    ? "Save changes"
                    : "Create lead"}
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (isPartnerMode && submittedLead) {
    return (
      <section className="lead-creation-page">
        <div className="onboarding-card">
          <h1>Lead submitted</h1>
          <p className="page-header__copy">
            <strong>{submittedLead.companyName}</strong> was submitted successfully
            {submittedLead.tenantId ? ` (ID ${submittedLead.tenantId})` : ""}. Sales admin will
            assign a sales executive to create the quote. Track progress from My referrals — you
            cannot create quotes from this portal.
          </p>
          <div className="form-actions" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link className="primary-button" to="/partner/leads">
              View My referrals
            </Link>
            <button className="secondary-button" onClick={resetPartnerForm} type="button">
              Create another lead
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="lead-creation-page">
      {isPartnerMode ? (
        <header className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <p className="eyebrow">Partner portal</p>
            <h1>Lead creation</h1>
            <p className="page-header__copy">
              Create a customer lead with the same details sales uses. After submit, sales admin
              assigns an executive to quote.
            </p>
          </div>
        </header>
      ) : null}
      <div className="onboarding-layout">
        <div
          aria-labelledby="onboarding-title"
          aria-modal="true"
          className={`onboarding-modal onboarding-modal--step-${currentStep}`}
          role="dialog"
        >
          <header className="onboarding-modal__header">
            <div className="onboarding-modal__intro">
              <h1 id="onboarding-title">
                {isEditMode ? "Edit lead" : isPartnerMode ? "Lead creation" : "Company information"}
              </h1>
              <p>
                {currentStep === 1
                  ? "Step 1 of 2 — company profile and primary contact."
                  : "Step 2 of 2 — billing address and workspace admin."}
              </p>
            </div>
            <StepIndicator currentStep={currentStep} />
          </header>

          {stepFieldsForm}

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

        <LeadSummaryPanel currentStep={currentStep} formData={formData} />
      </div>
    </section>
  );
}

function LeadSummaryPanel({ currentStep, formData }) {
  const countryDefaults = getLeadCountryDefaults(formData.country);
  const companyLabel = formData.companyName || "Company not added";
  const industryLabel = industrySummaryLabel(formData);
  const industryMeta = [
    formData.businessType || "Business type pending",
    formData.country || "Country pending",
    formData.companySize || "Size pending",
  ]
    .filter(Boolean)
    .join(" · ");
  const pricingLabel = `${countryDefaults.pricingRegion} · ${countryDefaults.currency}`;
  const pricingMeta = `${countryDefaults.taxLabel} pricing and tax for this lead`;
  const contactLabel = formData.contactName || "Primary contact";
  const designationLabel = formData.designation || "Designation pending";
  const workEmailLabel = formData.workEmail || "Work email pending";
  const mobileLabel = formData.mobileNumber
    ? `${formData.mobileCountryCode} ${formData.mobileNumber}`
    : "Mobile pending";
  const secondaryMobileLabel = String(formData.secondaryMobileNumber || "").trim()
    ? `${formData.secondaryMobileCountryCode} ${formData.secondaryMobileNumber}`
    : "";
  const addressLabel = addressSummaryLabel(formData);

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
            <strong title={companyLabel}>{companyLabel}</strong>
            <small title="Workspace identity">Workspace identity</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Factory size={18} />
          </span>
          <div>
            <strong title={industryLabel}>{industryLabel}</strong>
            <small title={industryMeta}>{industryMeta}</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Factory size={18} />
          </span>
          <div>
            <strong title={pricingLabel}>{pricingLabel}</strong>
            <small title={pricingMeta}>{pricingMeta}</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <UserRound size={18} />
          </span>
          <div>
            <strong title={contactLabel}>{contactLabel}</strong>
            <small title={designationLabel}>{designationLabel}</small>
          </div>
        </div>
        <div className="summary-item summary-item--email">
          <span>
            <Mail size={18} />
          </span>
          <div>
            <strong title={workEmailLabel}>{workEmailLabel}</strong>
            <small title="Workspace administrator">Workspace administrator</small>
          </div>
        </div>
        <div className="summary-item">
          <span>
            <Phone size={18} />
          </span>
          <div>
            <strong title={mobileLabel}>{mobileLabel}</strong>
            <small title="Primary mobile number">Primary mobile number</small>
          </div>
        </div>
        {secondaryMobileLabel ? (
          <div className="summary-item">
            <span>
              <Phone size={18} />
            </span>
            <div>
              <strong title={secondaryMobileLabel}>{secondaryMobileLabel}</strong>
              <small title="Secondary mobile number">Secondary mobile number</small>
            </div>
          </div>
        ) : null}
        {currentStep >= 2 ? (
          <div className="summary-item">
            <span>
              <MapPin size={18} />
            </span>
            <div>
              <strong title={addressLabel}>{addressLabel}</strong>
              <small title="Billing and branch locations">Billing and branch locations</small>
            </div>
          </div>
        ) : null}
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
  error = "",
  label,
  name,
  onChange,
  options,
  placeholder,
  required = false,
  value,
}) {
  return (
    <label className={`field ${error ? "field--invalid" : ""} ${className}`.trim()}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <select
        aria-invalid={Boolean(error)}
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
      {error ? <small className="field__error">{error}</small> : null}
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

function BranchIndustryField({ entry, errors = {}, onChange }) {
  const showCustomInput = entry.industrySelection === INDUSTRY_OTHER;
  const industryError = errors[branchFieldErrorKey(entry.id, "industrySelection")] || "";
  const customError = errors[branchFieldErrorKey(entry.id, "customIndustryType")] || "";

  return (
    <>
      <label className={`field ${industryError ? "field--invalid" : ""}`.trim()}>
        <span>Industry type</span>
        <select
          aria-invalid={Boolean(industryError)}
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
        {industryError ? <small className="field__error">{industryError}</small> : null}
      </label>

      {showCustomInput ? (
        <label className={`field ${customError ? "field--invalid" : ""}`.trim()}>
          <span>Custom industry type</span>
          <input
            aria-invalid={Boolean(customError)}
            onChange={(event) => onChange(entry.id, "customIndustryType", event.target.value)}
            placeholder="Enter industry type"
            type="text"
            value={entry.customIndustryType}
          />
          {customError ? <small className="field__error">{customError}</small> : null}
        </label>
      ) : null}
    </>
  );
}

function BranchMobileField({
  countryCode,
  countryField,
  entryId,
  error = "",
  label,
  numberField,
  numberValue,
  onMobileChange,
  required = false,
}) {
  const dialCode = normalizeLeadDialCode(countryCode);
  const rule = mobileValidationRules[dialCode];
  const validationMessage = mobileValidationMessage(dialCode);

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
    <label className={`field ${error ? "field--invalid" : ""}`.trim()}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <div aria-invalid={Boolean(error)} className="mobile-field">
        <span className="mobile-field__country">
          <span className="mobile-field__flag" aria-hidden="true">
            {rule.flag}
          </span>
          <span className="mobile-field__code">{dialCode}</span>
          <span className="mobile-field__chevron" aria-hidden="true">
            ▾
          </span>
          <select
            aria-label={`${label} country code`}
            onChange={handleCountryChange}
            required={required || Boolean(String(numberValue || "").trim())}
            value={dialCode}
          >
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {mobileValidationRules[code].flag} {code}
              </option>
            ))}
          </select>
        </span>
        <input
          aria-invalid={Boolean(error)}
          inputMode="numeric"
          maxLength={rule.digits}
          minLength={rule.digits}
          onChange={handleNumberChange}
          onInvalid={handleInvalid}
          pattern={mobileInputPattern(dialCode)}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={numberValue}
        />
      </div>
      {error ? <small className="field__error">{error}</small> : null}
    </label>
  );
}

function AdditionalAddressesField({
  addresses,
  defaultCountry,
  error = "",
  fieldErrors = {},
  formData,
  headOfficeTaxLabel = "Tax ID",
  onAdd,
  onApplyProfile,
  onChange,
  onMobileChange,
  onRemove,
  onTaxBlur,
  taxHints = {},
}) {
  return (
    <div className={`address-list field--full ${error ? "field--invalid" : ""}`.trim()}>
      <div className="address-list__header">
        <div>
          <span className="location-section__badge location-section__badge--branch">
            Other branches
          </span>
          <strong className="address-list__title">Branch offices & locations</strong>
          <p className="address-list__hint">
            Same address &amp; billing fields as head office for each branch. Add one section per
            location; use “Copy from…” to reuse a profile, then edit.
          </p>
        </div>
        <button className="secondary-button address-list__add" onClick={onAdd} type="button">
          <Plus size={16} />
          Add branch
        </button>
      </div>

      {error ? <small className="field__error">{error}</small> : null}

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
        const fieldError = (field) => fieldErrors[branchFieldErrorKey(entry.id, field)] || "";
        const taxHint = taxHints[branchFieldErrorKey(entry.id, "taxNumber")];

        return (
          <section className="location-section location-section--branch field--full" key={entry.id}>
            <div className="location-section__header location-section__header--with-action">
              <div className="location-section__header-copy">
                <span className="location-section__badge location-section__badge--branch">
                  Branch {index + 1}
                </span>
                <div>
                  <strong>{branchTitle}</strong>
                  <p className="location-section__subtitle">
                    Country: {branchCountry || "Select below"} ·{" "}
                    {taxDefaults.pricingRegion} ({taxDefaults.currency}) · {taxDefaults.taxLabel}{" "}
                    on quotes
                  </p>
                </div>
              </div>
              <button
                aria-label={`Remove ${branchTitle}`}
                className="address-card__remove"
                onClick={() => onRemove(entry.id)}
                type="button"
              >
                <Trash2 size={16} />
              </button>
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

            <label className="field field--full">
              <span>Branch label</span>
              <input
                onChange={(event) => onChange(entry.id, "label", event.target.value)}
                placeholder="Example: Mumbai branch, London office"
                type="text"
                value={entry.label}
              />
            </label>

            <label
              className={`field field--full ${fieldError("country") ? "field--invalid" : ""}`.trim()}
            >
              <FieldLabel required>Branch country</FieldLabel>
              <select
                aria-invalid={Boolean(fieldError("country"))}
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
              {fieldError("country") ? (
                <small className="field__error">{fieldError("country")}</small>
              ) : null}
            </label>

            <label
              className={`field field--full ${fieldError("address") ? "field--invalid" : ""}`.trim()}
            >
              <FieldLabel required>Branch address</FieldLabel>
              <textarea
                aria-invalid={Boolean(fieldError("address"))}
                onChange={(event) => onChange(entry.id, "address", event.target.value)}
                placeholder="Enter the full address"
                rows="3"
                value={entry.address}
              />
              {fieldError("address") ? (
                <small className="field__error">{fieldError("address")}</small>
              ) : null}
            </label>

            <StateField
              className="field--full"
              country={branchCountry}
              error={fieldError("state")}
              label={`Branch ${getDivisionLabelForCountry(branchCountry)}`}
              onChange={(value) => onChange(entry.id, "state", value)}
              required={
                requiresStateForCountry(branchCountry) ||
                Boolean(String(entry.taxNumber || "").trim())
              }
              value={entry.state || ""}
            />

            <div
              className={`tax-id-field tax-id-field--branch field--full ${
                fieldError("taxNumber") ? "field--invalid" : ""
              }`.trim()}
            >
              <label
                className={`field ${fieldError("taxNumber") ? "field--invalid" : ""}`.trim()}
              >
                <span className="tax-id-field__label">
                  <FieldLabel>Branch {taxDefaults.taxFieldLabel}</FieldLabel>
                </span>
                <TaxNumberInput
                  aria-invalid={Boolean(fieldError("taxNumber"))}
                  maxLength={(entry.country || defaultCountry) === "India" ? 15 : 64}
                  name={`branch-tax-${entry.id}`}
                  onBlur={() => onTaxBlur?.(entry)}
                  onValueChange={(next) => onChange(entry.id, "taxNumber", next)}
                  placeholder={taxDefaults.taxPlaceholder}
                  value={entry.taxNumber || ""}
                />
              </label>
              {fieldError("taxNumber") ? (
                <small className="field__error">{fieldError("taxNumber")}</small>
              ) : taxHint ? (
                <p className="tax-id-field__hint tax-id-field__hint--verified">
                  Verified: {taxHint}
                </p>
              ) : (
                <p className="tax-id-field__hint">
                  Local tax ID for {branchTitle} ({branchCountry || "branch country"}) — not the
                  head office {headOfficeTaxLabel.toLowerCase()}.
                  {branchCountry === "India"
                    ? " India GSTIN must be exactly 15 letters and numbers."
                    : ""}
                </p>
              )}
            </div>

            <div className="branch-profile-block field--full">
              <div className="branch-profile-block__header">
                <strong>Branch profile</strong>
                <p>Same company and contact fields as Basic details for this location.</p>
              </div>

              <div className="branch-profile-grid form-grid">
                <BranchIndustryField entry={entry} errors={fieldErrors} onChange={onChange} />

                <label
                  className={`field ${fieldError("businessType") ? "field--invalid" : ""}`.trim()}
                >
                  <span>Business type</span>
                  <select
                    aria-invalid={Boolean(fieldError("businessType"))}
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
                  {fieldError("businessType") ? (
                    <small className="field__error">{fieldError("businessType")}</small>
                  ) : null}
                </label>

                <label
                  className={`field ${fieldError("companySize") ? "field--invalid" : ""}`.trim()}
                >
                  <span>Company size</span>
                  <select
                    aria-invalid={Boolean(fieldError("companySize"))}
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
                  {fieldError("companySize") ? (
                    <small className="field__error">{fieldError("companySize")}</small>
                  ) : null}
                </label>

                <label
                  className={`field ${fieldError("websiteUrl") ? "field--invalid" : ""}`.trim()}
                >
                  <span>Website URL</span>
                  <input
                    aria-invalid={Boolean(fieldError("websiteUrl"))}
                    onChange={(event) => onChange(entry.id, "websiteUrl", event.target.value)}
                    placeholder="https://example.com"
                    type="url"
                    value={entry.websiteUrl}
                  />
                  {fieldError("websiteUrl") ? (
                    <small className="field__error">{fieldError("websiteUrl")}</small>
                  ) : null}
                </label>

                <label
                  className={`field ${fieldError("contactName") ? "field--invalid" : ""}`.trim()}
                >
                  <span>Contact name</span>
                  <input
                    aria-invalid={Boolean(fieldError("contactName"))}
                    onChange={(event) => onChange(entry.id, "contactName", event.target.value)}
                    type="text"
                    value={entry.contactName}
                  />
                  {fieldError("contactName") ? (
                    <small className="field__error">{fieldError("contactName")}</small>
                  ) : null}
                </label>

                <label
                  className={`field ${fieldError("designation") ? "field--invalid" : ""}`.trim()}
                >
                  <span>Designation</span>
                  <input
                    aria-invalid={Boolean(fieldError("designation"))}
                    onChange={(event) => onChange(entry.id, "designation", event.target.value)}
                    type="text"
                    value={entry.designation}
                  />
                  {fieldError("designation") ? (
                    <small className="field__error">{fieldError("designation")}</small>
                  ) : null}
                </label>

                <label
                  className={`field ${
                    fieldError("workEmail") || fieldError("adminEmail") ? "field--invalid" : ""
                  }`.trim()}
                >
                  <span>Work email</span>
                  <input
                    aria-invalid={Boolean(fieldError("workEmail") || fieldError("adminEmail"))}
                    onChange={(event) => onChange(entry.id, "workEmail", event.target.value)}
                    type="email"
                    value={entry.workEmail}
                  />
                  {fieldError("workEmail") || fieldError("adminEmail") ? (
                    <small className="field__error">
                      {fieldError("workEmail") || fieldError("adminEmail")}
                    </small>
                  ) : null}
                </label>

                <BranchMobileField
                  countryCode={entry.mobileCountryCode}
                  countryField="mobileCountryCode"
                  entryId={entry.id}
                  error={fieldError("mobileNumber")}
                  label="Mobile number"
                  numberField="mobileNumber"
                  numberValue={entry.mobileNumber}
                  onMobileChange={onMobileChange}
                  required
                />

                <BranchMobileField
                  countryCode={entry.secondaryMobileCountryCode}
                  countryField="secondaryMobileCountryCode"
                  entryId={entry.id}
                  error={fieldError("secondaryMobileNumber")}
                  label="Secondary mobile number"
                  numberField="secondaryMobileNumber"
                  numberValue={entry.secondaryMobileNumber}
                  onMobileChange={onMobileChange}
                />
              </div>
            </div>
          </section>
        );
      })}

      {addresses.length ? (
        <button className="secondary-button address-list__add-footer" onClick={onAdd} type="button">
          <Plus size={16} />
          Add another branch
        </button>
      ) : null}
    </div>
  );
}

function IndustryTypeField({ errors = {}, formData, onChange }) {
  const showCustomInput = formData.industrySelection === INDUSTRY_OTHER;

  return (
    <>
      <label className={`field ${errors.industrySelection ? "field--invalid" : ""}`.trim()}>
        <FieldLabel required>Industry Type</FieldLabel>
        <select
          aria-invalid={Boolean(errors.industrySelection)}
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
        {errors.industrySelection ? (
          <small className="field__error">{errors.industrySelection}</small>
        ) : null}
      </label>

      {showCustomInput ? (
        <FormInput
          error={errors.customIndustryType}
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
  error = "",
  label,
  numberField,
  numberValue,
  onChange,
  required = false,
}) {
  const dialCode = normalizeLeadDialCode(countryCode);
  const rule = mobileValidationRules[dialCode];
  const validationMessage = mobileValidationMessage(dialCode);

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
    <label className={`field ${error ? "field--invalid" : ""}`.trim()}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <div aria-invalid={Boolean(error)} className="mobile-field">
        <span className="mobile-field__country">
          <span className="mobile-field__flag" aria-hidden="true">
            {rule.flag}
          </span>
          <span className="mobile-field__code">{dialCode}</span>
          <span className="mobile-field__chevron" aria-hidden="true">
            ▾
          </span>
          <select
            aria-label={`${label} country code`}
            onChange={handleCountryChange}
            required={required || Boolean(String(numberValue || "").trim())}
            value={dialCode}
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
          minLength={required ? rule.digits : undefined}
          name={numberField}
          onChange={handleNumberChange}
          onInvalid={handleInvalid}
          pattern={required || numberValue ? mobileInputPattern(dialCode) : undefined}
          placeholder={`${rule.digits} digits`}
          required={required}
          type="tel"
          value={numberValue}
        />
      </div>
      {error ? <small className="field__error">{error}</small> : null}
    </label>
  );
}

function StateField({
  className = "",
  country,
  error = "",
  label,
  onChange,
  required: requiredOverride,
  value,
}) {
  const stateOptions = getStateOptionsForCountry(country);
  const divisionLabel = getDivisionLabelForCountry(country);
  const required =
    typeof requiredOverride === "boolean"
      ? requiredOverride
      : requiresStateForCountry(country);
  const fieldClassName = `field ${className} ${error ? "field--invalid" : ""}`.trim();

  if (stateOptions) {
    // Keep any previously stored free-text value visible even if it isn't in the curated list.
    const options =
      value && !stateOptions.includes(value) ? [value, ...stateOptions] : stateOptions;
    const selectOptions = [
      { value: "", label: `Select ${divisionLabel.toLowerCase()}` },
      ...options.map((option) => ({ value: option, label: option })),
    ];
    return (
      <label className={fieldClassName}>
        <FieldLabel required={required}>{label}</FieldLabel>
        <AdminFieldSelect
          aria-label={label}
          invalid={Boolean(error)}
          onChange={onChange}
          options={selectOptions}
          placeholder={`Select ${divisionLabel.toLowerCase()}`}
          required={required}
          value={value || ""}
        />
        {error ? <small className="field__error">{error}</small> : null}
      </label>
    );
  }

  return (
    <label className={fieldClassName}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={getDivisionPlaceholderForCountry(country)}
        required={required}
        type="text"
        value={value}
      />
      {error ? <small className="field__error">{error}</small> : null}
    </label>
  );
}

function FormTextarea({
  className = "",
  error = "",
  label,
  name,
  onChange,
  placeholder = "",
  required = false,
  rows = 3,
  value,
}) {
  return (
    <label className={`field ${error ? "field--invalid" : ""} ${className}`.trim()}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <textarea
        aria-invalid={Boolean(error)}
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        value={value}
      />
      {error ? <small className="field__error">{error}</small> : null}
    </label>
  );
}

function FormInput({
  className = "",
  error = "",
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
    <label className={`field ${error ? "field--invalid" : ""} ${className}`.trim()}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        aria-invalid={Boolean(error)}
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        type={type}
        value={value}
      />
      {error ? <small className="field__error">{error}</small> : null}
    </label>
  );
}
