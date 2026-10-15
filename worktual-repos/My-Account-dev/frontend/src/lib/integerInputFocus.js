/**
 * Integer / decimal fields often default to `0`. On focus, select that zero so the
 * next keystroke replaces it. Also normalize values like `04555` → `4555` while
 * typing (covers cases where click caret placement clears the selection).
 * Non-zero values such as `100` are left alone on focus.
 */

const ZERO_VALUE_RE = /^-?0+(?:\.0+)?$/;

export function isExactZeroInputValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }
  return ZERO_VALUE_RE.test(raw);
}

/**
 * Strip redundant leading zeros while typing (`04555` → `4555`, `00.5` → `0.5`).
 * Preserves in-progress strings like `.`, `0.`, `-`, `-0.`.
 */
export function normalizeNumericInputValue(value) {
  const raw = String(value ?? "");
  if (!raw) {
    return raw;
  }
  if (raw === "-" || raw === "." || raw === "-.") {
    return raw;
  }

  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const prefix = negative ? "-" : "";

  if (body.endsWith(".") && !body.slice(0, -1).includes(".")) {
    const whole = body.slice(0, -1);
    if (!whole) {
      return `${prefix}.`;
    }
    if (!/^\d+$/.test(whole)) {
      return raw;
    }
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
    return `${prefix}${normalizedWhole}.`;
  }

  if (body.includes(".")) {
    const [wholePart, fraction = ""] = body.split(".");
    if (wholePart !== "" && !/^\d+$/.test(wholePart)) {
      return raw;
    }
    if (fraction !== "" && !/^\d*$/.test(fraction)) {
      return raw;
    }
    const normalizedWhole =
      wholePart === "" ? "" : wholePart.replace(/^0+(?=\d)/, "") || "0";
    return `${prefix}${normalizedWhole}.${fraction}`;
  }

  if (!/^\d+$/.test(body)) {
    return raw;
  }
  const normalized = body.replace(/^0+(?=\d)/, "") || "0";
  return `${prefix}${normalized}`;
}

function isPhoneLikeInput(el) {
  if (el.type === "tel") {
    return true;
  }
  if (el.closest(".mobile-field")) {
    return true;
  }
  const autocomplete = String(el.autocomplete || "").toLowerCase();
  if (autocomplete === "tel" || autocomplete === "tel-national" || autocomplete === "tel-local") {
    return true;
  }
  const name = String(el.name || el.id || "").toLowerCase();
  if (/(^|[_-])(phone|mobile|national)([_-]|$)/.test(name)) {
    return true;
  }
  return false;
}

export function isIntegerLikeInput(el) {
  if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) {
    return false;
  }
  if (el.dataset.selectZero === "false") {
    return false;
  }
  if (isPhoneLikeInput(el)) {
    return false;
  }

  const type = String(el.type || "text").toLowerCase();
  if (type === "number") {
    return true;
  }
  if (type !== "text" && type !== "search") {
    return false;
  }

  if (el.dataset.selectZero === "true" || el.dataset.integerInput === "true") {
    return true;
  }

  const mode = String(el.inputMode || "").toLowerCase();
  return mode === "numeric" || mode === "decimal";
}

function selectZeroValue(el) {
  try {
    el.select();
  } catch {
    /* ignore unsupported select() */
  }
}

function scheduleSelectZero(el) {
  selectZeroValue(el);
  requestAnimationFrame(() => {
    if (document.activeElement === el && isExactZeroInputValue(el.value)) {
      selectZeroValue(el);
    }
  });
  window.setTimeout(() => {
    if (document.activeElement === el && isExactZeroInputValue(el.value)) {
      selectZeroValue(el);
    }
  }, 0);
}

/**
 * Focus handler for a single input (also usable as `onFocus={selectZeroOnFocus}`).
 */
export function selectZeroOnFocus(event) {
  const el = event?.currentTarget || event?.target;
  if (!(el instanceof HTMLInputElement)) {
    return;
  }
  if (!isIntegerLikeInput(el) || !isExactZeroInputValue(el.value)) {
    return;
  }

  scheduleSelectZero(el);

  // Mouse click places the caret after focus and can clear the selection.
  const onMouseUp = (mouseEvent) => {
    mouseEvent.preventDefault();
    selectZeroValue(el);
    el.removeEventListener("mouseup", onMouseUp);
  };
  el.addEventListener("mouseup", onMouseUp);
  window.setTimeout(() => el.removeEventListener("mouseup", onMouseUp), 500);
}

function setInputValueForReact(el, nextValue) {
  const previous = el.value;
  if (previous === nextValue) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(el, nextValue);
  } else {
    el.value = nextValue;
  }

  // Keep React controlled inputs in sync with the normalized DOM value.
  const tracker = el._valueTracker;
  if (tracker && typeof tracker.setValue === "function") {
    tracker.setValue(previous);
  }

  const cursor = nextValue.length;
  try {
    el.setSelectionRange(cursor, cursor);
  } catch {
    /* type=number may not support selection range in every browser */
  }

  return true;
}

function onNumericInput(event) {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || !isIntegerLikeInput(el)) {
    return;
  }

  // type=number often normalizes in the browser; still try when readable.
  const current = el.value;
  const normalized = normalizeNumericInputValue(current);
  if (normalized === current) {
    return;
  }

  setInputValueForReact(el, normalized);
}

/**
 * App-wide: select exact `0` on focus, and strip leading zeros while typing.
 */
export function installSelectZeroOnFocus(root = document) {
  if (typeof root?.addEventListener !== "function") {
    return () => {};
  }

  // Re-bind on HMR / repeated install so the latest handlers are active.
  if (typeof root.__worktualSelectZeroOnFocusInstalled === "function") {
    root.__worktualSelectZeroOnFocusInstalled();
  }

  function onFocusIn(event) {
    selectZeroOnFocus(event);
  }

  function onClick(event) {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) {
      return;
    }
    if (!isIntegerLikeInput(el) || !isExactZeroInputValue(el.value)) {
      return;
    }
    scheduleSelectZero(el);
  }

  function onInput(event) {
    onNumericInput(event);
  }

  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("click", onClick, true);
  // Capture so the DOM value is normalized before React's bubbled onChange reads it.
  root.addEventListener("input", onInput, true);

  const uninstall = () => {
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("input", onInput, true);
    delete root.__worktualSelectZeroOnFocusInstalled;
  };

  root.__worktualSelectZeroOnFocusInstalled = uninstall;
  return uninstall;
}
