import type { BusinessType } from "@/config/modules";

/** Business-type aware labels for Sales vs Commerce language. */
export function revenueObjectLabel(type: BusinessType): string {
  return type === "b2c" ? "Order" : "Opportunity";
}

export function revenuePathLabel(type: BusinessType): string {
  switch (type) {
    case "b2c":
      return "Contact → order";
    case "b2b2c":
      return "Account deals and consumer orders";
    default:
      return "Lead → deal → quote → invoice";
  }
}

export function convertLeadCtaLabel(type: BusinessType): string {
  if (type === "b2b2c") return "Convert to opportunity";
  return "Convert to deal";
}

export function contactCreateCaption(type: BusinessType): string {
  switch (type) {
    case "b2c":
      return "Create a consumer contact. Company is optional.";
    case "b2b2c":
      return "Link to a company account when this person is tied to an organization; leave empty for consumers.";
    default:
      return "Link people to company accounts when you have one.";
  }
}

export function showCompanyOnContacts(type: BusinessType): boolean {
  return type !== "b2c";
}

export function showConvertLeadCta(type: BusinessType): boolean {
  return type !== "b2c";
}

export function showBantOnContact(type: BusinessType): boolean {
  return type === "b2b" || type === "b2b2c";
}

export function commerceModuleLabel(type: BusinessType): string {
  return type === "b2b2c" ? "Commerce" : "Orders";
}
