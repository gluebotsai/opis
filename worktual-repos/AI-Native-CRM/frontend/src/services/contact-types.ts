export type ContactInput = {
  firstName: string;
  lastName: string;
  /** Primary email — required unless phone is set. */
  email: string;
  phone?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  title?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  ownerUserId?: string | null;
  /** Required when a manager or admin assigns or reassigns a lead. */
  ownerChangeReason?: string | null;
  contactType?: string;
  leadSource?: string | null;
  leadStatus?: string;
  disqualifyReason?: string | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  /** What the customer actually said. Stored at 160 chars. */
  bantBudgetDetail?: string | null;
  bantAuthorityDetail?: string | null;
  bantNeedDetail?: string | null;
  bantTimelineDetail?: string | null;
  tags?: string[];
  status?: string;
  notes?: string | null;
  customAttributes?: Record<string, unknown> | null;
};
