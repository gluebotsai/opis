// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Handshake, X } from "lucide-react";

import { emptyPartnerForm, partnerToFormValues } from "./PartnerForm.tsx";
import {
  PARTNER_WIZARD_STEPS,
  PartnerWizardStepFields,
  validatePartnerWizardStep,
} from "./partnerWizard.tsx";
import {
  fetchAdminPartnerBankAccount,
  saveAdminPartnerBankAccount,
} from "../../lib/commissions.js";
import { applyCountryDefaultsToLeadForm } from "../../lib/countryDefaults.js";
import {
  createManagedPartner,
  updateManagedPartner,
  validateManagedPartnerContacts,
} from "../../lib/partners.js";
import { validatePasswordPolicy } from "../../lib/passwordPolicy.js";
import { SideOverlayDraftIsland } from "../SideOverlayDraftIsland.tsx";
import { useSideOverlayDraftDismiss } from "../../hooks/useSideOverlayDraftDismiss.js";
import {
  isPartnerCreateFormEmpty,
  isPartnerEditFormDirty,
} from "../../lib/sideOverlayFormDraft.js";

function partnerPayloadFromForm(form) {
  const workEmail = String(form.workEmail || "").trim();
  return {
    ...form,
    loginEmail: workEmail,
    workEmail,
  };
}

function hasBankDetailsToSave(form) {
  return [
    form.accountHolderName,
    form.bankName,
    form.accountNumber,
    form.ifscOrRouting,
    form.branchName,
  ].some((value) => String(value || "").trim());
}

/** Map known partner create/update API messages onto wizard fields (AdminUsers-style). */
function mapPartnerSubmitError(message, { isEdit = false } = {}) {
  const text = String(message || "").trim();
  const fallback = isEdit ? "Could not update partner." : "Could not create partner.";
  if (!text) {
    return { field: null, message: fallback, step: null };
  }

  if (
    /mobile number|phone|country code/i.test(text) &&
    (/already|exists|used/i.test(text) ||
      /required|exactly|start with|invalid|select a country/i.test(text))
  ) {
    return { field: "mobileNumber", message: text, step: 2 };
  }
  if (
    (/work email|email/i.test(text) || /already used by a (partner|reseller|staff|customer)/i.test(text)) &&
    /already|exists|used/i.test(text) &&
    !/mobile|phone/i.test(text)
  ) {
    return { field: "workEmail", message: text, step: 2 };
  }
  if (/password/i.test(text)) {
    return { field: "password", message: text, step: 3 };
  }

  return { field: null, message: text, step: null };
}

/**
 * Create / Edit partner — right side overlay with step status.
 * Create: Details → Contact → Portal (3 steps).
 * Edit: Details → Contact → Portal → Bank (4 steps), prefilled.
 */
export function PartnerCreateOverlay({ onClose, onCreated, onUpdated, partner = null }) {
  const isEdit = Boolean(partner?.id);
  const steps = isEdit ? PARTNER_WIZARD_STEPS.edit : PARTNER_WIZARD_STEPS.create;
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState(() =>
    isEdit ? partnerToFormValues(partner) : { ...emptyPartnerForm },
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [checkingContacts, setCheckingContacts] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [minimized, setMinimized] = useState(false);
  const [formBaseline, setFormBaseline] = useState(null);

  const isLastStep = currentStep === steps.length;
  const activeStep = steps.find((step) => step.id === currentStep) || steps[0];
  const title = isEdit ? "Edit partner" : "Create partner";

  const isOverlayDirty = useCallback(() => {
    if (isEdit) {
      return isPartnerEditFormDirty(form, formBaseline);
    }
    return !isPartnerCreateFormEmpty(form);
  }, [form, formBaseline, isEdit]);

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    isBusy: submitting || loading || checkingContacts,
    isDirty: isOverlayDirty,
    minimized,
    onClose,
    onExpand: () => setMinimized(false),
    onMinimize: () => setMinimized(true),
  });

  useEffect(() => {
    if (!isEdit) {
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    fetchAdminPartnerBankAccount(partner.id)
      .then((bankAccount) => {
        if (!cancelled) {
          const nextForm = partnerToFormValues(partner, bankAccount);
          setForm(nextForm);
          setFormBaseline(nextForm);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load partner bank details.",
          );
          const nextForm = partnerToFormValues(partner);
          setForm(nextForm);
          setFormBaseline(nextForm);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isEdit, partner]);

  useEffect(() => {
    if (isEdit) {
      return;
    }
    setFormBaseline({ ...emptyPartnerForm });
  }, [isEdit]);

  function updateField(field, value) {
    const isPatch = typeof field === "object" && field !== null && !Array.isArray(field);

    setForm((current) => {
      if (isPatch) {
        return { ...current, ...field };
      }
      if (field === "country") {
        return applyCountryDefaultsToLeadForm({ ...current, country: value }, value);
      }
      return { ...current, [field]: value };
    });
    setError("");
    setFieldErrors((current) => {
      const keysToClear = isPatch ? Object.keys(field) : [field];
      const hasMatch = keysToClear.some((key) => current[key]);
      if (!hasMatch) {
        return current;
      }
      const next = { ...current };
      keysToClear.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }

  function selectStep(stepId) {
    if (stepId >= currentStep || submitting || loading || checkingContacts) {
      return;
    }
    setCurrentStep(stepId);
    setError("");
    setFieldErrors({});
  }

  async function handleContinue() {
    if (loading || checkingContacts) {
      return;
    }

    const validationError = validatePartnerWizardStep(currentStep, form, { isEdit });
    if (validationError) {
      setFieldErrors({ [validationError.field]: validationError.message });
      setError("");
      return;
    }

    if (!isLastStep) {
      if (currentStep === 2) {
        setCheckingContacts(true);
        setFieldErrors({});
        setError("");
        try {
          await validateManagedPartnerContacts({
            workEmail: form.workEmail,
            loginEmail: form.workEmail,
            mobileCountryCode: form.mobileCountryCode,
            mobileNumber: form.mobileNumber,
            partnerId: isEdit ? partner.id : null,
          });
        } catch (checkError) {
          const mapped = mapPartnerSubmitError(
            checkError instanceof Error ? checkError.message : "",
            { isEdit },
          );
          if (mapped.field) {
            setFieldErrors({ [mapped.field]: mapped.message });
            setError("");
          } else {
            setFieldErrors({});
            setError(mapped.message);
          }
          return;
        } finally {
          setCheckingContacts(false);
        }
      }
      setFieldErrors({});
      setCurrentStep((step) => step + 1);
      return;
    }

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      if (isEdit) {
        if (form.password) {
          try {
            validatePasswordPolicy(form.password);
          } catch (passwordError) {
            setFieldErrors({
              password: passwordError instanceof Error ? passwordError.message : "Invalid password.",
            });
            return;
          }
        }
        await updateManagedPartner(partner.id, partnerPayloadFromForm(form));
        if (hasBankDetailsToSave(form)) {
          await saveAdminPartnerBankAccount(partner.id, {
            accountHolderName: form.accountHolderName,
            bankName: form.bankName,
            accountNumber: form.accountNumber,
            ifscOrRouting: form.ifscOrRouting,
            branchName: form.branchName,
          });
        }
        onUpdated?.("Partner updated.");
        return;
      }

      try {
        validatePasswordPolicy(form.password);
      } catch (passwordError) {
        setFieldErrors({
          password: passwordError instanceof Error ? passwordError.message : "Invalid password.",
        });
        return;
      }

      const result = await createManagedPartner(partnerPayloadFromForm(form));
      if (result?.emailSent) {
        onCreated?.("Partner created and welcome email sent.");
      } else {
        const detail =
          result?.emailError ||
          "Welcome email could not be sent. Connect the admin Outlook mailbox or check ADMIN_EMAIL / MAIL_DRY_RUN.";
        onCreated?.("Partner created.", detail);
      }
    } catch (submitError) {
      const mapped = mapPartnerSubmitError(
        submitError instanceof Error ? submitError.message : "",
        { isEdit },
      );
      if (mapped.field) {
        setFieldErrors({ [mapped.field]: mapped.message });
        setError("");
        if (mapped.step) {
          setCurrentStep(mapped.step);
        }
      } else {
        setFieldErrors({});
        setError(mapped.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (minimized) {
    if (!isOverlayDirty()) {
      return null;
    }

    return (
      <SideOverlayDraftIsland
        badge={currentStep}
        draftKind={isEdit ? "edit" : "create"}
        icon={Handshake}
        label={form.companyName.trim() || title}
        onDiscard={discardDraft}
        onOpen={expandDraft}
      />
    );
  }

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="admin-side-overlay"
      role="dialog"
    >
      <button
        aria-label={`Minimize ${title.toLowerCase()} to draft`}
        className="admin-side-overlay__backdrop"
        disabled={submitting}
        onClick={requestDismiss}
        type="button"
      />
      <section className="admin-side-overlay__panel admin-side-overlay__panel--wide admin-side-overlay__panel--with-steps">
        <header className="admin-side-overlay__header">
          <div>
            <h2>{title}</h2>
            <p>{loading ? "Loading partner…" : activeStep.heading}</p>
          </div>
          <button
            aria-label="Close"
            className="admin-users-panel__icon-button"
            disabled={submitting}
            onClick={requestDismiss}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <nav
          aria-label={isEdit ? "Partner edit steps" : "Partner creation steps"}
          className="admin-overlay-steps"
        >
          <ol className="admin-overlay-steps__list">
            {steps.map((step, index) => {
              const status =
                step.id === currentStep ? "active" : step.id < currentStep ? "done" : "upcoming";
              const clickable = step.id < currentStep && !submitting && !loading;

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
                    onClick={() => selectStep(step.id)}
                    type="button"
                  >
                    <span className="admin-overlay-steps__marker">
                      {status === "done" ? "✓" : step.id}
                    </span>
                    <span className="admin-overlay-steps__label">{step.label}</span>
                  </button>
                  {index < steps.length - 1 ? (
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

        <div className="admin-side-overlay__body admin-partner-create-overlay__body">
          {error ? (
            <p className="admin-users-form__inline-error" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="page-header__copy">Loading partner…</p>
          ) : (
            <div className="form-grid admin-partner-create-overlay__fields">
              <PartnerWizardStepFields
                fieldErrors={fieldErrors}
                form={form}
                isEdit={isEdit}
                step={currentStep}
                updateField={updateField}
              />
            </div>
          )}
        </div>

        <div className="admin-side-overlay__footer">
          <button
            className="secondary-button"
            disabled={submitting || checkingContacts}
            onClick={requestDismiss}
            type="button"
          >
            Cancel
          </button>
          {currentStep > 1 ? (
            <button
              className="secondary-button"
              disabled={submitting || loading || checkingContacts}
              onClick={() => {
                setCurrentStep((step) => Math.max(1, step - 1));
                setError("");
                setFieldErrors({});
              }}
              type="button"
            >
              Back
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={submitting || loading || checkingContacts}
            onClick={() => void handleContinue()}
            type="button"
          >
            {checkingContacts
              ? "Checking…"
              : submitting
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isLastStep
                  ? isEdit
                    ? "Save changes"
                    : "Create partner"
                  : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
