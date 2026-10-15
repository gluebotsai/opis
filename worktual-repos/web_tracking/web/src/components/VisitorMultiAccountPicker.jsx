import {
  visitorContactTypeLabel,
  visitorMultiAccountOptionTitle,
} from '../utils/visitorProfileDisplay';

/**
 * Shared browser: multiple CDP accounts linked to the same visitor_id.
 * @param {{ analyticsScope: object, selectedCdpId: string, onSelect: (cdpId: string) => void }} props
 */
export default function VisitorMultiAccountPicker({ analyticsScope, selectedCdpId, onSelect }) {
  if (!analyticsScope || analyticsScope.scope !== 'multi_account_browser') return null;

  const profiles = analyticsScope.linked_cdp_profiles ?? [];
  if (profiles.length < 2) return null;

  return (
    <div className="visitor-combined-scope-banner visitor-multi-account-picker" role="region" aria-label="Select account">
      <h3 className="visitor-multi-account-picker-title">Multiple accounts on this browser</h3>
      <div className="visitor-multi-account-options" role="radiogroup" aria-label="Account">
        {profiles.map((profile) => {
          const active = profile.cdp_id === selectedCdpId;
          const title = visitorMultiAccountOptionTitle(profile);
          const methodLabel = visitorContactTypeLabel(profile);
          const email = String(profile.primary_email ?? '').trim();
          const showEmailMeta = email && email !== title;
          return (
            <button
              key={profile.cdp_id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`visitor-multi-account-option${active ? ' is-active' : ''}`}
              onClick={() => onSelect(profile.cdp_id)}
            >
              <span className="visitor-multi-account-option-indicator" aria-hidden="true">
                {active ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="visitor-multi-account-option-indicator-ring" />
                )}
              </span>
              <span className="visitor-multi-account-option-body">
                <span className="visitor-multi-account-option-name">{title}</span>
                {methodLabel ? (
                  <span className="visitor-multi-account-option-meta">{methodLabel}</span>
                ) : null}
                {showEmailMeta ? (
                  <span className="visitor-multi-account-option-meta">{email}</span>
                ) : null}
              </span>
              {active ? (
                <span className="visitor-multi-account-option-selected-label">Selected</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
