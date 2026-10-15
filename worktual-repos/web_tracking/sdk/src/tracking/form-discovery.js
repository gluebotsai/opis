import { findSubmitControl } from './form-fields.js';

const DISC_WT_FORM_ATTR = 'data-wt-form';
const DISC_WT_NO_FORM_ATTR = 'data-wt-no-form';
const DISC_FIELD_SELECTOR = 'input:not([type=hidden]), textarea, select';
const SEARCH_KEY_RE = /^(search|query|q|s)$/i;

/** @param {Element} root */
function getTrackableFields(root) {
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(DISC_FIELD_SELECTOR)).filter((el) => !el.closest('form'));
}

/** @param {Element} root */
function hasSubmitControl(root) {
  return Boolean(findSubmitControl(root));
}

/** @param {Element} root @param {Element[]} fields */
function isSearchOnlyWidget(root, fields) {
  if (fields.length !== 1) return false;
  const el = /** @type {HTMLInputElement} */ (fields[0]);
  const type = el.getAttribute('type') || '';
  const name = el.name || el.id || '';
  if (type === 'search') return true;
  if (el.closest('[role="search"]')) return true;
  if (SEARCH_KEY_RE.test(name)) return true;
  if (root.matches('[role="search"], form[role="search"]')) return true;
  return false;
}

/** @param {Element} root */
function isExcludedRoot(root) {
  if (root.hasAttribute(DISC_WT_NO_FORM_ATTR)) return true;
  if (root.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return true;
  return false;
}

/** @param {Element} root */
function matchesExplicitMarker(root) {
  return root.hasAttribute(DISC_WT_FORM_ATTR) || root.getAttribute('role') === 'form';
}

/** @param {Element} root */
function isValidHeuristicRoot(root) {
  if (isExcludedRoot(root)) return false;
  const fields = getTrackableFields(root);
  if (isSearchOnlyWidget(root, fields)) return false;
  if (fields.length >= 2) return true;
  if (fields.length === 1 && hasSubmitControl(root)) return true;
  return false;
}

/** @param {Element} fieldEl */
export function findFormRoot(fieldEl) {
  if (!fieldEl?.matches?.('input, textarea, select')) return null;
  if (fieldEl.closest('form')) return null;
  if (fieldEl.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return null;

  let node = fieldEl.parentElement;
  while (node && node !== document.documentElement) {
    if (matchesExplicitMarker(node)) return node;
    if (isValidHeuristicRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** @param {Element} el */
export function findFormRootFromElement(el) {
  if (!el?.closest) return null;
  if (el.closest('form')) return null;
  if (el.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return null;
  if (el.matches?.('input, textarea, select')) return findFormRoot(el);

  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    if (matchesExplicitMarker(node)) return node;
    if (isValidHeuristicRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** @param {Element} root @param {number} [index] */
export function deriveFormId(root, index = 0) {
  const wtForm = root.getAttribute(DISC_WT_FORM_ATTR);
  if (wtForm) return wtForm;
  if (root.id) return root.id;

  const className = root.className;
  if (typeof className === 'string' && className.trim()) {
    const first = className.trim().split(/\s+/)[0];
    const base = first.replace(/__[a-zA-Z0-9_-]+$/, '');
    if (base) return base;
  }

  const path = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\//g, '_').replace(/^_|_$/g, '') || 'root'
    : 'root';
  return `auto_${path}_${index}`;
}

/** @param {(root: Element) => boolean} [isRegistered] */
export function discoverFormRoots(isRegistered) {
  /** @type {Element[]} */
  const roots = [];
  const seen = new Set();

  document.querySelectorAll(DISC_FIELD_SELECTOR).forEach((field) => {
    if (field.closest('form')) return;
    const root = findFormRoot(field);
    if (!root || seen.has(root)) return;
    if (isRegistered?.(root)) return;
    seen.add(root);
    roots.push(root);
  });

  return roots;
}
