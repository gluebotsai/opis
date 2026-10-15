import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  MessageCircle,
  Smile,
  Strikethrough,
  X,
} from "lucide-react";
import {
  createWebchatChannelConfig,
  getWebchatChannelConfig,
  updateWebchatChannelConfig,
} from "../../../lib/setup/setupApi.js";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import { getPurchasedProductCatalog } from "../../../lib/productCatalog.js";
import {
  DEFAULT_PERSONALISATION,
  mergePersonalisationClient,
} from "./webchatPersonalisation.js";
import { WebchatPersonalisationPanel } from "./WebchatPersonalisationPanel.jsx";
import { WebchatPrimaryFormPanel } from "./WebchatPrimaryFormPanel.jsx";

const WEBCHAT_TABS = [
  { id: "basic", label: "Basic Settings", implemented: true },
  { id: "personalisation", label: "Personalisation", implemented: true },
  { id: "primary-form", label: "Primary Form", implemented: true },
  { id: "bot", label: "Bot Configuration", implemented: false },
  { id: "installation", label: "Installation", implemented: false },
];

const EMPTY_FORM = {
  title: "",
  aliasTitle: "",
  description: "",
  greetingMessage: "",
  triggerMessage: "",
};

import { EMOJI_CATEGORIES } from "./webchatEmojis.js";

const TRIGGER_MAX = 100;

function FieldError({ message }) {
  if (!message) return null;
  return <p className="setup-field-error">{message}</p>;
}

function htmlToPlainText(html) {
  if (!html) return "";
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || "").replace(/\u00a0/g, " ").trim();
}

function GreetingRichTextEditor({ value, onChange, placeholder, error }) {
  const editorRef = useRef(null);
  const pickerRef = useRef(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [emojiQuery, setEmojiQuery] = useState("");
  const syncedRef = useRef(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (!syncedRef.current) {
      el.innerHTML = value || "";
      syncedRef.current = true;
      return;
    }
    if (document.activeElement !== el && el.innerHTML !== (value || "")) {
      el.innerHTML = value || "";
    }
  }, [value]);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    function onPointerDown(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [emojiOpen]);

  const emitChange = useCallback(() => {
    const html = editorRef.current?.innerHTML || "";
    onChange(html === "<br>" ? "" : html);
  }, [onChange]);

  const runCommand = useCallback(
    (command, commandValue = null) => {
      editorRef.current?.focus();
      document.execCommand(command, false, commandValue);
      emitChange();
    },
    [emitChange],
  );

  const insertEmoji = useCallback(
    (emoji) => {
      editorRef.current?.focus();
      document.execCommand("insertText", false, emoji);
      emitChange();
    },
    [emitChange],
  );

  const insertLink = useCallback(() => {
    const url = window.prompt("Enter URL");
    if (!url) return;
    runCommand("createLink", url.trim());
  }, [runCommand]);

  const activeCategory = EMOJI_CATEGORIES.find((item) => item.id === emojiCategory) || EMOJI_CATEGORIES[0];
  const visibleEmojis = useMemo(() => {
    const query = emojiQuery.trim().toLowerCase();
    if (!query) return activeCategory.emojis;
    return EMOJI_CATEGORIES.flatMap((category) => category.emojis).filter((emoji) =>
      emoji.includes(query),
    );
  }, [activeCategory, emojiQuery]);

  const isEmpty = !htmlToPlainText(value);

  return (
    <div className={`webchat-rich-editor${error ? " is-invalid" : ""}`}>
      <div className="webchat-rich-editor-surface">
        {isEmpty ? <span className="webchat-rich-placeholder">{placeholder}</span> : null}
        <div
          aria-label="Greeting message"
          className="webchat-rich-input"
          contentEditable
          onInput={emitChange}
          ref={editorRef}
          role="textbox"
          suppressContentEditableWarning
        />
      </div>
      <div className="webchat-rich-toolbar">
        <div className="webchat-emoji-wrap" ref={pickerRef}>
          <button
            aria-label="Insert emoji"
            className="webchat-rich-tool"
            onClick={() => setEmojiOpen((open) => !open)}
            type="button"
          >
            <Smile size={16} />
          </button>
          {emojiOpen ? (
            <div className="webchat-emoji-picker">
              <input
                aria-label="Search emojis"
                className="webchat-emoji-search"
                onChange={(event) => setEmojiQuery(event.target.value)}
                placeholder="Search emoji…"
                type="search"
                value={emojiQuery}
              />
              {!emojiQuery.trim() ? (
                <div className="webchat-emoji-cats" role="tablist">
                  {EMOJI_CATEGORIES.map((category) => (
                    <button
                      aria-selected={category.id === emojiCategory}
                      className={category.id === emojiCategory ? "is-active" : undefined}
                      key={category.id}
                      onClick={() => setEmojiCategory(category.id)}
                      type="button"
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="webchat-emoji-grid">
                {visibleEmojis.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    onClick={() => insertEmoji(emoji)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button
          aria-label="Bold"
          className="webchat-rich-tool"
          onClick={() => runCommand("bold")}
          type="button"
        >
          <Bold size={16} />
        </button>
        <button
          aria-label="Italic"
          className="webchat-rich-tool"
          onClick={() => runCommand("italic")}
          type="button"
        >
          <Italic size={16} />
        </button>
        <button
          aria-label="Strikethrough"
          className="webchat-rich-tool"
          onClick={() => runCommand("strikeThrough")}
          type="button"
        >
          <Strikethrough size={16} />
        </button>
        <button
          aria-label="Bullet list"
          className="webchat-rich-tool"
          onClick={() => runCommand("insertUnorderedList")}
          type="button"
        >
          <List size={16} />
        </button>
        <button
          aria-label="Numbered list"
          className="webchat-rich-tool"
          onClick={() => runCommand("insertOrderedList")}
          type="button"
        >
          <ListOrdered size={16} />
        </button>
        <button aria-label="Insert link" className="webchat-rich-tool" onClick={insertLink} type="button">
          <Link2 size={16} />
        </button>
      </div>
    </div>
  );
}

function WebchatPreview({ form }) {
  const title = form.title.trim() || "Chat with us";
  const greetingHtml = form.greetingMessage?.trim()
    ? form.greetingMessage
    : "<p>Hi there! How can we help?</p>";
  const triggerText = form.triggerMessage.trim();
  const [triggerDismissed, setTriggerDismissed] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(true);
  const hadTriggerRef = useRef(false);

  useEffect(() => {
    setTriggerDismissed(false);
    if (triggerText) {
      // Typing a trigger message shows the closed launcher + bubble.
      if (!hadTriggerRef.current) {
        setWidgetOpen(false);
      }
      hadTriggerRef.current = true;
    } else {
      // No trigger — keep the chat open so greeting edits stay visible.
      hadTriggerRef.current = false;
      setWidgetOpen(true);
    }
  }, [triggerText]);

  const showTriggerBubble = Boolean(triggerText) && !triggerDismissed && !widgetOpen;

  return (
    <aside className="webchat-preview-panel" aria-label="Widget preview">
      <div className={`webchat-preview-frame${widgetOpen ? " is-open" : " is-closed"}`}>
        {widgetOpen ? (
          <div className="webchat-preview-widget">
            <header className="webchat-preview-header">
              <div className="webchat-preview-avatar" aria-hidden="true" />
              <div className="webchat-preview-header__text">
                <strong>{title}</strong>
                {form.aliasTitle.trim() ? <span>{form.aliasTitle.trim()}</span> : null}
              </div>
              <button
                aria-label="Close chat"
                className="webchat-preview-close"
                onClick={() => setWidgetOpen(false)}
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="webchat-preview-body">
              {form.description.trim() ? (
                <p className="webchat-preview-description">{form.description.trim()}</p>
              ) : null}
              <div className="webchat-preview-bot-row">
                <div className="webchat-preview-bot-icon" aria-hidden="true" />
                <div
                  className="webchat-preview-bubble webchat-preview-bubble--rich"
                  dangerouslySetInnerHTML={{ __html: greetingHtml }}
                />
              </div>
            </div>
            <div className="webchat-preview-composer">
              <input disabled placeholder="Type a message…" type="text" />
              <p className="webchat-preview-powered">Powered by Worktual</p>
            </div>
          </div>
        ) : null}

        {!widgetOpen ? (
          <div className="webchat-preview-launcher">
            {showTriggerBubble ? (
              <div className="webchat-preview-trigger">
                <button
                  aria-label="Dismiss trigger"
                  className="webchat-preview-trigger-close"
                  onClick={() => setTriggerDismissed(true)}
                  type="button"
                >
                  <X size={10} strokeWidth={3} />
                </button>
                <p>{triggerText}</p>
              </div>
            ) : null}
            <button
              aria-expanded={false}
              aria-label="Open chat widget"
              className="webchat-preview-fab"
              onClick={() => setWidgetOpen(true)}
              type="button"
            >
              <MessageCircle size={22} />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function SetupWebchatConfigPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { dashboard } = useCustomerDashboard();
  const isNew = configId === "new";
  const hasCcaas = useMemo(
    () => getPurchasedProductCatalog(dashboard?.activeProducts).some((p) => p.id === "contact-center"),
    [dashboard?.activeProducts],
  );

  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam === "personalisation" || tabParam === "primary-form" || tabParam === "bot"
      ? tabParam
      : "basic";
  const [activeTab, setActiveTab] = useState(isNew ? "basic" : initialTab);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [personalisation, setPersonalisation] = useState(DEFAULT_PERSONALISATION);
  const [fieldErrors, setFieldErrors] = useState({});
  const [webchatId, setWebchatId] = useState("");

  useEffect(() => {
    if (isNew || !hasCcaas) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    getWebchatChannelConfig(configId)
      .then((config) => {
        if (cancelled) return;
        if (!config) {
          setError("Web Chat widget not found.");
          return;
        }
        setWebchatId(config.webchatId || "");
        setForm({
          title: config.title || "",
          aliasTitle: config.aliasTitle || "",
          description: config.description || "",
          greetingMessage: config.greetingMessage || "",
          triggerMessage: config.triggerMessage || "",
        });
        setPersonalisation(mergePersonalisationClient(config.personalisation));
        if (searchParams.get("tab") === "personalisation") {
          setActiveTab("personalisation");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load Web Chat widget.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configId, hasCcaas, isNew, searchParams]);

  const titleError = useMemo(() => {
    if (!fieldErrors.title) return "";
    return fieldErrors.title;
  }, [fieldErrors.title]);

  const aliasError = useMemo(() => {
    if (!fieldErrors.aliasTitle) return "";
    return fieldErrors.aliasTitle;
  }, [fieldErrors.aliasTitle]);

  const greetingError = useMemo(() => {
    if (!fieldErrors.greetingMessage) return "";
    return fieldErrors.greetingMessage;
  }, [fieldErrors.greetingMessage]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateBasic() {
    const next = {};
    if (!form.title.trim()) next.title = "Title is required.";
    if (!form.aliasTitle.trim()) next.aliasTitle = "Alias title is required.";
    if (!htmlToPlainText(form.greetingMessage)) {
      next.greetingMessage = "Greeting message is required.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function saveBasicSettings({ advance } = { advance: false }) {
    if (!validateBasic()) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        title: form.title.trim(),
        aliasTitle: form.aliasTitle.trim(),
        description: form.description.trim(),
        greetingMessage: form.greetingMessage.trim(),
        triggerMessage: form.triggerMessage.trim().slice(0, TRIGGER_MAX),
      };
      if (isNew) {
        const created = await createWebchatChannelConfig(body);
        const id = created?.id;
        if (!id) throw new Error("Create succeeded but no config id returned.");
        setWebchatId(created.webchatId || "");
        setPersonalisation(mergePersonalisationClient(created.personalisation));
        if (advance) {
          navigate(`/customer/setup/communication/web-chat/${id}?tab=personalisation`, {
            replace: true,
          });
          setActiveTab("personalisation");
        } else {
          navigate(`/customer/setup/communication/web-chat/${id}`, { replace: true });
        }
      } else {
        const updated = await updateWebchatChannelConfig(configId, body);
        setWebchatId(updated?.webchatId || webchatId);
        if (updated?.personalisation) {
          setPersonalisation(mergePersonalisationClient(updated.personalisation));
        }
        if (advance) {
          setActiveTab("personalisation");
          navigate("?tab=personalisation", { replace: true });
        }
      }
    } catch (err) {
      setError(err.message || "Failed to save Basic Settings.");
    } finally {
      setSaving(false);
    }
  }

  async function savePersonalisation({ advance } = { advance: false }) {
    if (isNew) {
      setError("Save Basic Settings first before personalising the widget.");
      setActiveTab("basic");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updateWebchatChannelConfig(configId, {
        triggerMessage: form.triggerMessage.trim().slice(0, TRIGGER_MAX),
        personalisation,
      });
      setPersonalisation(mergePersonalisationClient(updated?.personalisation || personalisation));
      if (updated?.triggerMessage !== undefined) {
        setForm((prev) => ({ ...prev, triggerMessage: updated.triggerMessage || "" }));
      }
      if (advance) {
        setActiveTab("primary-form");
        navigate("?tab=primary-form", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Failed to save Personalisation.");
    } finally {
      setSaving(false);
    }
  }

  async function savePrimaryForm({ advance } = { advance: false }) {
    if (isNew) {
      setError("Save Basic Settings first before configuring Primary Form.");
      setActiveTab("basic");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updateWebchatChannelConfig(configId, {
        personalisation,
      });
      setPersonalisation(mergePersonalisationClient(updated?.personalisation || personalisation));
      if (advance) {
        setActiveTab("bot");
        navigate("?tab=bot", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Failed to save Primary Form.");
    } finally {
      setSaving(false);
    }
  }

  function selectTab(tabId) {
    if ((tabId === "personalisation" || tabId === "primary-form" || tabId === "bot") && isNew) {
      setError("Complete and save Basic Settings first to unlock later steps.");
      return;
    }
    setError("");
    setActiveTab(tabId);
    if (tabId === "personalisation" || tabId === "primary-form" || tabId === "bot") {
      navigate(`?tab=${tabId}`, { replace: true });
    } else if (tabId === "basic" && !isNew) {
      navigate(`/customer/setup/communication/web-chat/${configId}`, { replace: true });
    }
  }

  function renderTabBody() {
    if (activeTab === "personalisation") {
      return (
        <WebchatPersonalisationPanel
          configId={configId}
          error={error}
          form={form}
          onCancel={() => selectTab("basic")}
          onChangePersonalisation={setPersonalisation}
          onChangeTriggerMessage={(value) => updateField("triggerMessage", value)}
          onNext={() => savePersonalisation({ advance: true })}
          onReset={() =>
            setPersonalisation((prev) => ({
              ...DEFAULT_PERSONALISATION,
              primaryForm: prev.primaryForm,
            }))
          }
          onSave={() => savePersonalisation({ advance: false })}
          personalisation={personalisation}
          saving={saving}
        />
      );
    }

    if (activeTab === "primary-form") {
      return (
        <WebchatPrimaryFormPanel
          error={error}
          form={form}
          onCancel={() => selectTab("personalisation")}
          onChangePrimaryForm={(primaryForm) =>
            setPersonalisation((prev) => ({ ...prev, primaryForm }))
          }
          onNext={() => savePrimaryForm({ advance: true })}
          onSave={() => savePrimaryForm({ advance: false })}
          personalisation={personalisation}
          saving={saving}
        />
      );
    }

    if (activeTab !== "basic") {
      const tab = WEBCHAT_TABS.find((item) => item.id === activeTab);
      return (
        <div className="setup-step-body webchat-stub-body">
          <h2>{tab?.label || "Coming soon"}</h2>
          <p>This step will be configured in a later phase.</p>
          {webchatId ? (
            <p className="webchat-stub-id">
              Widget ID: <code>{webchatId}</code>
            </p>
          ) : null}
          <div className="setup-step-actions">
            <button
              className="secondary-button"
              onClick={() => selectTab("primary-form")}
              type="button"
            >
              Back to Primary Form
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="webchat-basic-layout">
        <div className="webchat-basic-form">
          <div className="setup-step-body">
            <div className="webchat-basic-fields">
              <label className="setup-form-field">
                <span>Title *</span>
                <input
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="Enter the title"
                  value={form.title}
                />
                <FieldError message={titleError} />
              </label>

              <label className="setup-form-field">
                <span>Alias Title *</span>
                <input
                  onChange={(event) => updateField("aliasTitle", event.target.value)}
                  placeholder="Enter the aliasTitle"
                  value={form.aliasTitle}
                />
                <FieldError message={aliasError} />
              </label>

              <label className="setup-form-field">
                <span>Description</span>
                <textarea
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="Enter the description"
                  rows={3}
                  value={form.description}
                />
              </label>

              <div className="setup-form-field">
                <span>Greeting message *</span>
                <GreetingRichTextEditor
                  error={Boolean(greetingError)}
                  onChange={(html) => updateField("greetingMessage", html)}
                  placeholder="Enter the message which is to be displayed to the visitor"
                  value={form.greetingMessage}
                />
                <FieldError message={greetingError} />
              </div>

              <label className="setup-form-field webchat-trigger-field">
                <span>Trigger message</span>
                <div className="webchat-trigger-input-wrap">
                  <span className="webchat-trigger-counter" aria-live="polite">
                    {form.triggerMessage.length} / {TRIGGER_MAX}
                  </span>
                  <textarea
                    maxLength={TRIGGER_MAX}
                    onChange={(event) =>
                      updateField("triggerMessage", event.target.value.slice(0, TRIGGER_MAX))
                    }
                    placeholder="Enter the trigger message"
                    rows={3}
                    value={form.triggerMessage}
                  />
                </div>
              </label>
            </div>

            <div className="setup-step-actions">
              <button
                className="primary-button"
                disabled={saving || !hasCcaas}
                onClick={() => saveBasicSettings({ advance: true })}
                type="button"
              >
                {saving ? <Loader2 className="spin" size={16} /> : null}
                Next
              </button>
              {!isNew ? (
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => saveBasicSettings({ advance: false })}
                  type="button"
                >
                  Save
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <WebchatPreview form={form} />
      </div>
    );
  }

  if (!hasCcaas && !loading) {
    return (
      <section className="setup-workspace-page">
        <div className="setup-workspace-header">
          <div>
            <p className="eyebrow">Channel Setup</p>
            <h1>Web Chat</h1>
            <p>Web Chat requires an active Contact Centre purchase.</p>
          </div>
          <Link className="secondary-button" to="/customer/setup/communication">
            Back to Channel Setup
          </Link>
        </div>
      </section>
    );
  }

  if (!isNew && !loading && error && !form.title) {
    return <Navigate replace to="/customer/setup/communication" />;
  }

  return (
    <section className="setup-workspace-page">
      <div className="setup-workspace-header">
        <div>
          <p className="eyebrow">Channel Setup · Web Chat</p>
          <h1>{isNew ? "Create Widget" : "Edit Widget"}</h1>
          <p>Configure how your chat widget appears to website visitors.</p>
        </div>
        <Link className="secondary-button" to="/customer/setup/communication">
          Back to Channel Setup
        </Link>
      </div>

      <section className="setup-form-panel webchat-wizard-panel">
        <nav aria-label="Web Chat setup steps" className="webchat-wizard-tabs">
          {WEBCHAT_TABS.map((tab) => (
            <button
              className={`webchat-wizard-tab${activeTab === tab.id ? " is-active" : ""}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {error && activeTab !== "personalisation" && activeTab !== "primary-form" ? (
          <p className="setup-inline-error">{error}</p>
        ) : null}
        {loading ? (
          <div className="setup-step-body">
            <p className="muted-copy">
              <Loader2 className="spin" size={16} /> Loading…
            </p>
          </div>
        ) : (
          renderTabBody()
        )}
      </section>
    </section>
  );
}
