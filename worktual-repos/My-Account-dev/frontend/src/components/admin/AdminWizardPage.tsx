// @ts-nocheck
import { preventEnterFormSubmit } from "../../lib/formEnterKey.js";

export function AdminWizardPage({
  children,
  continueLabel = "Continue",
  currentStep,
  error = "",
  onBack,
  onCancel,
  onContinue,
  onStepSelect,
  steps,
  stepsAriaLabel,
  submitLabel,
  submitting = false,
  submittingLabel,
  title,
}) {
  const activeStep = steps.find((step) => step.id === currentStep) || steps[0];
  const isLastStep = currentStep === steps.length;
  const primaryLabel = isLastStep
    ? submitting
      ? submittingLabel
      : submitLabel
    : continueLabel;

  function handleBack() {
    if (submitting || currentStep <= 1) {
      return;
    }
    if (onBack) {
      onBack();
      return;
    }
    onStepSelect?.(currentStep - 1);
  }

  return (
    <section className="page-stack admin-wizard-page">
      <header className="admin-wizard-page__topbar">
        <div>
          <h1>{title}</h1>
        </div>
        <div className="admin-wizard-page__topbar-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          {currentStep > 1 ? (
            <button
              className="secondary-button"
              disabled={submitting}
              onClick={handleBack}
              type="button"
            >
              Back
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={submitting}
            onClick={onContinue}
            type="button"
          >
            {primaryLabel}
          </button>
        </div>
      </header>

      <div className="admin-wizard-page__shell onboarding-card">
        <nav aria-label={stepsAriaLabel} className="admin-wizard-page__steps">
          <ol>
            {steps.map((step) => (
              <li
                key={step.id}
                className={`admin-wizard-page__step ${
                  step.id === currentStep
                    ? "is-active"
                    : step.id < currentStep
                      ? "is-done is-clickable"
                      : ""
                }`}
                onClick={() => {
                  if (step.id < currentStep) {
                    onStepSelect(step.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (step.id >= currentStep) {
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onStepSelect(step.id);
                  }
                }}
                role={step.id < currentStep ? "button" : undefined}
                tabIndex={step.id < currentStep ? 0 : undefined}
              >
                <span className="admin-wizard-page__step-marker">{step.id}</span>
                <span className="admin-wizard-page__step-label">{step.label}</span>
              </li>
            ))}
          </ol>
        </nav>

        <div className="admin-wizard-page__panel">
          <header className="admin-wizard-page__panel-heading">
            <h2>
              {currentStep}. {activeStep.heading}
            </h2>
          </header>

          <form
            className="form-grid admin-wizard-page__form"
            noValidate
            onKeyDown={preventEnterFormSubmit}
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {error ? (
              <p className="admin-users-form__inline-error field--full" role="alert">
                {error}
              </p>
            ) : null}
            {children}
          </form>
        </div>
      </div>
    </section>
  );
}
