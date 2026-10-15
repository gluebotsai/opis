// @ts-nocheck
import { useEffect, useState } from "react";
import { FileStack, Trash2 } from "lucide-react";

import { AdminPageToast } from "./admin/AdminPageToast.tsx";
import { MailRichEditor } from "./MailRichEditor.tsx";
import {
  createMailTemplate,
  deleteMailTemplate,
  fetchMailTemplates,
  updateMailTemplate,
} from "../lib/numberManagement.js";

const EMPTY_FORM = { name: "", subject: "", bodyHtml: "" };

function RequiredMark() {
  return (
    <span aria-hidden="true" className="mail-templates-panel__required">
      *
    </span>
  );
}

export function MailTemplatesPanel({ onChanged }) {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [toastError, setToastError] = useState("");
  const [toastSuccess, setToastSuccess] = useState("");

  async function loadTemplates() {
    setLoading(true);
    try {
      const data = await fetchMailTemplates();
      setTemplates(data.templates || []);
    } catch (loadError) {
      setToastError(loadError instanceof Error ? loadError.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  function clearToast() {
    setToastError("");
    setToastSuccess("");
  }

  function startEdit(template) {
    setEditingId(template.id);
    setForm({
      name: template.name || "",
      subject: template.subject || "",
      bodyHtml: template.bodyHtml || "",
    });
    setNameError("");
    clearToast();
  }

  function resetForm() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setNameError("");
  }

  async function handleSave(event) {
    event.preventDefault();
    const trimmedName = String(form.name || "").trim();
    if (!trimmedName) {
      setNameError("Template name is required.");
      return;
    }

    setSaving(true);
    setNameError("");
    clearToast();
    const payload = { ...form, name: trimmedName };

    try {
      if (editingId) {
        await updateMailTemplate(editingId, payload);
        setToastSuccess("Template updated.");
      } else {
        await createMailTemplate(payload);
        setToastSuccess("Template saved.");
      }
      resetForm();
      await loadTemplates();
      await onChanged?.();
    } catch (saveError) {
      setToastError(saveError instanceof Error ? saveError.message : "Could not save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this shared mail template?")) {
      return;
    }
    clearToast();
    try {
      await deleteMailTemplate(id);
      if (editingId === id) {
        resetForm();
      }
      setToastSuccess("Template deleted.");
      await loadTemplates();
      await onChanged?.();
    } catch (deleteError) {
      setToastError(deleteError instanceof Error ? deleteError.message : "Could not delete template.");
    }
  }

  return (
    <section className="mail-templates-panel">
      <AdminPageToast
        error={toastError}
        onDismiss={clearToast}
        success={toastSuccess}
        variant="pill"
      />

      <header className="mail-templates-panel__header">
        <div className="mail-templates-panel__heading">
          <span aria-hidden="true" className="mail-templates-panel__icon">
            <FileStack size={18} />
          </span>
          <div>
            <h2>Mail templates</h2>
            <p>Save subject and body to reuse when composing. Inserted as-is — no placeholders.</p>
          </div>
        </div>
        <span className="mail-templates-panel__badge" title="Available to every mailbox login">
          Shared
        </span>
      </header>

      <form className="mail-templates-panel__form" noValidate onSubmit={handleSave}>
        <div className="mail-templates-panel__form-title">
          <h3>{editingId ? "Edit template" : "New template"}</h3>
          {editingId ? <span className="mail-templates-panel__editing">Editing saved template</span> : null}
        </div>

        <label className={`mail-templates-panel__field${nameError ? " is-invalid" : ""}`}>
          <span>
            Template name <RequiredMark />
          </span>
          <input
            autoComplete="off"
            onChange={(event) => {
              setForm((current) => ({ ...current, name: event.target.value }));
              if (nameError) setNameError("");
            }}
            placeholder="e.g. Payment reminder"
            value={form.name}
          />
          {nameError ? <small className="mail-templates-panel__field-error">{nameError}</small> : null}
        </label>

        <label className="mail-templates-panel__field">
          <span>Subject</span>
          <input
            autoComplete="off"
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            placeholder="Optional subject line"
            value={form.subject}
          />
        </label>

        <div className="mail-templates-panel__field">
          <span>Body</span>
          <div className="mail-templates-panel__editor">
            <MailRichEditor
              minHeight={200}
              onChange={(bodyHtml) => setForm((current) => ({ ...current, bodyHtml }))}
              placeholder="Write the template body…"
              showExtendedToolbar={false}
              value={form.bodyHtml}
            />
          </div>
        </div>

        <div className="mail-templates-panel__actions">
          {editingId ? (
            <button className="secondary-button" onClick={resetForm} type="button">
              Cancel
            </button>
          ) : null}
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Saving…" : editingId ? "Update template" : "Save template"}
          </button>
        </div>
      </form>

      <section className="mail-templates-panel__list" aria-labelledby="mail-templates-saved-heading">
        <div className="mail-templates-panel__list-header">
          <h3 id="mail-templates-saved-heading">Saved templates</h3>
          <span className="mail-templates-panel__count">{loading ? "…" : templates.length}</span>
        </div>

        {loading ? (
          <p className="mail-templates-panel__empty">Loading templates…</p>
        ) : templates.length === 0 ? (
          <div className="mail-templates-panel__empty-state">
            <FileStack size={22} strokeWidth={1.5} />
            <strong>No templates yet</strong>
            <p>Create a template above to reuse it when composing mail.</p>
          </div>
        ) : (
          <div className="mail-templates-panel__table-wrap">
            <table className="mail-templates-panel__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Subject</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => {
                  const isEditing = editingId === template.id;
                  return (
                    <tr className={isEditing ? "is-editing" : undefined} key={template.id}>
                      <td>
                        <strong title={template.name}>{template.name}</strong>
                      </td>
                      <td title={template.subject || ""}>{template.subject || "—"}</td>
                      <td>
                        {template.updatedAt
                          ? new Date(template.updatedAt).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td>
                        <div className="mail-templates-panel__row-actions">
                          <button
                            className="mail-templates-panel__text-btn"
                            onClick={() => startEdit(template)}
                            type="button"
                          >
                            {isEditing ? "Editing" : "Edit"}
                          </button>
                          <button
                            className="mail-templates-panel__text-btn is-danger"
                            onClick={() => void handleDelete(template.id)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
