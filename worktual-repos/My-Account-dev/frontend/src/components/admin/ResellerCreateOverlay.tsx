// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Store, X } from "lucide-react";

import { emptyResellerForm, resellerToFormValues } from "./ResellerForm.tsx";
import {
  RESELLER_WIZARD_STEPS,
  ResellerWizardStepFields,
  validateResellerWizardStep,
} from "./resellerWizard.tsx";
import { applyCountryDefaultsToLeadForm } from "../../lib/countryDefaults.js";
import { createManagedReseller, updateManagedReseller } from "../../lib/resellers.js";
import { validatePasswordPolicy } from "../../lib/passwordPolicy.js";
import { SideOverlayDraftIsland } from "../SideOverlayDraftIsland.tsx";
import { useSideOverlayDraftDismiss } from "../../hooks/useSideOverlayDraftDismiss.js";
import {
  isResellerCreateFormEmpty,
  isResellerEditFormDirty,
} from "../../lib/sideOverlayFormDraft.js";

/**
 * Create / Edit reseller — right side overlay with step status.
 * Create & Edit: Details → Contact → Billing → Portal access (4 steps).
 * Edit opens prefilled; password optional.
 */
export function ResellerCreateOverlay({ onClose, onCreated, onUpdated, reseller = null }) {
  const isEdit = Boolean(reseller?.id);
  const steps = isEdit ? RESELLER_WIZARD_STEPS.edit : RESELLER_WIZARD_STEPS.create;
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState(() =>
    isEdit ? resellerToFormValues(reseller) : { ...emptyResellerForm },
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [formBaseline, setFormBaseline] = useState(null);

  const isLastStep = currentStep === steps.length;
  const activeStep = steps.find((step) => step.id === currentStep) || steps[0];
  const title = isEdit ? "Edit reseller" : "Create reseller";

  const isOverlayDirty = useCallback(() => {
    if (isEdit) {
      return isResellerEditFormDirty(form, formBaseline);
    }
    return !isResellerCreateFormEmpty(form);
  }, [form, formBaseline, isEdit]);

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    isBusy: submitting,
    isDirty: isOverlayDirty,
    minimized,
    onClose,
    onExpand: () => setMinimized(false),
    onMinimize: () => setMinimized(true),
  });

  useEffect(() => {
    if (!isEdit) {
      setFormBaseline({ ...emptyResellerForm });
      return;
    }
    const nextForm = resellerToFormValues(reseller);
    setForm(nextForm);
    setFormBaseline(nextForm);
    setCurrentStep(1);
    setError("");
    setFieldErrors({});
  }, [isEdit, reseller]);

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
    if (stepId >= currentStep || submitting) {
      return;
    }
    setCurrentStep(stepId);
    setError("");
    setFieldErrors({});
  }

  async function handleContinue() {
    const validationError = validateResellerWizardStep(currentStep, form, { isEdit });
    if (validationError) {
      setFieldErrors({ [validationError.field]: validationError.message });
      setError("");
      return;
    }

    if (!isLastStep) {
      setFieldErrors({});
      setCurrentStep((step) => step + 1);
      return;
    }

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    const payload = {
      ...form,
      invoiceCcEmails: String(form.invoiceCcEmails || "")
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      portalIsActive: form.isActive,
    };

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
        await updateManagedReseller(reseller.id, payload);
        onUpdated?.("Reseller updated.");
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

      const result = await createManagedReseller(payload);
      if (result?.emailSent) {
        onCreated?.("Reseller created and welcome email sent.");
      } else {
        const detail =
          result?.emailError ||
          "Welcome email could not be sent. Connect the admin Outlook mailbox or check ADMIN_EMAIL / MAIL_DRY_RUN.";
        onCreated?.("Reseller created.", detail);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : isEdit
            ? "Could not update reseller."
            : "Could not create reseller.",
      );
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
        icon={Store}
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
            <p>{activeStep.heading}</p>
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
          aria-label={isEdit ? "Reseller edit steps" : "Reseller creation steps"}
          className="admin-overlay-steps"
        >
          <ol className="admin-overlay-steps__list">
            {steps.map((step, index) => {
              const status =
                step.id === currentStep ? "active" : step.id < currentStep ? "done" : "upcoming";
              const clickable = step.id < currentStep && !submitting;

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

        <div className="admin-side-overlay__body admin-reseller-create-overlay__body">
          {error ? (
            <p className="admin-users-form__inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-grid admin-reseller-create-overlay__fields">
            <ResellerWizardStepFields
              fieldErrors={fieldErrors}
              form={form}
              isEdit={isEdit}
              step={currentStep}
              updateField={updateField}
            />
          </div>
        </div>

        <div className="admin-side-overlay__footer">
          <button className="secondary-button" disabled={submitting} onClick={requestDismiss} type="button">
            Cancel
          </button>
          {currentStep > 1 ? (
            <button
              className="secondary-button"
              disabled={submitting}
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
            disabled={submitting}
            onClick={() => void handleContinue()}
            type="button"
          >
            {submitting
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isLastStep
                ? isEdit
                  ? "Save changes"
                  : "Create reseller"
                : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
