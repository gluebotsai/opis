import {
  visitorBrowserAccountsTooltip,
  visitorListProfileLabel,
} from '../utils/visitorProfileDisplay';

/**
 * Profile column: primary label + hover list of accounts on this browser.
 */
export default function VisitorProfileNameCell({
  cdpProfile,
  browserAccountLabels,
  lastActiveLabel,
  mutedWhenAnonymous = true,
}) {
  const label = lastActiveLabel || visitorListProfileLabel(cdpProfile);
  const tooltip = visitorBrowserAccountsTooltip(browserAccountLabels);
  const known = Boolean(cdpProfile?.is_cdp_known) && label !== 'Anonymous';

  return (
    <span
      className="visitor-profile-name-cell"
      title={tooltip || undefined}
    >
      <span className={known || !mutedWhenAnonymous ? undefined : 'visitor-muted'}>
        {label}
      </span>
    </span>
  );
}
