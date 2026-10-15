import { maskFieldValue, shouldMaskField } from '../privacy/consent.js';

const FIELD_SELECTOR = 'input, textarea, select';
const FIELD_INPUT_SELECTOR = 'input:not([type=hidden]), textarea, select';

/** @param {EventTarget|null} target */
export function findInputFromFieldBlockClick(target) {
  if (!(target instanceof Element)) return null;
  if (target.matches(FIELD_INPUT_SELECTOR)) {
    return /** @type {HTMLInputElement} */ (target);
  }

  const block = target.closest(
    'label, [class*="formblockinner"], [class*="form-group"], [class*="formlabel"]',
  );
  const searchRoot = block?.parentElement || target.parentElement;
  if (!searchRoot) return null;

  const input = searchRoot.querySelector(FIELD_INPUT_SELECTOR);
  if (!input || shouldMaskField(/** @type {HTMLInputElement} */ (input))) return null;
  return /** @type {HTMLInputElement} */ (input);
}

/** @param {string} text */
function slugifyFieldKey(text) {
  if (!text) return undefined;
  const slug = text.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return slug || undefined;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function labelForField(el) {
  const id = el.id;
  if (id && typeof document !== 'undefined') {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) return slugifyFieldKey(label.textContent);
    } catch {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label?.textContent) return slugifyFieldKey(label.textContent);
    }
  }
  const parentLabel = el.closest('label');
  if (parentLabel?.textContent) return slugifyFieldKey(parentLabel.textContent);
  return undefined;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
export function resolveFieldKey(el) {
  return (
    el.name
    || el.getAttribute('data-wt-field')
    || labelForField(el)
    || slugifyFieldKey(el.id)
    || el.id
    || slugifyFieldKey(el.getAttribute('placeholder'))
    || undefined
  );
}

/** @param {Element} root */
export function collectFieldsFromContainer(root) {
  /** @type {Record<string, string>} */
  const fields = {};
  if (!root?.querySelectorAll) return fields;

  root.querySelectorAll(FIELD_SELECTOR).forEach((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    if (shouldMaskField(input)) return;
    const key = resolveFieldKey(input);
    if (!key) return;
    if (input.type === 'checkbox') {
      fields[key] = input.checked ? (input.value || 'true') : 'false';
      return;
    }
    if (input.type === 'radio') {
      if (input.checked) fields[key] = input.value;
      return;
    }
    fields[key] = input.value;
  });

  return fields;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
export function fieldMeta(el) {
  return {
    fieldName: resolveFieldKey(el),
    fieldType: el.getAttribute('type') || el.tagName.toLowerCase(),
    fieldValue: maskFieldValue(el),
  };
}

/** @param {Element} root @param {string} [submitSelector] */
export function findSubmitControl(root, submitSelector) {
  if (submitSelector) {
    const found = root.querySelector(submitSelector);
    if (found) return found;
  }
  const explicit = (
    root.querySelector('[data-wt-submit]')
    || root.querySelector('button[type="submit"]')
    || root.querySelector('input[type="submit"]')
    || root.querySelector('button:not([type="button"])')
    || root.querySelector('[role="button"]')
  );
  if (explicit) return explicit;

  // React/Vue often use type="button" + onClick — treat lone button as submit.
  const buttons = root.querySelectorAll('button');
  if (buttons.length === 1) return buttons[0];

  return root.querySelector('button[type="button"]');
}
