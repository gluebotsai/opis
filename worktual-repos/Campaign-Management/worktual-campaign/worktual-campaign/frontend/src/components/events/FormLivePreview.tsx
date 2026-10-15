import type { FormFieldDef, FormTheme, OpportunityEvent } from "@/lib/opportunity-events-store";
import { DEFAULT_FORM_THEME } from "@/lib/opportunity-events-store";

/** Shared live form chrome — used in editor preview and public /f/:slug page. */
export function FormLivePreview({
  event,
  values,
  onChange,
  onSubmit,
  error,
  interactive = false,
}: {
  event: Pick<
    OpportunityEvent,
    "title" | "description" | "formFields" | "theme" | "thankYouMessage"
  >;
  values?: Record<string, string>;
  onChange?: (fieldId: string, value: string) => void;
  onSubmit?: () => void;
  error?: string | null;
  interactive?: boolean;
}) {
  const theme: FormTheme = { ...DEFAULT_FORM_THEME, ...event.theme };
  const gap = `${12 * theme.spacingScale}px`;
  const radius = `${theme.borderRadiusPx}px`;

  return (
    <div
      className="flex min-h-full flex-col px-4 py-8"
      style={{
        backgroundColor: theme.backgroundColor,
        fontFamily: theme.fontFamily,
        color: theme.textColor,
      }}
    >
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center" style={{ marginBottom: gap }}>
          {theme.logoUrl ? (
            <img
              src={theme.logoUrl}
              alt=""
              className="mx-auto mb-3 h-10 object-contain"
            />
          ) : (
            <p
              className="text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: theme.mutedColor }}
            >
              Worktual Campaign
            </p>
          )}
          <h1
            className="mt-2 text-xl font-semibold"
            style={{ color: theme.textColor }}
          >
            {event.title || "Untitled form"}
          </h1>
          {event.description ? (
            <p className="mt-2 text-sm" style={{ color: theme.mutedColor }}>
              {event.description}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (interactive) onSubmit?.();
          }}
          className="p-5 shadow-sm"
          style={{
            backgroundColor: theme.surfaceColor,
            borderRadius: radius,
            border: `1px solid ${theme.mutedColor}33`,
          }}
        >
          <div className="flex flex-col" style={{ gap }}>
            {event.formFields.map((field) => (
              <FieldBlock
                key={field.id}
                field={field}
                theme={theme}
                value={values?.[field.id] ?? field.defaultValue ?? ""}
                onChange={
                  interactive && onChange
                    ? (v) => onChange(field.id, v)
                    : undefined
                }
                readOnly={!interactive}
              />
            ))}
          </div>
          {error ? (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          ) : null}
          <button
            type={interactive ? "submit" : "button"}
            className="mt-5 flex h-10 w-full items-center justify-center text-sm font-medium text-white"
            style={{
              backgroundColor: theme.primaryColor,
              borderRadius: `${Math.max(6, theme.borderRadiusPx - 4)}px`,
              marginTop: gap,
            }}
            onClick={
              interactive
                ? undefined
                : (e) => {
                    e.preventDefault();
                  }
            }
          >
            {theme.buttonText || "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}

function FieldBlock({
  field,
  theme,
  value,
  onChange,
  readOnly,
}: {
  field: FormFieldDef;
  theme: FormTheme;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  const inputStyle = {
    borderRadius: `${Math.max(6, theme.borderRadiusPx - 4)}px`,
    border: `1px solid ${theme.mutedColor}55`,
    color: theme.textColor,
    backgroundColor: theme.backgroundColor,
  } as const;

  return (
    <label className="block text-xs font-medium" style={{ color: theme.mutedColor }}>
      {field.label}
      {field.required ? <span className="text-red-500"> *</span> : null}
      {field.type === "textarea" ? (
        <textarea
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="mt-1 w-full px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
      ) : (
        <input
          type={field.type}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={field.placeholder}
          className="mt-1 h-10 w-full px-3 text-sm outline-none"
          style={inputStyle}
        />
      )}
    </label>
  );
}
