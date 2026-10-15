/** Pair Hub/API request emails with resolved CDP profile ids for identity attach. */

import { isValidEmailFormat } from "./contact-validation.js";

export type CdpEmailPair = { cdpId: string; email: string };

export function pairCdpIdsWithRequestEmails(
  cdpIds: string[],
  requestEmails: string[],
): CdpEmailPair[] {
  const cdps = [...new Set(cdpIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const emails = [
    ...new Set(
      requestEmails
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => e && isValidEmailFormat(e)),
    ),
  ];
  if (!cdps.length || !emails.length) return [];

  if (cdps.length === 1) {
    return [{ cdpId: cdps[0], email: emails[0] }];
  }
  if (emails.length === 1) {
    return cdps.map((cdpId) => ({ cdpId, email: emails[0] }));
  }
  const n = Math.min(cdps.length, emails.length);
  return Array.from({ length: n }, (_, i) => ({
    cdpId: cdps[i],
    email: emails[i],
  }));
}

export type EmailDestinationGateOpts = {
  cdpLookupIds?: string[];
  requestEmails?: string[];
  /** Hub/spoke/CRM: attach request emails to CDP when profile has no email key. */
  trustRequestEmails?: boolean;
};
