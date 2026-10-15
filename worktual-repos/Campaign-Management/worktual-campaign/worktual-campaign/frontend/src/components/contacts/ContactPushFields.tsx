/**
 * App / Web push — display IDs (dash when empty); App push edit via pencil only.
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ContactPushEndpoint } from "@/services/contacts.service";

export type ContactPushFormValues = {
  appPushToken: string;
  appPushPlatform: string;
  webPushEndpoint: string;
  webPushP256dh: string;
  webPushAuth: string;
};

export const EMPTY_PUSH_FORM: ContactPushFormValues = {
  appPushToken: "",
  appPushPlatform: "android",
  webPushEndpoint: "",
  webPushP256dh: "",
  webPushAuth: "",
};

function maskToken(value: string): string {
  const v = value.trim();
  if (!v) return "-";
  if (v.length <= 16) return v;
  return `${v.slice(0, 10)}…${v.slice(-6)}`;
}

function primaryEndpoint(rows?: ContactPushEndpoint[]): string {
  const active = (rows || []).filter((r) => r.active !== false);
  const row = active[0] || rows?.[0];
  return String(row?.endpoint || "").trim();
}

function PushIdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-xs font-medium text-neutral-500">{label}</span>
      <span className="min-w-0 break-all text-right text-neutral-900">
        {maskToken(value)}
      </span>
    </div>
  );
}

/** Read-only App push ID + Web push ID (dash when empty). */
export function ContactPushRegistered({
  appPush,
  webPush,
}: {
  appPush?: ContactPushEndpoint[];
  webPush?: ContactPushEndpoint[];
}) {
  return (
    <div className="space-y-2">
      <PushIdRow label="App push ID" value={primaryEndpoint(appPush)} />
      <PushIdRow label="Web push ID" value={primaryEndpoint(webPush)} />
    </div>
  );
}

/** App push token + platform only (opened from pencil). */
export function ContactPushAppEditFields({
  values,
  onChange,
}: {
  values: ContactPushFormValues;
  onChange: (next: ContactPushFormValues) => void;
}) {
  const set = (patch: Partial<ContactPushFormValues>) =>
    onChange({ ...values, ...patch });

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_7.5rem]">
      <Input
        label="App push ID"
        name="appPushToken"
        placeholder="FCM or APNs device token"
        value={values.appPushToken}
        onChange={(e) => set({ appPushToken: e.target.value })}
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-text-caption">
          Platform
        </span>
        <select
          className="h-10 w-full rounded-lg border border-border-default bg-white px-3 text-sm text-text-primary"
          value={values.appPushPlatform}
          onChange={(e) => set({ appPushPlatform: e.target.value })}
        >
          <option value="android">Android</option>
          <option value="ios">iOS</option>
        </select>
      </label>
    </div>
  );
}

/** @deprecated Prefer ContactPushAppEditFields — kept for form typing compatibility. */
export function ContactPushFields({
  values,
  onChange,
}: {
  values: ContactPushFormValues;
  onChange: (next: ContactPushFormValues) => void;
}) {
  return <ContactPushAppEditFields values={values} onChange={onChange} />;
}

/** Hint removed — kept as empty stub so old imports do not break. */
export function ContactPushHint() {
  return null;
}

/**
 * Audience / detail panel: IDs + optional App-push pencil edit.
 */
export function ContactPushPanel({
  appPush,
  webPush,
  editable = false,
  values,
  onChange,
  onSave,
  saving = false,
  error = null,
  saveDisabled = false,
  embedded = false,
  showSectionTitle = true,
  className = "",
}: {
  appPush?: ContactPushEndpoint[];
  webPush?: ContactPushEndpoint[];
  editable?: boolean;
  values?: ContactPushFormValues;
  onChange?: (next: ContactPushFormValues) => void;
  onSave?: () => void | boolean | Promise<void | boolean>;
  saving?: boolean;
  error?: string | null;
  saveDisabled?: boolean;
  /** Inside profile header card — no outer bordered section. */
  embedded?: boolean;
  showSectionTitle?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(editable && values && onChange && onSave);

  const inner = (
    <>
      {showSectionTitle || canEdit ? (
        <div className="flex items-center justify-between gap-2">
          {showSectionTitle ? (
            <h3 className="text-sm font-semibold text-neutral-900">
              App / Web push
            </h3>
          ) : (
            <span />
          )}
          {canEdit ? (
            <button
              type="button"
              className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-200/80 hover:text-neutral-900"
              aria-label={editing ? "Close App push edit" : "Edit App push"}
              onClick={() => setEditing((v) => !v)}
            >
              <Pencil className="size-[18px]" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={showSectionTitle || canEdit ? "mt-3" : ""}>
        <ContactPushRegistered appPush={appPush} webPush={webPush} />
      </div>
      {canEdit && editing && values && onChange ? (
        <div className="mt-3 space-y-3 border-t border-[#bfbfbf]/80 pt-3">
          <ContactPushAppEditFields values={values} onChange={onChange} />
          {error ? (
            <p className="text-xs text-text-danger">{error}</p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="h-8 text-xs"
            disabled={saving || saveDisabled || !values.appPushToken.trim()}
            onClick={() => {
              void (async () => {
                const result = await onSave?.();
                if (result !== false) setEditing(false);
              })();
            }}
          >
            {saving ? "Saving…" : "Save App push"}
          </Button>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <section
      className={`mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 ${className}`.trim()}
    >
      {inner}
    </section>
  );
}
