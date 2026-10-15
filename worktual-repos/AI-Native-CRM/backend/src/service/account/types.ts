export type ContactType =
  | "contact"
  | "lead"
  | "prospect"
  | "customer"
  | "churned";
/** @deprecated Use ContactType */
export type LifecycleStage = ContactType;
export type ContactStatus = "active" | "inactive" | "archived";
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualifying"
  | "qualified"
  | "disqualified"
  | "converted";

export type AccountCompany = {
  id: string | null;
  name: string;
  domain: string | null;
  industry: string | null;
};

export type AccountPerson = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  /** Extra emails beyond the primary (unique email column). */
  secondaryEmails: string[];
  /** Extra phone numbers beyond the primary. */
  secondaryPhones: string[];
  title: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  /** CRM company id (crm_qa.companies.id) */
  companyId: string | null;
  /** CRM location id (crm_qa.company_locations.id) */
  locationId: string | null;
  company: AccountCompany | null;
  ownerUserId: string | null;
  createdByUserId?: string | null;
  organizationId: string | null;
  contactType: ContactType;
  leadSource: string | null;
  leadStatus: LeadStatus;
  disqualifyReason: string | null;
  bantBudget: boolean | null;
  bantAuthority: boolean | null;
  bantNeed: boolean | null;
  bantTimeline: boolean | null;
  bantBudgetDetail?: string | null;
  bantAuthorityDetail?: string | null;
  bantNeedDetail?: string | null;
  bantTimelineDetail?: string | null;
  convertedDealId: string | null;
  tags: string[];
  status: ContactStatus;
  notes: string | null;
  /** Pinned important contacts sort to the top of lists. */
  isPinned: boolean;
  /** Vertical pack values (CRM overlay). */
  customAttributes?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePersonInput = {
  firstName: string;
  lastName: string;
  /** Primary email — optional. A reachable email or phone promotes the person to a lead. */
  email?: string | null;
  phone?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  title?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  /** CRM company id (crm_qa.companies.id) */
  companyId?: string | null;
  /** CRM location id (crm_qa.company_locations.id) */
  locationId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  createdByUserId?: string | null;
  ownerUserId?: string | null;
  organizationId?: string | null;
  contactType?: ContactType;
  leadSource?: string | null;
  leadStatus?: LeadStatus;
  disqualifyReason?: string | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  convertedDealId?: string | null;
  tags?: string[];
  status?: ContactStatus;
  notes?: string | null;
  isPinned?: boolean;
};

export type UpdatePersonInput = Partial<CreatePersonInput>;

/** CDP person (cdp.customer_profile + identity_keys) — shared identity + company denorm.

 *  Do not alter CDP columns. CRM filters live in crm.contact_profiles. */
export type ListPeopleFilters = {
  search?: string;
  contactType?: ContactType | "all";
  leadStatus?: LeadStatus | "all";
  status?: ContactStatus | "all";
  /** Filter by CRM company id (crm.contact_profiles.company_id) */
  companyId?: string | null;
  ownerUserId?: string | null;
  limit: number;
  offset: number;
};

export type ListPeopleResult = {
  items: AccountPerson[];
  total: number;
};

export interface AccountRepository {
  listPeople(filters: ListPeopleFilters): Promise<ListPeopleResult>;
  getPerson(id: string): Promise<AccountPerson | null>;
  createPerson(input: CreatePersonInput): Promise<AccountPerson>;
  updatePerson(id: string, input: UpdatePersonInput): Promise<AccountPerson>;
  setPersonPinned(id: string, isPinned: boolean): Promise<AccountPerson>;
  /** True when the CDP person row was removed. False if shared CDP FKs retain it. */
  deletePerson(id: string): Promise<boolean>;
}
