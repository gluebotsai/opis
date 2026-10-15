import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ImageIcon,
  Loader2,
  MessageCircle,
  Minus,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { getCustomerToken } from "../../../lib/customerAuth.js";
import { getAuthToken } from "../../../lib/auth.js";
import { uploadWebchatAsset } from "../../../lib/setup/setupApi.js";
import {
  BACKGROUND_PATTERNS,
  BOT_AVATAR_PRESETS,
  DEFAULT_PERSONALISATION,
  NOTIFICATION_SOUNDS,
  TRACKER_DELAYS,
  TRACKER_TYPES,
  WEBCHAT_FONTS,
  backgroundPatternStyle,
  cornerRadiusPx,
  ensureWebchatFontLoaded,
  fabBackground,
  headerBackground,
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

function ColourField({ label, value, onChange }) {
  const id = useId();
  return (
    <label className="webchat-colour-field" htmlFor={id}>
      <span>{label}</span>
      <div className="webchat-colour-field__row">
        <input
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          type="text"
          value={value}
        />
        <input
          aria-label={`${label} swatch`}
          className="webchat-colour-swatch"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#5B55FF"}
        />
      </div>
    </label>
  );
}

function ImageUploadCard({ label, required, hint, url, uploading, onPick, error }) {
  const inputRef = useRef(null);
  return (
    <div className={`webchat-upload-card${error ? " is-invalid" : ""}`}>
      <div className="webchat-upload-card__label">
        {label}
        {required ? <span className="webchat-req">*</span> : null}
      </div>
      <button
        className="webchat-upload-card__drop"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {url ? (
          <AuthImage alt="" className="webchat-upload-card__preview" src={url} />
        ) : (
          <ImageIcon size={28} strokeWidth={1.5} />
        )}
        <div>
          <strong>{uploading ? "Uploading…" : "Upload Image"}</strong>
          <p>{hint}</p>
        </div>
        <Upload size={16} />
      </button>
      <input
        accept="image/png,image/jpeg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
        ref={inputRef}
        type="file"
      />
      {error ? <p className="setup-field-error">{error}</p> : null}
    </div>
  );
}

function Accordion({ title, open, onToggle, children, tone = "default" }) {
  return (
    <section className={`webchat-accordion webchat-accordion--${tone}${open ? " is-open" : ""}`}>
      <button className="webchat-accordion__header" onClick={onToggle} type="button">
        <ChevronDown size={18} />
        <span>{title}</span>
      </button>
      {open ? <div className="webchat-accordion__body">{children}</div> : null}
    </section>
  );
}

function PersonalisationPreview({ form, personalisation }) {
  const p = personalisation;
  const radius = cornerRadiusPx(p.roundedCorners);
  const title = form.title.trim() || "Sample";
  const subtitle = form.aliasTitle.trim() || "AI Assistance";
  const greetingHtml = form.greetingMessage?.trim()
    ? form.greetingMessage
    : "<p>Hola amigo</p>";
  const triggerText = form.triggerMessage.trim();
  const preset = BOT_AVATAR_PRESETS.find((item) => item.id === p.botAvatarPreset);
  const alignEnd = p.position !== "bottom_left";
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (triggerText) setOpen(false);
  }, [triggerText]);

  useEffect(() => {
    ensureWebchatFontLoaded(p.fontStyle);
  }, [p.fontStyle]);

  const fontFamily = webchatFontFamily(p.fontStyle);
  const avatarIsCustom = Boolean(p.botAvatarUrl) || p.botAvatarPreset === "custom";
  const avatarShapeClass = `webchat-preview-bot-icon webchat-preview-bot-icon--avatar${
    p.chatIconShape === "square" ? " is-square" : ""
  }`;

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
            <div className="webchat-preview-body webchat-preview-body--personal" style={bodyStyle}>
              <div className="webchat-preview-bot-row">
                {renderBotAvatar()}
                <div
                  className="webchat-preview-bubble webchat-preview-bubble--rich"
                  dangerouslySetInnerHTML={{ __html: greetingHtml }}
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
            </div>
            <div className="webchat-preview-composer">
              <input disabled placeholder="Type your message here" type="text" />
              <p className="webchat-preview-powered">
                Powered by <strong>Worktual</strong>
              </p>
            </div>
          </div>
        ) : null}

        <div className={`webchat-preview-launcher${alignEnd ? "" : " is-left"}`}>
          {triggerText && !open ? (
            <div className="webchat-preview-trigger">
              <p>{triggerText}</p>
            </div>
          ) : null}
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

export function WebchatPersonalisationPanel({
  configId,
  form,
  personalisation,
  onChangePersonalisation,
  onChangeTriggerMessage,
  onReset,
  onCancel,
  onSave,
  onNext,
  saving,
  error,
}) {
  const [openSections, setOpenSections] = useState({
    branding: true,
    positioning: false,
    trigger: false,
    responses: true,
    advance: false,
  });
  const [uploading, setUploading] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [localError, setLocalError] = useState("");

  const p = personalisation;

  function patch(partial) {
    onChangePersonalisation({ ...p, ...partial });
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(partial)) delete next[key];
      return next;
    });
  }

  function toggle(section) {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  async function handleUpload(kind, file) {
    setLocalError("");
    setUploading((prev) => ({ ...prev, [kind]: true }));
    try {
      const result = await uploadWebchatAsset(configId, kind, file);
      const next = result?.config?.personalisation;
      if (next) onChangePersonalisation(next);
      if (kind === "chat_icon_logo") {
        setFieldErrors((prev) => {
          const copy = { ...prev };
          delete copy.chatIconLogoUrl;
          return copy;
        });
      }
    } catch (err) {
      setLocalError(err.message || "Upload failed.");
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
    }
  }

  function validate() {
    const next = {};
    if (!p.chatIconLogoUrl) next.chatIconLogoUrl = "Chat icon logo is required.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleNext() {
    if (!validate()) {
      setOpenSections((prev) => ({ ...prev, branding: true }));
      return;
    }
    await onNext();
  }

  async function handleSave() {
    if (!validate()) {
      setOpenSections((prev) => ({ ...prev, branding: true }));
      return;
    }
    await onSave();
  }

  const solidColourFields = useMemo(
    () => [
      { key: "chatHeaderColour", label: "Chat header colour" },
      { key: "chatIconColour", label: "Chat icon colour" },
      { key: "agentMessageColour", label: "Agent message colour" },
      { key: "customerMessageColour", label: "Customer message colour" },
      { key: "actionMessageColour", label: "Action message colour" },
    ],
    [],
  );

  return (
    <div className="webchat-basic-layout webchat-personal-layout">
      <div className="webchat-basic-form webchat-personal-form">
        <div className="setup-step-body">
          <div className="webchat-personal-intro">
            <div>
              <h2>Design your widget</h2>
              <p>Add a logo for your bot, and create a color theme for your widget.</p>
            </div>
            <button className="secondary-button webchat-reset-btn" onClick={onReset} type="button">
              <RotateCcw size={14} />
              Reset
            </button>
          </div>

          {error || localError ? <p className="setup-inline-error">{error || localError}</p> : null}

          <Accordion
            onToggle={() => toggle("branding")}
            open={openSections.branding}
            title="Branding"
          >
            <ImageUploadCard
              error={fieldErrors.chatIconLogoUrl}
              hint="Upload a 42×42 pixel avatar in JPEG or PNG format, ensuring the file size is under 5 MB."
              label="Chat icon logo"
              onPick={(file) => handleUpload("chat_icon_logo", file)}
              required
              uploading={Boolean(uploading.chat_icon_logo)}
              url={p.chatIconLogoUrl}
            />
            <ImageUploadCard
              hint="Upload a 42×42 pixel avatar in JPEG or PNG format, ensuring the file size is under 5 MB."
              label="Widget icon logo"
              onPick={(file) => handleUpload("widget_icon_logo", file)}
              uploading={Boolean(uploading.widget_icon_logo)}
              url={p.widgetIconLogoUrl}
            />

            <label className="setup-form-field">
              <span>Font style</span>
              <select onChange={(event) => patch({ fontStyle: event.target.value })} value={p.fontStyle}>
                {WEBCHAT_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.id}
                  </option>
                ))}
              </select>
            </label>

            <div className="webchat-brand-mode">
              <span>Brand colour</span>
              <div className="webchat-radio-row">
                <label>
                  <input
                    checked={p.brandColourMode === "solid"}
                    name="brandColourMode"
                    onChange={() => patch({ brandColourMode: "solid" })}
                    type="radio"
                  />
                  Solid
                </label>
                <label>
                  <input
                    checked={p.brandColourMode === "gradient"}
                    name="brandColourMode"
                    onChange={() => patch({ brandColourMode: "gradient" })}
                    type="radio"
                  />
                  Gradient
                </label>
              </div>
            </div>

            {p.brandColourMode === "solid" ? (
              <div className="webchat-colour-grid">
                {solidColourFields.map((field) => (
                  <ColourField
                    key={field.key}
                    label={field.label}
                    onChange={(value) => patch({ [field.key]: value })}
                    value={p[field.key]}
                  />
                ))}
              </div>
            ) : (
              <div className="webchat-colour-grid">
                <ColourField
                  label="Header gradient from"
                  onChange={(value) => patch({ chatHeaderGradientFrom: value })}
                  value={p.chatHeaderGradientFrom}
                />
                <ColourField
                  label="Header gradient to"
                  onChange={(value) => patch({ chatHeaderGradientTo: value })}
                  value={p.chatHeaderGradientTo}
                />
                <ColourField
                  label="Icon gradient from"
                  onChange={(value) => patch({ chatIconGradientFrom: value })}
                  value={p.chatIconGradientFrom}
                />
                <ColourField
                  label="Icon gradient to"
                  onChange={(value) => patch({ chatIconGradientTo: value })}
                  value={p.chatIconGradientTo}
                />
                <ColourField
                  label="Agent message colour"
                  onChange={(value) => patch({ agentMessageColour: value })}
                  value={p.agentMessageColour}
                />
                <ColourField
                  label="Customer message colour"
                  onChange={(value) => patch({ customerMessageColour: value })}
                  value={p.customerMessageColour}
                />
                <ColourField
                  label="Action message colour"
                  onChange={(value) => patch({ actionMessageColour: value })}
                  value={p.actionMessageColour}
                />
              </div>
            )}

            <div className="webchat-avatar-block">
              <span className="webchat-block-label">Bot avatar</span>
              <div className="webchat-avatar-row">
                {BOT_AVATAR_PRESETS.map((avatar) => (
                  <button
                    aria-label={`Avatar ${avatar.id}`}
                    className={`webchat-avatar-preset${p.botAvatarPreset === avatar.id ? " is-selected" : ""}`}
                    key={avatar.id}
                    onClick={() =>
                      patch({
                        botAvatarPreset: avatar.id,
                        botAvatarUrl: "",
                        botAvatarKey: "",
                      })
                    }
                    style={{ background: avatar.color }}
                    type="button"
                  >
                    <MessageCircle size={16} color="#fff" />
                  </button>
                ))}
                <button
                  className={`webchat-avatar-add${p.botAvatarPreset === "custom" ? " is-selected" : ""}`}
                  onClick={() => document.getElementById("webchat-bot-avatar-input")?.click()}
                  type="button"
                >
                  {p.botAvatarUrl ? (
                    <AuthImage alt="" className="webchat-avatar-add__img" src={p.botAvatarUrl} />
                  ) : (
                    <ImageIcon size={18} />
                  )}
                  <span>{uploading.bot_avatar ? "…" : "Add"}</span>
                </button>
                <input
                  accept="image/png,image/jpeg"
                  hidden
                  id="webchat-bot-avatar-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) handleUpload("bot_avatar", file);
                  }}
                  type="file"
                />
              </div>
            </div>

            <div className="webchat-pattern-block">
              <span className="webchat-block-label">Chat background pattern</span>
              <div className="webchat-pattern-grid">
                {BACKGROUND_PATTERNS.map((pattern) => (
                  <button
                    aria-label={pattern.label}
                    className={`webchat-pattern-swatch${p.chatBackgroundPattern === pattern.id ? " is-selected" : ""}`}
                    key={pattern.id}
                    onClick={() => patch({ chatBackgroundPattern: pattern.id })}
                    style={backgroundPatternStyle(pattern.id)}
                    type="button"
                    title={pattern.label}
                  />
                ))}
              </div>
            </div>

            <label className="setup-form-field">
              <span>Notification sound</span>
              <select
                onChange={(event) => patch({ notificationSound: event.target.value })}
                value={p.notificationSound}
              >
                {NOTIFICATION_SOUNDS.map((sound) => (
                  <option key={sound.id} value={sound.id}>
                    {sound.label}
                  </option>
                ))}
              </select>
            </label>
          </Accordion>

          <Accordion
            onToggle={() => toggle("positioning")}
            open={openSections.positioning}
            title="Positioning & Behaviour"
            tone="warm"
          >
            <div className="webchat-position-block">
              <span className="webchat-block-label">Position</span>
              <div className="webchat-choice-cards">
                {[
                  { id: "bottom_right", label: "Bottom right" },
                  { id: "bottom_left", label: "Bottom left" },
                ].map((option) => (
                  <label
                    className={`webchat-choice-card${p.position === option.id ? " is-selected" : ""}`}
                    key={option.id}
                  >
                    <div className={`webchat-choice-mock is-${option.id.replace("_", "-")}`}>
                      <span />
                    </div>
                    <input
                      checked={p.position === option.id}
                      name="position"
                      onChange={() => patch({ position: option.id })}
                      type="radio"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="webchat-slider-block">
              <div className="webchat-slider-block__labels">
                <span>Rounded corners</span>
                <span>Straight — Curved</span>
              </div>
              <input
                max={100}
                min={0}
                onChange={(event) => patch({ roundedCorners: Number(event.target.value) })}
                type="range"
                value={p.roundedCorners}
              />
            </div>

            <div className="webchat-position-block">
              <span className="webchat-block-label">Chat icon shape</span>
              <div className="webchat-radio-row">
                <label>
                  <input
                    checked={p.chatIconShape === "circle"}
                    name="chatIconShape"
                    onChange={() => patch({ chatIconShape: "circle" })}
                    type="radio"
                  />
                  Circle
                </label>
                <label>
                  <input
                    checked={p.chatIconShape === "square"}
                    name="chatIconShape"
                    onChange={() => patch({ chatIconShape: "square" })}
                    type="radio"
                  />
                  Square
                </label>
              </div>
            </div>

            <div className="webchat-position-block">
              <span className="webchat-block-label">Widget launcher</span>
              <div className="webchat-radio-row">
                <label>
                  <input
                    checked={p.widgetLauncher === "icon"}
                    name="widgetLauncher"
                    onChange={() => patch({ widgetLauncher: "icon" })}
                    type="radio"
                  />
                  Icon
                </label>
                <label>
                  <input
                    checked={p.widgetLauncher === "text"}
                    name="widgetLauncher"
                    onChange={() => patch({ widgetLauncher: "text" })}
                    type="radio"
                  />
                  Text
                </label>
              </div>
            </div>
          </Accordion>

          <Accordion
            onToggle={() => toggle("trigger")}
            open={openSections.trigger}
            title="Trigger"
            tone="lavender"
          >
            <div className="webchat-toggle-row">
              <div>
                <strong>Enable tracker</strong>
                <p>
                  Track live website visitors and generate bot-initiated questions for enhanced
                  engagement.
                </p>
              </div>
              <button
                aria-pressed={p.enableTracker}
                className={`webchat-switch${p.enableTracker ? " is-on" : ""}`}
                onClick={() => patch({ enableTracker: !p.enableTracker })}
                type="button"
              >
                <span />
              </button>
            </div>

            {p.enableTracker ? (
              <div className="webchat-basic-fields">
                <label className="setup-form-field">
                  <span>Type</span>
                  <select
                    onChange={(event) => patch({ trackerType: event.target.value })}
                    value={p.trackerType}
                  >
                    <option value="">Select type</option>
                    {TRACKER_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setup-form-field">
                  <span>Name</span>
                  <input
                    onChange={(event) => patch({ trackerName: event.target.value })}
                    placeholder="Enter name"
                    value={p.trackerName}
                  />
                </label>
                <label className="setup-form-field">
                  <span>Delay</span>
                  <select
                    onChange={(event) => patch({ trackerDelay: event.target.value })}
                    value={p.trackerDelay}
                  >
                    {TRACKER_DELAYS.map((delay) => (
                      <option key={delay.id} value={delay.id}>
                        {delay.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setup-form-field webchat-trigger-field">
                  <span>Trigger Message</span>
                  <div className="webchat-trigger-input-wrap">
                    <span className="webchat-trigger-counter">
                      {form.triggerMessage.length} / 100
                    </span>
                    <textarea
                      maxLength={100}
                      onChange={(event) => onChangeTriggerMessage(event.target.value.slice(0, 100))}
                      placeholder="Message"
                      rows={3}
                      value={form.triggerMessage}
                    />
                  </div>
                </label>
              </div>
            ) : null}
          </Accordion>

          <Accordion
            onToggle={() => toggle("responses")}
            open={openSections.responses}
            title="Automated Response"
          >
            <div className="webchat-response-card">
              <strong>Agent handoff message</strong>
              <p>Message displays when an agent takes over a session.</p>
              <label className="setup-form-field">
                <span>Message</span>
                <textarea
                  onChange={(event) => patch({ agentHandoffMessage: event.target.value })}
                  rows={3}
                  value={p.agentHandoffMessage}
                />
              </label>
            </div>

            <div className="webchat-response-card">
              <strong>Agent busy</strong>
              <p>Message displayed when an agent is busy.</p>
              <label className="setup-form-field">
                <span>Message</span>
                <textarea
                  onChange={(event) => patch({ agentBusyMessage: event.target.value })}
                  rows={4}
                  value={p.agentBusyMessage}
                />
              </label>
              <label className="setup-form-field--checkbox">
                <input
                  checked={p.agentBusyCallback}
                  onChange={(event) => patch({ agentBusyCallback: event.target.checked })}
                  type="checkbox"
                />
                <span>Callback</span>
              </label>
            </div>

            <div className="webchat-response-card">
              <strong>Agent unavailable</strong>
              <p>Message displayed when no agents are available.</p>
              <label className="setup-form-field">
                <span>Message</span>
                <textarea
                  onChange={(event) => patch({ agentUnavailableMessage: event.target.value })}
                  rows={4}
                  value={p.agentUnavailableMessage}
                />
              </label>
              <label className="setup-form-field--checkbox">
                <input
                  checked={p.agentUnavailableCallback}
                  onChange={(event) => patch({ agentUnavailableCallback: event.target.checked })}
                  type="checkbox"
                />
                <span>Callback</span>
              </label>
            </div>

            <div className="webchat-response-card">
              <strong>Out of business hours</strong>
              <p>Specify when the contact centre operates during business hours.</p>
              <label className="setup-form-field">
                <span>Message</span>
                <textarea
                  onChange={(event) => patch({ outOfHoursMessage: event.target.value })}
                  rows={4}
                  value={p.outOfHoursMessage}
                />
              </label>
              <label className="setup-form-field--checkbox">
                <input
                  checked={p.outOfHoursCallback}
                  onChange={(event) => patch({ outOfHoursCallback: event.target.checked })}
                  type="checkbox"
                />
                <span>Callback</span>
              </label>
            </div>

            <div className="webchat-response-card">
              <strong>Callback</strong>
              <p>Ensure timely assistance by setting response thresholds for callbacks.</p>
              <label className="setup-form-field webchat-threshold-field">
                <span>Threshold time</span>
                <div className="webchat-threshold-row">
                  <input
                    min={1}
                    max={168}
                    onChange={(event) =>
                      patch({ callbackThresholdHours: Number(event.target.value) || 1 })
                    }
                    type="number"
                    value={p.callbackThresholdHours}
                  />
                  <span>Hours</span>
                </div>
              </label>
            </div>
          </Accordion>

          <Accordion
            onToggle={() => toggle("advance")}
            open={openSections.advance}
            title="Advance Options"
          >
            <div className="webchat-advance-options">
              <label className="webchat-advance-check">
                <input
                  checked={Boolean(p.allowCustomerUploadDocuments)}
                  onChange={(event) => patch({ allowCustomerUploadDocuments: event.target.checked })}
                  type="checkbox"
                />
                <span>Allow customer to upload documents</span>
              </label>
              <label className="webchat-advance-check">
                <input
                  checked={Boolean(p.allowCustomerDownloadTranscript)}
                  onChange={(event) =>
                    patch({ allowCustomerDownloadTranscript: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>Allow customer to Download Transcript</span>
              </label>
              <label className="webchat-advance-check">
                <input
                  checked={Boolean(p.allowCustomerEmailTranscript)}
                  onChange={(event) => patch({ allowCustomerEmailTranscript: event.target.checked })}
                  type="checkbox"
                />
                <span>Allow customer to Email Transcript</span>
              </label>
              <label className="webchat-advance-check">
                <input
                  checked={Boolean(p.enableWidgetLanguage)}
                  onChange={(event) => patch({ enableWidgetLanguage: event.target.checked })}
                  type="checkbox"
                />
                <span>Widget Language</span>
              </label>
            </div>
          </Accordion>

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

      <PersonalisationPreview form={form} personalisation={p} />
    </div>
  );
}

export { DEFAULT_PERSONALISATION };
