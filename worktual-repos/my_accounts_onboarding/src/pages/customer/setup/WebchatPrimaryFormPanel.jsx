import { useEffect, useMemo, useState } from "react";
import {
  GripVertical,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { getCustomerToken } from "../../../lib/customerAuth.js";
import { getAuthToken } from "../../../lib/auth.js";
import {
  BOT_AVATAR_PRESETS,
  DEFAULT_PRIMARY_FORM,
  backgroundPatternStyle,
  cornerRadiusPx,
  ensureWebchatFontLoaded,
  fabBackground,
  headerBackground,
  normalizePrimaryForm,
  webchatFontFamily,
} from "./webchatPersonalisation.js";

function authToken() {
  return getAuthToken() || getCustomerToken() || "";
}

function AuthImage({ src, alt, className }) {
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    let revoked = false;
    let objectUrl = "";

    async function load() {
      if (!src) {
        setBlobUrl("");
        return;
      }
      if (src.startsWith("blob:") || src.startsWith("data:")) {
        setBlobUrl(src);
        return;
      }
      try {
        const response = await fetch(src, {
          headers: { Authorization: `Bearer ${authToken()}` },
        });
        if (!response.ok) throw new Error("Failed to load image");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setBlobUrl(objectUrl);
      } catch {
        if (!revoked) setBlobUrl("");
      }
    }

    load();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!blobUrl) {
    return (
      <span
        aria-hidden="true"
        className={`webchat-auth-image-fallback ${className || ""}`.trim()}
      />
    );
  }
  return <img alt={alt || ""} className={className} src={blobUrl} />;
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`webchat-switch${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function FeatureCard({ title, description, checked, onChange, children }) {
  return (
    <section className={`webchat-pf-card${checked ? " is-active" : ""}`}>
      <div className="webchat-pf-card__head">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <Switch checked={checked} label={title} onChange={onChange} />
      </div>
      {checked && children ? <div className="webchat-pf-card__body">{children}</div> : null}
    </section>
  );
}

function FormRow({ label, required, children }) {
  return (
    <div className="webchat-pf-row">
      <div className="webchat-pf-row__label">
        {label}
        {required ? <span className="webchat-pf-required">*</span> : null}
      </div>
      <div className="webchat-pf-row__control">{children}</div>
    </div>
  );
}

function PrimaryFormPreview({ form, personalisation, primaryForm }) {
  const p = personalisation;
  const pf = primaryForm;
  const radius = cornerRadiusPx(p.roundedCorners);
  const title = form.title.trim() || "Sample";
  const subtitle = form.aliasTitle.trim() || "AI assistant";
  const preset = BOT_AVATAR_PRESETS.find((item) => item.id === p.botAvatarPreset);
  const alignEnd = p.position !== "bottom_left";
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState("auto");

  useEffect(() => {
    ensureWebchatFontLoaded(p.fontStyle);
  }, [p.fontStyle]);

  useEffect(() => {
    setStage("auto");
  }, [pf.consentEnabled, pf.prechatEnabled]);

  const fontFamily = webchatFontFamily(p.fontStyle);
  const avatarIsCustom = Boolean(p.botAvatarUrl) || p.botAvatarPreset === "custom";
  const avatarShapeClass = `webchat-preview-bot-icon webchat-preview-bot-icon--avatar${
    p.chatIconShape === "square" ? " is-square" : ""
  }`;

  const resolvedStage = useMemo(() => {
    if (stage === "chat") return "chat";
    if (stage === "prechat") return pf.prechatEnabled ? "prechat" : "chat";
    if (stage === "opted_out") return "opted_out";
    if (pf.consentEnabled) return "consent";
    if (pf.prechatEnabled) return "prechat";
    return "chat";
  }, [stage, pf.consentEnabled, pf.prechatEnabled]);

  function renderBotAvatar() {
    return (
      <div
        className={avatarShapeClass}
        style={{
          background: avatarIsCustom ? "transparent" : preset?.color || "#F97316",
        }}
      >
        {p.botAvatarUrl ? (
          <AuthImage alt="" className="webchat-preview-bot-avatar-img" src={p.botAvatarUrl} />
        ) : (
          <MessageCircle size={14} color="#fff" />
        )}
      </div>
    );
  }

  const bodyStyle = {
    ...backgroundPatternStyle(p.chatBackgroundPattern),
    fontFamily,
  };

  return (
    <aside className="webchat-preview-panel" aria-label="Widget preview">
      <div
        className={`webchat-preview-frame webchat-preview-frame--personal${alignEnd ? " is-right" : " is-left"}`}
      >
        {open ? (
          <div
            className="webchat-preview-widget webchat-preview-widget--personal"
            style={{ borderRadius: radius, fontFamily }}
          >
            <header
              className="webchat-preview-header webchat-preview-header--personal"
              style={{ background: headerBackground(p), borderRadius: `${radius}px ${radius}px 0 0` }}
            >
              <div className="webchat-preview-avatar webchat-preview-avatar--img">
                {p.chatIconLogoUrl || p.widgetIconLogoUrl ? (
                  <AuthImage alt="" src={p.chatIconLogoUrl || p.widgetIconLogoUrl} />
                ) : null}
              </div>
              <div className="webchat-preview-header__text">
                <strong>{title}</strong>
                <span>{subtitle}</span>
              </div>
              <div className="webchat-preview-header__actions">
                <button aria-label="Minimize chat" className="webchat-preview-header-btn" type="button">
                  <Minus size={14} />
                </button>
                <button
                  aria-label="Close chat"
                  className="webchat-preview-header-btn"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            </header>

            <div
              className={`webchat-preview-body webchat-preview-body--personal webchat-pf-preview-body${
                resolvedStage !== "chat" ? " is-form" : ""
              }`}
              style={bodyStyle}
            >
              {resolvedStage === "consent" ? (
                <div className="webchat-pf-preview-consent">
                  <h4>Data Privacy Bot</h4>
                  <p>{pf.consentMessage || DEFAULT_PRIMARY_FORM.consentMessage}</p>
                  {pf.privacyPolicyUrl ? (
                    <a href={pf.privacyPolicyUrl} onClick={(e) => e.preventDefault()} rel="noreferrer">
                      {pf.privacyPolicyLinkText || "View our Privacy Policy"}
                    </a>
                  ) : null}
                  <div className="webchat-pf-preview-consent__actions">
                    <button
                      className="webchat-pf-preview-btn webchat-pf-preview-btn--primary"
                      onClick={() => setStage(pf.prechatEnabled ? "prechat" : "chat")}
                      type="button"
                    >
                      {pf.optInButton || "Yes, I agree"}
                    </button>
                    <button
                      className="webchat-pf-preview-btn"
                      onClick={() => setStage("opted_out")}
                      type="button"
                    >
                      {pf.optOutButton || "No, not now"}
                    </button>
                  </div>
                </div>
              ) : null}

              {resolvedStage === "opted_out" ? (
                <div className="webchat-pf-preview-consent">
                  <p>{pf.optOutConfirmation || DEFAULT_PRIMARY_FORM.optOutConfirmation}</p>
                  <button
                    className="webchat-pf-preview-btn webchat-pf-preview-btn--primary"
                    onClick={() => setStage("consent")}
                    type="button"
                  >
                    Back
                  </button>
                </div>
              ) : null}

              {resolvedStage === "prechat" ? (
                <div
                  className={`webchat-pf-preview-prechat${
                    pf.prechatTitleLayout === "inline" ? " is-inline" : ""
                  }`}
                >
                  <h4>{pf.prechatTitle || "Hello! Let's get started"}</h4>
                  {pf.prechatMessage ? <p>{pf.prechatMessage}</p> : null}
                  <div className="webchat-pf-preview-fields">
                    {(pf.customFields || []).map((field) => (
                      <label key={field.id}>
                        <span>
                          {field.label}
                          {field.mandatory ? "*" : ""}
                        </span>
                        <input disabled placeholder={field.label} type="text" />
                      </label>
                    ))}
                  </div>
                  <button
                    className="webchat-pf-preview-btn webchat-pf-preview-btn--primary webchat-pf-preview-btn--block"
                    onClick={() => setStage("chat")}
                    style={{ background: pf.prechatButtonBg || "#000" }}
                    type="button"
                  >
                    {pf.prechatButtonLabel || "Start Conversation"}
                  </button>
                </div>
              ) : null}

              {resolvedStage === "chat" ? (
                <>
                  <div className="webchat-preview-bot-row">
                    {renderBotAvatar()}
                    <div
                      className="webchat-preview-bubble webchat-preview-bubble--rich"
                      dangerouslySetInnerHTML={{
                        __html: form.greetingMessage?.trim() || "<p>hola amigo!!</p>",
                      }}
                      style={{ background: p.agentMessageColour }}
                    />
                  </div>
                  <div className="webchat-preview-user-row">
                    <div
                      className="webchat-preview-bubble webchat-preview-bubble--user"
                      style={{ background: p.customerMessageColour }}
                    >
                      Hello
                    </div>
                  </div>
                  <div className="webchat-preview-bot-row">
                    {renderBotAvatar()}
                    <div className="webchat-preview-options" style={{ background: p.agentMessageColour }}>
                      <p>Select your options</p>
                      {["Location 📍", "Book appointment 📅", "Service 💁‍♀️"].map((label) => (
                        <button
                          key={label}
                          style={{ borderColor: p.actionMessageColour, color: p.actionMessageColour }}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="webchat-preview-composer">
              {resolvedStage === "chat" ? (
                <input disabled placeholder="Type your message here" type="text" />
              ) : (
                <div className="webchat-pf-preview-composer-spacer" />
              )}
              <p className="webchat-preview-powered">
                Powered by <strong>Worktual</strong>
              </p>
            </div>
          </div>
        ) : null}

        <div className={`webchat-preview-launcher${alignEnd ? "" : " is-left"}`}>
          {!open ? (
            <button
              aria-label="Open chat"
              className={`webchat-preview-fab${p.chatIconShape === "square" ? " is-square" : ""}`}
              onClick={() => setOpen(true)}
              style={{ background: fabBackground(p) }}
              type="button"
            >
              <MessageCircle size={22} />
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function WebchatPrimaryFormPanel({
  form,
  personalisation,
  onChangePrimaryForm,
  onCancel,
  onSave,
  onNext,
  saving,
  error,
}) {
  const pf = normalizePrimaryForm(personalisation?.primaryForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [dragIndex, setDragIndex] = useState(null);

  function patch(partial) {
    onChangePrimaryForm({ ...pf, ...partial });
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(partial)) delete next[key];
      return next;
    });
  }

  function updateField(index, partial) {
    const customFields = pf.customFields.map((field, i) =>
      i === index ? { ...field, ...partial } : field,
    );
    patch({ customFields });
  }

  function addField() {
    const id = `field_${Date.now()}`;
    patch({
      customFields: [...pf.customFields, { id, label: "New field", mandatory: false }],
    });
  }

  function removeField(index) {
    if (pf.customFields.length <= 1) return;
    patch({ customFields: pf.customFields.filter((_, i) => i !== index) });
  }

  function moveField(from, to) {
    if (to < 0 || to >= pf.customFields.length || from === to) return;
    const next = [...pf.customFields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    patch({ customFields: next });
  }

  function validate() {
    const next = {};
    if (pf.consentEnabled) {
      if (!String(pf.consentMessage || "").trim()) {
        next.consentMessage = "Consent message is required.";
      }
      if (!String(pf.privacyPolicyUrl || "").trim()) {
        next.privacyPolicyUrl = "Privacy policy link is required.";
      } else if (!/^https?:\/\//i.test(String(pf.privacyPolicyUrl).trim())) {
        next.privacyPolicyUrl = "Enter a valid URL starting with http:// or https://.";
      }
      if (!String(pf.privacyPolicyLinkText || "").trim()) {
        next.privacyPolicyLinkText = "Link text is required.";
      }
      if (!String(pf.optInButton || "").trim()) next.optInButton = "Opt-in button is required.";
      if (!String(pf.optOutButton || "").trim()) next.optOutButton = "Opt-out button is required.";
    }
    if (pf.prechatEnabled) {
      if (!String(pf.prechatTitle || "").trim()) next.prechatTitle = "Primary form title is required.";
      if (!String(pf.prechatButtonLabel || "").trim()) {
        next.prechatButtonLabel = "Button label is required.";
      }
      if (!pf.customFields.some((field) => String(field.label || "").trim())) {
        next.customFields = "Add at least one custom field.";
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleNext() {
    if (!validate()) return;
    await onNext();
  }

  async function handleSave() {
    if (!validate()) return;
    await onSave();
  }

  return (
    <div className="webchat-basic-layout webchat-personal-layout">
      <div className="webchat-basic-form webchat-personal-form">
        <div className="setup-step-body">
          <div className="webchat-personal-intro">
            <div>
              <h2>Primary Form</h2>
              <p>
                Capture consent and lead details before the chat starts. Changes update the live
                preview instantly.
              </p>
            </div>
          </div>

          {error ? <p className="setup-inline-error">{error}</p> : null}

          <FeatureCard
            checked={pf.consentEnabled}
            description="Enable privacy consent form in the widget, letting visitors give their approval before chatting with the bot for added privacy and transparency."
            onChange={(consentEnabled) => patch({ consentEnabled })}
            title="Consent Form"
          >
            <FormRow label="Consent form language">
              <div className="webchat-pf-radios">
                <label>
                  <input
                    checked={pf.consentLanguage === "widget"}
                    name="consentLanguage"
                    onChange={() => patch({ consentLanguage: "widget" })}
                    type="radio"
                  />
                  Widget language
                </label>
                <label>
                  <input
                    checked={pf.consentLanguage === "browser"}
                    name="consentLanguage"
                    onChange={() => patch({ consentLanguage: "browser" })}
                    type="radio"
                  />
                  Visitor&apos;s browser language
                </label>
              </div>
            </FormRow>

            <FormRow label="Consent message" required>
              <textarea
                onChange={(event) => patch({ consentMessage: event.target.value })}
                rows={5}
                value={pf.consentMessage}
              />
              {fieldErrors.consentMessage ? (
                <p className="setup-field-error">{fieldErrors.consentMessage}</p>
              ) : null}
            </FormRow>

            <FormRow label="Privacy policy link" required>
              <input
                onChange={(event) => patch({ privacyPolicyUrl: event.target.value })}
                placeholder="https://www.example.com/privacy"
                type="url"
                value={pf.privacyPolicyUrl}
              />
              {fieldErrors.privacyPolicyUrl ? (
                <p className="setup-field-error">{fieldErrors.privacyPolicyUrl}</p>
              ) : null}
            </FormRow>

            <FormRow label="Privacy policy link Text">
              <input
                onChange={(event) => patch({ privacyPolicyLinkText: event.target.value })}
                value={pf.privacyPolicyLinkText}
              />
              {fieldErrors.privacyPolicyLinkText ? (
                <p className="setup-field-error">{fieldErrors.privacyPolicyLinkText}</p>
              ) : null}
            </FormRow>

            <FormRow label="Opt-in button">
              <input
                onChange={(event) => patch({ optInButton: event.target.value })}
                value={pf.optInButton}
              />
              {fieldErrors.optInButton ? (
                <p className="setup-field-error">{fieldErrors.optInButton}</p>
              ) : null}
            </FormRow>

            <FormRow label="Opt-out button">
              <input
                onChange={(event) => patch({ optOutButton: event.target.value })}
                value={pf.optOutButton}
              />
              {fieldErrors.optOutButton ? (
                <p className="setup-field-error">{fieldErrors.optOutButton}</p>
              ) : null}
            </FormRow>

            <FormRow label="Opt-out confirmation">
              <textarea
                onChange={(event) => patch({ optOutConfirmation: event.target.value })}
                rows={3}
                value={pf.optOutConfirmation}
              />
            </FormRow>
          </FeatureCard>

          <FeatureCard
            checked={pf.prechatEnabled}
            description={
              <>
                Leads can be sent to your email or connected CRM. You can set this up via Settings
                {" > "}
                <span className="webchat-pf-inline-link">Lead generation</span>.
              </>
            }
            onChange={(prechatEnabled) => patch({ prechatEnabled })}
            title="Enable pre-chat form to capture leads"
          >
            <FormRow label="Primary form title" required>
              <input
                onChange={(event) => patch({ prechatTitle: event.target.value })}
                value={pf.prechatTitle}
              />
              {fieldErrors.prechatTitle ? (
                <p className="setup-field-error">{fieldErrors.prechatTitle}</p>
              ) : null}
            </FormRow>

            <FormRow label="Primary form message">
              <textarea
                onChange={(event) => patch({ prechatMessage: event.target.value })}
                rows={3}
                value={pf.prechatMessage}
              />
            </FormRow>

            <FormRow label="Button label">
              <input
                onChange={(event) => patch({ prechatButtonLabel: event.target.value })}
                value={pf.prechatButtonLabel}
              />
              {fieldErrors.prechatButtonLabel ? (
                <p className="setup-field-error">{fieldErrors.prechatButtonLabel}</p>
              ) : null}
            </FormRow>

            <FormRow label="Primary button BG colour">
              <div className="webchat-colour-field__row">
                <input
                  onChange={(event) => patch({ prechatButtonBg: event.target.value })}
                  placeholder="#000000"
                  type="text"
                  value={pf.prechatButtonBg}
                />
                <input
                  aria-label="Primary button colour swatch"
                  className="webchat-colour-swatch"
                  onChange={(event) =>
                    patch({ prechatButtonBg: event.target.value.toUpperCase() })
                  }
                  type="color"
                  value={
                    /^#[0-9A-Fa-f]{6}$/.test(pf.prechatButtonBg) ? pf.prechatButtonBg : "#000000"
                  }
                />
              </div>
            </FormRow>

            <FormRow label="Title">
              <div className="webchat-pf-radios">
                <label>
                  <input
                    checked={pf.prechatTitleLayout === "block"}
                    name="prechatTitleLayout"
                    onChange={() => patch({ prechatTitleLayout: "block" })}
                    type="radio"
                  />
                  Block
                </label>
                <label>
                  <input
                    checked={pf.prechatTitleLayout === "inline"}
                    name="prechatTitleLayout"
                    onChange={() => patch({ prechatTitleLayout: "inline" })}
                    type="radio"
                  />
                  Inline
                </label>
              </div>
            </FormRow>

            <div className="webchat-pf-fields">
              <div className="webchat-pf-fields__head">
                <div>
                  <h4>Custom Fields</h4>
                  <p>
                    Map visitor details to contact properties. Manage defaults in{" "}
                    <span className="webchat-pf-inline-link">Contact settings</span>.
                  </p>
                </div>
                <button className="secondary-button webchat-pf-add-field" onClick={addField} type="button">
                  <Plus size={14} />
                  Add field
                </button>
              </div>

              {fieldErrors.customFields ? (
                <p className="setup-field-error">{fieldErrors.customFields}</p>
              ) : null}

              <ul className="webchat-pf-field-list">
                {pf.customFields.map((field, index) => (
                  <li
                    className={`webchat-pf-field-row${dragIndex === index ? " is-dragging" : ""}`}
                    draggable
                    key={field.id}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={() => setDragIndex(index)}
                    onDrop={() => {
                      if (dragIndex !== null) moveField(dragIndex, index);
                      setDragIndex(null);
                    }}
                  >
                    <span aria-hidden="true" className="webchat-pf-field-row__grip">
                      <GripVertical size={16} />
                    </span>
                    <input
                      aria-label={`Field ${index + 1} label`}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      value={field.label}
                    />
                    <label className="webchat-pf-mandatory">
                      <input
                        checked={Boolean(field.mandatory)}
                        onChange={(event) => updateField(index, { mandatory: event.target.checked })}
                        type="checkbox"
                      />
                      Mandatory
                    </label>
                    <button
                      aria-label={`Remove ${field.label || "field"}`}
                      className="webchat-pf-field-row__remove"
                      disabled={pf.customFields.length <= 1}
                      onClick={() => removeField(index)}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </FeatureCard>

          <div className="setup-step-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={saving} onClick={handleNext} type="button">
              {saving ? <Loader2 className="spin" size={16} /> : null}
              Next
            </button>
            <button className="secondary-button" disabled={saving} onClick={handleSave} type="button">
              Save
            </button>
          </div>
        </div>
      </div>

      <PrimaryFormPreview form={form} personalisation={personalisation} primaryForm={pf} />
    </div>
  );
}
