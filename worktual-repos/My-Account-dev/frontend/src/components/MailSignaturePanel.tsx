// @ts-nocheck
import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";

import { AdminPageToast } from "./admin/AdminPageToast.tsx";
import { MailHtmlSignatureEditor } from "./MailHtmlSignatureEditor.tsx";
import { MailMessageBody } from "./MailMessageBody.tsx";
import {
  buildDefaultSignatureHtml,
  fetchMailSignature,
  saveMailSignature,
} from "../lib/mailSignature.js";
import { getSession } from "../lib/auth.js";

export function MailSignaturePanel({ mailboxProfile, onSaved }) {
  const session = getSession();
  const [htmlBody, setHtmlBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastError, setToastError] = useState("");
  const [toastSuccess, setToastSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSignature() {
      setLoading(true);
      setToastError("");

      try {
        const data = await fetchMailSignature(mailboxProfile);
        if (cancelled) {
          return;
        }

        if (data.signature?.htmlBody) {
          setHtmlBody(data.signature.htmlBody);
        } else {
          setHtmlBody(
            buildDefaultSignatureHtml({
              displayName: session?.displayName || "",
              email: session?.email || "",
            }),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setToastError(loadError instanceof Error ? loadError.message : "Could not load signature.");
          setHtmlBody(
            buildDefaultSignatureHtml({
              displayName: session?.displayName || "",
              email: session?.email || "",
            }),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSignature();

    return () => {
      cancelled = true;
    };
  }, [mailboxProfile, session?.displayName, session?.email]);

  function clearToast() {
    setToastError("");
    setToastSuccess("");
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    clearToast();

    try {
      await saveMailSignature(htmlBody, mailboxProfile);
      onSaved?.(htmlBody);
      setToastSuccess("Signature saved. It will be appended to new messages automatically.");
    } catch (saveError) {
      setToastError(saveError instanceof Error ? saveError.message : "Could not save signature.");
    } finally {
      setSaving(false);
    }
  }

  function handleUseTemplate() {
    setHtmlBody(
      buildDefaultSignatureHtml({
        displayName: session?.displayName || "",
        email: session?.email || "",
      }),
    );
    clearToast();
  }

  return (
    <form className="mail-signature-panel mail-signature-panel--embedded" onSubmit={handleSave}>
      <AdminPageToast
        error={toastError}
        onDismiss={clearToast}
        success={toastSuccess}
        variant="pill"
      />

      <header className="mail-signature-panel__header">
        <div className="mail-signature-panel__heading">
          <span aria-hidden="true" className="mail-signature-panel__icon">
            <PenLine size={18} />
          </span>
          <div>
            <strong>Email signature</strong>
            <p>Create your signature block. It is added automatically when you send mail.</p>
          </div>
        </div>
        <div className="mail-signature-panel__actions">
          <button className="secondary-button" onClick={handleUseTemplate} type="button">
            Use Worktual template
          </button>
          <button className="primary-button" disabled={saving || loading} type="submit">
            {saving ? "Saving…" : "Save signature"}
          </button>
        </div>
      </header>

      {loading ? <p className="mail-signature-panel__status">Loading signature…</p> : null}

      <div className="mail-signature-panel__editor">
        <MailHtmlSignatureEditor
          minHeight={200}
          onChange={setHtmlBody}
          placeholder="Paste your email signature here…"
          value={htmlBody}
        />
      </div>

      <section className="mail-signature-panel__preview">
        <h3>Preview</h3>
        <div className="mail-signature-panel__preview-body">
          {htmlBody?.trim() ? (
            <MailMessageBody htmlBody={htmlBody} maxHeight={180} minHeight={40} textBody="" />
          ) : (
            <p className="mail-signature-panel__preview-empty">Paste a signature to preview it here.</p>
          )}
        </div>
      </section>
    </form>
  );
}
