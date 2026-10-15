import { config } from '../core/state.js';

/** Maps form_* event names to config flags (see core/config.js). */
const EVENT_FLAGS = {
  form_view: 'trackFormView',
  form_start: 'trackFormStart',
  form_focus: 'trackFormFocus',
  form_blur: 'trackFormBlur',
  form_change: 'trackFormChange',
  form_validation: 'trackFormValidation',
  form_submit: 'trackFormSubmit',
  form_success: 'trackFormSuccess',
  form_failure: 'trackFormFailure',
  form_abandon: 'trackFormAbandon',
};

/** @param {string} eventName */
export function shouldTrackFormEvent(eventName) {
  if (!config?.trackForms) return false;
  const flag = EVENT_FLAGS[eventName];
  if (!flag) return false;
  return config[flag] === true;
}
