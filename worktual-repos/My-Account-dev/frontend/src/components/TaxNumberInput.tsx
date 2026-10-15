// @ts-nocheck
import { useLayoutEffect, useRef } from "react";

import {
  restoreTaxNumberCaret,
  sanitizeTaxNumberInputPreservingCaret,
} from "../lib/taxNumber.js";

/**
 * Controlled GST / tax ID input that keeps the caret in place when sanitizing
 * (uppercase + strip non-alphanumeric) so mid-string edits do not jump to the end.
 */
export function TaxNumberInput({
  value = "",
  onValueChange,
  onBlur,
  maxLength,
  className,
  ...props
}) {
  const inputRef = useRef(null);
  const caretRef = useRef(null);

  useLayoutEffect(() => {
    if (caretRef.current == null || !inputRef.current) {
      return;
    }
    const pos = caretRef.current;
    caretRef.current = null;
    restoreTaxNumberCaret(inputRef.current, pos);
  });

  return (
    <input
      {...props}
      autoCapitalize={props.autoCapitalize ?? "characters"}
      className={className}
      maxLength={maxLength}
      onBlur={onBlur}
      onChange={(event) => {
        const input = event.currentTarget;
        const { value: nextValue, caret } = sanitizeTaxNumberInputPreservingCaret(
          input.value,
          input.selectionStart,
        );
        caretRef.current = caret;
        onValueChange?.(nextValue);
      }}
      ref={inputRef}
      type="text"
      value={value}
    />
  );
}
