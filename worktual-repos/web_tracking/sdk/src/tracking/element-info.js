import { ELEMENT_TEXT_MAX_LEN } from '../core/constants.js';

/** @param {EventTarget | null | undefined} target */
export function getElementInfo(target) {
  const element = /** @type {HTMLElement | null} */ (target);
  if (!element?.tagName) return {};

  return {
    element: element.tagName.toLowerCase(),
    elementType: element.getAttribute('type') || undefined,
    elementText: (element.textContent || '').trim().slice(0, ELEMENT_TEXT_MAX_LEN) || undefined,
    href: element.getAttribute('href') || undefined,
  };
}

/** @param {EventTarget | null | undefined} target */
export function getClickTarget(target) {
  const element = /** @type {HTMLElement | null} */ (target);
  return element?.closest?.('a,button,[role=button],div,span') || element;
}
