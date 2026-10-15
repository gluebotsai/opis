/**
 * Default deal title when converting a lead.
 * Prefer company + contact; avoid redundant "Opportunity — {name}".
 */

export function defaultDealTitle(input: {
  contactName?: string | null;
  companyName?: string | null;
}): string {
  const person = (input.contactName || "").trim().replace(/\s+/g, " ");
  const company = (input.companyName || "").trim().replace(/\s+/g, " ");

  if (company && person) {
    const same =
      company.toLowerCase() === person.toLowerCase() ||
      company.toLowerCase().includes(person.toLowerCase()) ||
      person.toLowerCase().includes(company.toLowerCase());
    if (!same) return `${company} — ${person}`;
    return company;
  }
  if (company) return company;
  if (person) return person;
  return "New deal";
}
