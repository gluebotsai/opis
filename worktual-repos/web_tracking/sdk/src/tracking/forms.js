import { maskFieldValue, shouldMaskField } from '../privacy/consent.js';
import { config, state } from '../core/state.js';
import { createTracker } from './tracker.js';
import { collectFieldsFromContainer, fieldMeta } from './form-fields.js';
import { shouldTrackFormEvent } from './form-events.js';

const { bindTrack, track: formsTrackFn } = createTracker();
export { bindTrack };

const formState = new WeakMap();

function formMeta(form) {
  return {
    formId: form.id || form.name || undefined,
    formName: form.getAttribute('name') || undefined,
    formAction: form.action || undefined,
  };
}

function trackFormEvent(name, props) {
  if (!shouldTrackFormEvent(name)) return;
  formsTrackFn(name, props);
}

export function setupFormTracking() {
  if (!config?.trackForms || state.modules.forms) return;
  state.modules.forms = true;

  if (typeof IntersectionObserver === 'undefined') return;

  const observer = new IntersectionObserver((entries) => {
    if (!shouldTrackFormEvent('form_view')) return;
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const form = /** @type {HTMLFormElement} */ (entry.target);
        if (!formState.get(form)?.viewed) {
          formState.set(form, { viewed: true, started: false });
          trackFormEvent('form_view', formMeta(form));
        }
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('form').forEach((form) => observer.observe(form));

  document.addEventListener('focusin', (e) => {
    if (!shouldTrackFormEvent('form_focus') && !shouldTrackFormEvent('form_start')) return;
    const el = /** @type {HTMLElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form || shouldMaskField(/** @type {HTMLInputElement} */ (el))) return;
    const st = formState.get(form) || {};
    if (!st.started) {
      st.started = true;
      formState.set(form, st);
      trackFormEvent('form_start', formMeta(form));
    }
    trackFormEvent('form_focus', { ...formMeta(form), fieldName: el.name || el.id, fieldType: el.getAttribute('type') });
  }, true);

  document.addEventListener('focusout', (e) => {
    if (!shouldTrackFormEvent('form_blur')) return;
    const el = /** @type {HTMLElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_blur', { ...formMeta(form), ...fieldMeta(/** @type {HTMLInputElement} */ (el)) });
  }, true);

  document.addEventListener('change', (e) => {
    if (!shouldTrackFormEvent('form_change')) return;
    const el = /** @type {HTMLInputElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_change', {
      ...formMeta(form),
      ...fieldMeta(el),
    });
  }, true);

  document.addEventListener('invalid', (e) => {
    if (!shouldTrackFormEvent('form_validation')) return;
    const el = /** @type {HTMLInputElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_validation', { ...formMeta(form), fieldName: el.name || el.id, valid: false });
  }, true);

  document.addEventListener('submit', (e) => {
    if (!shouldTrackFormEvent('form_submit')) return;
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form?.tagName || form.tagName !== 'FORM') return;
    trackFormEvent('form_submit', { ...formMeta(form), fields: collectFieldsFromContainer(form) });
  }, true);

  window.addEventListener('beforeunload', () => {
    if (!shouldTrackFormEvent('form_abandon')) return;
    document.querySelectorAll('form').forEach((form) => {
      const st = formState.get(form);
      if (st?.started && !st?.completed) {
        trackFormEvent('form_abandon', formMeta(form));
      }
    });
  });
}

export function trackFormSuccess(form, props = {}) {
  if (!shouldTrackFormEvent('form_success')) return;
  const st = formState.get(form) || {};
  st.completed = true;
  formState.set(form, st);
  trackFormEvent('form_success', { ...formMeta(form), fields: collectFieldsFromContainer(form), ...props });
}

export function trackFormFailure(form, props = {}) {
  if (!shouldTrackFormEvent('form_failure')) return;
  trackFormEvent('form_failure', { ...formMeta(form), ...props });
}
