import { describe, it, expect, beforeEach } from 'vitest';
import { findFormRoot, deriveFormId, discoverFormRoots } from '../src/tracking/form-discovery.js';
import { resolveFieldKey, fieldMeta, collectFieldsFromContainer } from '../src/tracking/form-fields.js';

describe('form-discovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('discovers div with two named inputs and button', () => {
    document.body.innerHTML = `
      <div class="contact_formblock">
        <input name="name" type="text" />
        <input name="email" type="email" />
        <button type="submit">Send</button>
      </div>
    `;
    const email = document.querySelector('input[name="email"]');
    const root = findFormRoot(/** @type {HTMLInputElement} */ (email));
    expect(root?.className).toBe('contact_formblock');
    expect(deriveFormId(/** @type {Element} */ (root))).toBe('contact_formblock');
  });

  it('does not discover single search input', () => {
    document.body.innerHTML = `
      <div class="site-search">
        <input name="q" type="search" placeholder="Search" />
      </div>
    `;
    const input = document.querySelector('input');
    expect(findFormRoot(/** @type {HTMLInputElement} */ (input))).toBeNull();
  });

  it('returns null for input inside native form', () => {
    document.body.innerHTML = `
      <form id="native">
        <input name="email" type="email" />
        <button type="submit">Go</button>
      </form>
    `;
    const input = document.querySelector('input');
    expect(findFormRoot(/** @type {HTMLInputElement} */ (input))).toBeNull();
  });

  it('discovers explicit data-wt-form marker', () => {
    document.body.innerHTML = `
      <div data-wt-form="newsletter">
        <input name="email" type="email" />
      </div>
    `;
    const input = document.querySelector('input');
    const root = findFormRoot(/** @type {HTMLInputElement} */ (input));
    expect(root?.getAttribute('data-wt-form')).toBe('newsletter');
    expect(deriveFormId(/** @type {Element} */ (root))).toBe('newsletter');
  });

  it('discoverFormRoots finds unregistered div forms', () => {
    document.body.innerHTML = `
      <div class="lead_block">
        <input name="phone" type="tel" />
        <textarea name="message"></textarea>
        <button>Submit</button>
      </div>
    `;
    const roots = discoverFormRoots(() => false);
    expect(roots).toHaveLength(1);
    expect(roots[0].className).toBe('lead_block');
  });
});

describe('form-fields resolveFieldKey', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses label text when name is missing', () => {
    document.body.innerHTML = `
      <label for="full-name">Full name</label>
      <input id="full-name" type="text" value="Jane Doe" />
    `;
    const input = document.querySelector('input');
    expect(resolveFieldKey(/** @type {HTMLInputElement} */ (input))).toBe('full_name');
  });

  it('fieldMeta includes fieldValue', () => {
    document.body.innerHTML = `<input name="email" type="email" value="jane@example.com" />`;
    const input = document.querySelector('input');
    const meta = fieldMeta(/** @type {HTMLInputElement} */ (input));
    expect(meta.fieldName).toBe('email');
    expect(meta.fieldValue).toBe('jane@example.com');
  });

  it('collectFieldsFromContainer gathers values by resolved keys', () => {
    document.body.innerHTML = `
      <div id="form-root">
        <label for="fld-email">Email</label>
        <input id="fld-email" type="email" value="a@b.com" />
        <input name="phone" type="tel" value="123" />
      </div>
    `;
    const root = document.getElementById('form-root');
    const fields = collectFieldsFromContainer(/** @type {Element} */ (root));
    expect(fields.email).toBe('a@b.com');
    expect(fields.phone).toBe('123');
  });
});
