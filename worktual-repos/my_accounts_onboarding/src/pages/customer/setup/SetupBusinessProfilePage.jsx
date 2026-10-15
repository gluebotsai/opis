import { useEffect, useState } from "react";
import { Building2, Pencil, Save } from "lucide-react";

import {
  SetupPageHeader,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { BUSINESS_TYPE_OPTIONS } from "../../../lib/leads.js";
import { getBusinessProfile, saveBusinessProfile } from "../../../lib/setup/setupApi.js";

const EMPTY_PROFILE = {
  companyName: "",
  industryType: "",
  businessType: "",
  country: "",
  companySize: "",
  websiteUrl: "",
  contactName: "",
  workEmail: "",
  mobileNumber: "",
  mobileCountryCode: "+91",
};

const PROFILE_FIELDS = [
  { key: "companyName", label: "Company name" },
  { key: "industryType", label: "Industry" },
  {
    key: "businessType",
    label: "Business type",
    type: "select",
    options: BUSINESS_TYPE_OPTIONS,
  },
  { key: "country", label: "Country" },
  { key: "companySize", label: "Company size" },
  { key: "websiteUrl", label: "Website" },
  { key: "contactName", label: "Contact name" },
  { key: "workEmail", label: "Work email", type: "email" },
  { key: "mobileCountryCode", label: "Mobile country code" },
  { key: "mobileNumber", label: "Mobile number" },
];

export function SetupBusinessProfilePage() {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = (await getBusinessProfile()) || EMPTY_PROFILE;
        if (!cancelled) {
          setProfile({ ...EMPTY_PROFILE, ...data });
          setDraft({ ...EMPTY_PROFILE, ...data });
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load business profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleEdit() {
    setDraft(profile);
    setIsEditing(true);
    setSaveMessage("");
    setError("");
  }

  function handleCancel() {
    setDraft(profile);
    setIsEditing(false);
    setError("");
  }

  async function handleSave(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const saved = await saveBusinessProfile(draft);
      setProfile({ ...EMPTY_PROFILE, ...saved });
      setDraft({ ...EMPTY_PROFILE, ...saved });
      setIsEditing(false);
      setSaveMessage("Business profile saved successfully.");
    } catch (err) {
      setError(err.message || "Failed to save business profile.");
    } finally {
      setSaving(false);
    }
  }

  function updateField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          isEditing ? (
            <>
              <button className="secondary-button" onClick={handleCancel} type="button">
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={saving}
                form="business-profile-form"
                type="submit"
              >
                <Save size={16} />
                {saving ? "Saving…" : "Save profile"}
              </button>
            </>
          ) : (
            <button className="primary-button" disabled={loading} onClick={handleEdit} type="button">
              <Pencil size={16} />
              Edit profile
            </button>
          )
        }
        copy="Company identity and primary contact details for your organization."
        title="Business Profile"
      />

      {saveMessage ? <div className="form-success-banner">{saveMessage}</div> : null}
      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          <section className="onboarding-card lead-dashboard-panel">
            <div className="lead-dashboard-panel__heading">
              <div className="lead-dashboard-panel__heading-icon">
                <Building2 size={18} strokeWidth={2} />
              </div>
              <div>
                <h2>Company details</h2>
                <p>Profile fields used across Setup Workspace.</p>
              </div>
            </div>

            {loading ? (
              <p style={{ fontSize: "13px", margin: 0 }}>Loading profile…</p>
            ) : isEditing ? (
              <form className="setup-form-panel" id="business-profile-form" onSubmit={handleSave}>
                <div className="setup-form-grid">
                  {PROFILE_FIELDS.map((field) => (
                    <label className="field" key={field.key}>
                      <span>{field.label}</span>
                      {field.type === "select" ? (
                        <select
                          onChange={(event) => updateField(field.key, event.target.value)}
                          value={draft[field.key] || ""}
                        >
                          <option value="">Select business type</option>
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          onChange={(event) => updateField(field.key, event.target.value)}
                          type={field.type || "text"}
                          value={draft[field.key] || ""}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </form>
            ) : (
              <div className="setup-detail-grid">
                {PROFILE_FIELDS.map((field) => (
                  <div className="setup-detail-item" key={field.key}>
                    <span>{field.label}</span>
                    <strong>{profile[field.key] || "—"}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
