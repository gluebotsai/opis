import { config, state } from '../core/state.js';
import { createTracker } from './tracker.js';
import { collectFieldsFromContainer, fieldMeta, findSubmitControl, findInputFromFieldBlockClick } from './form-fields.js';
import { deriveFormId, discoverFormRoots, findFormRoot, findFormRootFromElement } from './form-discovery.js';
import { shouldTrackFormEvent } from './form-events.js';

const { bindTrack, track: leadTrackFn } = createTracker();
export { bindTrack };

const WT_FORM_ATTR = 'data-wt-form';
const registeredRoots = new WeakSet();
/** @type {Map<string, Element>} */
const formIdToRoot = new Map();
/** @type {WeakMap<Element, { formId: string, started: boolean, completed: boolean, wired: boolean }>} */
const leadState = new WeakMap();
/** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
const inputDebounceTimers = new WeakMap();

/** @type {MutationObserver | null} */
let domObserver = null;

function resolveRoot(root) {
  if (!root) return null;
  if (typeof root === 'string') return document.querySelector(root);
  if (root instanceof Element) return root;
  return null;
}

function isLeadFormRegistered(root) {
  return registeredRoots.has(root);
}

function leadMeta(formId, root) {
  return {
    formId,
    formName: root.getAttribute('name') || root.getAttribute(WT_FORM_ATTR) || formId,
  };
}

/** @param {string} formId @param {Element} root @param {Record<string, unknown>} [extra] */
function emit(formId, root, name, extra = {}) {
  if (!shouldTrackFormEvent(name)) return;
  const fields = collectFieldsFromContainer(root);
  const props = {
    ...leadMeta(formId, root),
    ...extra,
  };
  if (name === 'form_submit' || name === 'form_success' || name === 'form_failure') {
    props.fields = fields;
  }
  leadTrackFn(name, props);
}

function wireSubmit(formId, root, submitEl, autoSuccess) {
  submitEl.addEventListener('click', () => {
    const st = leadState.get(root);
    if (!st) return;
    emit(formId, root, 'form_submit');
    if (autoSuccess) {
      st.completed = true;
      emit(formId, root, 'form_success');
    }
  });
}

function bindLeadFormRoot(formId, root, options = {}) {
  if (!formId || !root || registeredRoots.has(root)) return false;

  const submitEl = findSubmitControl(root, options.submit);
  registeredRoots.add(root);
  formIdToRoot.set(formId, root);
  leadState.set(root, { formId, started: false, completed: false, wired: true });

  root.addEventListener('focusin', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    const st = leadState.get(root);
    if (!st) return;
    if (!st.started) {
      st.started = true;
      emit(formId, root, 'form_start');
    }
    emit(formId, root, 'form_focus', fieldMeta(/** @type {HTMLInputElement} */ (el)));
  }, true);

  root.addEventListener('focusout', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    emit(formId, root, 'form_blur', fieldMeta(/** @type {HTMLInputElement} */ (el)));
  }, true);

  root.addEventListener('change', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    emit(formId, root, 'form_change', fieldMeta(el));
  }, true);

  root.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    const prev = inputDebounceTimers.get(el);
    if (prev) clearTimeout(prev);
    inputDebounceTimers.set(el, setTimeout(() => {
      inputDebounceTimers.delete(el);
      emit(formId, root, 'form_change', fieldMeta(el));
    }, 300));
  }, true);

  root.addEventListener('click', (e) => {
    const input = findInputFromFieldBlockClick(e.target);
    if (!input || !root.contains(input) || input === e.target) return;
    if (document.activeElement !== input) input.focus();
  }, true);

  if (submitEl) {
    wireSubmit(formId, root, submitEl, options.autoSuccess === true);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          emit(formId, root, 'form_view');
          observer.disconnect();
        }
      });
    }, { threshold: 0.5 });
    observer.observe(root);
  }

  return true;
}

/** @param {Element} fieldEl */
function ensureLeadFormBound(fieldEl) {
  if (!fieldEl?.matches?.('input, textarea, select')) return null;
  if (fieldEl.closest('form')) return null;

  const root = findFormRoot(fieldEl);
  if (!root) return null;
  if (registeredRoots.has(root)) return root;

  const formId = deriveFormId(root, formIdToRoot.size);
  bindLeadFormRoot(formId, root, {});

  const st = leadState.get(root);
  if (st && !st.started) {
    st.started = true;
    emit(formId, root, 'form_start');
  }
  emit(formId, root, 'form_focus', fieldMeta(/** @type {HTMLInputElement} */ (fieldEl)));
  return root;
}

function scanHeuristicForms() {
  if (config.leadFormHeuristicScan === false) return;
  discoverFormRoots(isLeadFormRegistered).forEach((root, index) => {
    const formId = deriveFormId(root, formIdToRoot.size + index);
    bindLeadFormRoot(formId, root, {});
  });
}

function setupLazyFormDiscovery() {
  if (config.leadFormHeuristicScan === false) return;

  document.addEventListener('focusin', (e) => {
    scanAllLeadForms();
    const el = /** @type {HTMLElement} */ (e.target);
    if (!el?.matches?.('input, textarea, select')) return;
    if (el.closest('form')) return;
    const root = findFormRoot(el);
    if (root && !registeredRoots.has(root)) {
      ensureLeadFormBound(el);
    }
  }, true);

  document.addEventListener('click', (e) => {
    scanAllLeadForms();
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target?.closest?.('button, [role="button"], input[type="submit"]');
    const inputFromLabel = findInputFromFieldBlockClick(target);

    if (inputFromLabel && !inputFromLabel.closest('form')) {
      const root = findFormRoot(inputFromLabel);
      if (root && !registeredRoots.has(root)) {
        ensureLeadFormBound(inputFromLabel);
      }
    }

    if (!btn || btn.closest('form')) return;

    const root = findFormRootFromElement(btn);
    if (!root || registeredRoots.has(root)) return;

    const formId = deriveFormId(root, formIdToRoot.size);
    bindLeadFormRoot(formId, root, {});
  }, true);
}

/** @param {{ formId: string, root?: string | Element, submit?: string, autoSuccess?: boolean }} opts */
export function registerLeadForm(opts) {
  const formId = opts?.formId;
  const root = resolveRoot(opts?.root);
  if (!formId || !root) return false;
  return bindLeadFormRoot(formId, root, opts);
}

function scanAutoForms() {
  document.querySelectorAll(`[${WT_FORM_ATTR}]`).forEach((root) => {
    const formId = root.getAttribute(WT_FORM_ATTR);
    if (!formId) return;
    bindLeadFormRoot(formId, root, {
      submit: root.getAttribute('data-wt-submit') || undefined,
      autoSuccess: root.getAttribute('data-wt-auto-success') === 'true',
    });
  });
}

function scanConfiguredForms() {
  const list = config?.leadForms;
  if (!Array.isArray(list)) return;
  list.forEach((item) => {
    if (!item?.formId) return;
    const root = resolveRoot(item.root);
    if (!root) return;
    bindLeadFormRoot(item.formId, root, item);
  });
}

function scanAllLeadForms() {
  scanAutoForms();
  scanConfiguredForms();
  scanHeuristicForms();
  scanKnownFormContainers();
}

function scanKnownFormContainers() {
  if (config.leadFormHeuristicScan === false) return;
  document.querySelectorAll('[class*="formblock"]:not([class*="inner"]), [class*="form_block"]:not([class*="inner"]), [role="form"]').forEach((root) => {
    if (registeredRoots.has(root)) return;
    if (root.closest('form')) return;
    const fieldCount = root.querySelectorAll('input:not([type=hidden]), textarea, select').length;
    if (fieldCount < 2 && !findSubmitControl(root)) return;
    bindLeadFormRoot(deriveFormId(root, formIdToRoot.size), root, {});
  });
}

function scheduleLeadFormRescan() {
  scanAllLeadForms();
  setTimeout(scanAllLeadForms, 100);
  setTimeout(scanAllLeadForms, 500);
}

function hookSpaFormRescan() {
  window.addEventListener('wa:navigation', scheduleLeadFormRescan);
  window.addEventListener('pageshow', scheduleLeadFormRescan);
}

function startDomObserver() {
  if (domObserver || typeof MutationObserver === 'undefined') return;
  domObserver = new MutationObserver(() => {
    scanAllLeadForms();
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
}

export function setupLeadFormTracking() {
  if (!config?.trackForms || state.modules.leadForms) return;
  state.modules.leadForms = true;

  scanAllLeadForms();
  setupLazyFormDiscovery();
  hookSpaFormRescan();

  if (config.leadFormAutoScan !== false) {
    startDomObserver();
  }

  window.addEventListener('beforeunload', () => {
    formIdToRoot.forEach((root, formId) => {
      const st = leadState.get(root);
      if (st?.started && !st?.completed) {
        emit(formId, root, 'form_abandon');
      }
    });
  });
}

/** @param {string} formId @param {Record<string, unknown>} [props] */
export function trackLeadFormSuccess(formId, props = {}) {
  if (!shouldTrackFormEvent('form_success')) return;
  const root = formIdToRoot.get(formId);
  if (!root) {
    leadTrackFn('form_success', { formId, ...props });
    return;
  }
  const st = leadState.get(root);
  if (st) st.completed = true;
  emit(formId, root, 'form_success', props);
}

/** @param {string} formId @param {Record<string, unknown>} [props] */
export function trackLeadFormFailure(formId, props = {}) {
  if (!shouldTrackFormEvent('form_failure')) return;
  const root = formIdToRoot.get(formId);
  if (!root) {
    leadTrackFn('form_failure', { formId, ...props });
    return;
  }
  emit(formId, root, 'form_failure', props);
}
