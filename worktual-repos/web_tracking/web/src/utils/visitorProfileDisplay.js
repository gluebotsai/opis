/** CDP profile labels for visitors list, detail, and session replay. */

export const ANONYMOUS_SCOPE_CDP_ID = '__anonymous__';

export function visitorIsAnonymousScopeProfile(cdpProfile) {
  return String(cdpProfile?.cdp_id ?? '').trim() === ANONYMOUS_SCOPE_CDP_ID;
}

export function visitorProfileName(cdpProfile) {
  if (visitorIsAnonymousScopeProfile(cdpProfile)) return 'Anonymous';
  const name = String(cdpProfile?.display_name ?? '').trim();
  return name || 'Anonymous';
}

/** Visitors / replay list primary profile (last session or session-scoped cdp). */
export function visitorListProfileLabel(cdpProfile, lastActiveLabel) {
  const explicit = String(lastActiveLabel ?? '').trim();
  if (explicit) {
    if (isObfuscatedCustomerLabel(explicit)) return 'Anonymous';
    return explicit;
  }
  if (!cdpProfile?.cdp_id || !cdpProfile?.is_cdp_known) return 'Anonymous';
  return visitorMultiAccountOptionTitle(cdpProfile);
}

export function visitorBrowserAccountsTooltip(browserAccountLabels) {
  const labels = Array.isArray(browserAccountLabels)
    ? browserAccountLabels.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (labels.length <= 1) return '';
  return `Accounts on this browser: ${labels.join(', ')}`;
}

export function visitorIsKnown(cdpProfile) {
  if (!cdpProfile || visitorIsAnonymousScopeProfile(cdpProfile)) return false;
  return Boolean(cdpProfile.is_cdp_known);
}

const GENERIC_CONTACT_TYPES = new Set(['', 'user', 'contact', 'login', 'register', 'signup']);

export function visitorContactTypeLabel(cdpProfile) {
  if (visitorIsAnonymousScopeProfile(cdpProfile)) return 'Anonymous';
  const type = String(cdpProfile?.contact_type ?? '').trim();
  if (!visitorIsKnown(cdpProfile)) return 'Anonymous';
  if (!type || GENERIC_CONTACT_TYPES.has(type.toLowerCase())) return '';
  if (type.toLowerCase() === 'google') return 'Google';
  if (type.toLowerCase() === 'email') return 'Email';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Multi-account picker primary line (name, email, or customer id). */
function isObfuscatedCustomerLabel(label) {
  const s = String(label ?? '').trim();
  if (!s) return false;
  if (/^customer\s*[·•]\s*\S/i.test(s)) return true;
  return s.toLowerCase() === 'customer';
}

export function visitorMultiAccountOptionTitle(cdpProfile) {
  if (visitorIsAnonymousScopeProfile(cdpProfile)) return 'Anonymous';
  const first = String(cdpProfile?.first_name ?? '').trim();
  const last = String(cdpProfile?.last_name ?? '').trim();
  const joined = `${first} ${last}`.trim();
  if (joined && !GENERIC_CONTACT_TYPES.has(joined.toLowerCase()) && !isObfuscatedCustomerLabel(joined)) {
    return joined;
  }
  const name = String(cdpProfile?.display_name ?? '').trim();
  const generic =
    !name || GENERIC_CONTACT_TYPES.has(name.toLowerCase()) || isObfuscatedCustomerLabel(name);
  if (!generic) return name;
  const email = String(cdpProfile?.primary_email ?? '').trim();
  if (email) return email;
  return 'Anonymous';
}

/** @deprecated Use visitorIsAnonymousScopeProfile */
export function visitorIsGuestProfile(cdpProfile) {
  return visitorIsAnonymousScopeProfile(cdpProfile);
}

/** Header subtitle for visitor detail when CDP profile exists (contact type + email). */
export function visitorProfileHeaderSubtitle(cdpProfile) {
  if (!visitorIsKnown(cdpProfile)) return null;
  const parts = [];
  const type = String(cdpProfile?.contact_type ?? '').trim();
  if (type) parts.push(type);
  const email = String(cdpProfile?.primary_email ?? '').trim();
  if (email) parts.push(email);
  return parts.length ? parts.join(' · ') : null;
}
