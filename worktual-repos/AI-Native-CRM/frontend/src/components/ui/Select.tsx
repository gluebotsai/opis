import {
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
} from "react";
import { DropdownSelect } from "./DropdownSelect";

interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  label?: ReactNode;
  error?: string;
  options: { value: string; label: string }[];
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className = "",
      label,
      error,
      id,
      options,
      name,
      value,
      onChange,
      disabled,
      required,
      ...props
    },
    ref,
  ) => {
    const fieldId = id ?? name;
    const stringValue = value == null ? "" : String(value);

    const emitChange = (nextValue: string) => {
      onChange?.({
        target: { value: nextValue, name: name ?? "" },
        currentTarget: { value: nextValue, name: name ?? "" },
      } as ChangeEvent<HTMLSelectElement>);
    };

    return (
      <div className="flex w-full flex-col gap-2">
        {label ? (
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
            {required ? (
              <span className="ml-0.5 text-text-danger" aria-hidden>
                *
              </span>
            ) : null}
          </label>
        ) : null}
        <DropdownSelect
          id={fieldId}
          value={stringValue}
          options={options}
          disabled={disabled}
          fullWidth
          size="lg"
          aria-label={
            typeof props["aria-label"] === "string"
              ? props["aria-label"]
              : typeof label === "string"
                ? label
                : undefined
          }
          className={className}
          buttonClassName={`text-text-primary focus:ring-2 focus:ring-border-focus/20 ${
            error ? "border-text-danger" : ""
          }`}
          onChange={emitChange}
        />
        <select
          ref={ref}
          name={name}
          value={stringValue}
          required={required}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={() => {}}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error ? <p className="text-xs text-text-danger">{error}</p> : null}
      </div>
    );
  },
);

Select.displayName = "Select";
