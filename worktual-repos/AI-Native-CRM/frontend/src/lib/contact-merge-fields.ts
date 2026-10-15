export type MergeableFieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "title"
  | "addressLine"
  | "city"
  | "country"
  | "companyId"
  | "locationId"
  | "ownerUserId"
  | "contactType"
  | "leadStatus"
  | "leadSource"
  | "status"
  | "notes"
  | "convertedDealId";

export const MERGEABLE_FIELDS: Array<{
  key: MergeableFieldKey;
  label: string;
}> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Primary email" },
  { key: "phone", label: "Primary phone" },
  { key: "title", label: "Title" },
  { key: "addressLine", label: "Address" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "companyId", label: "Company" },
  { key: "locationId", label: "Location" },
  { key: "ownerUserId", label: "Owner" },
  { key: "contactType", label: "Contact type" },
  { key: "leadStatus", label: "Lead status" },
  { key: "leadSource", label: "Lead source" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
  { key: "convertedDealId", label: "Converted deal" },
];
