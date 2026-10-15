/**
 * Sample CSV for create-campaign temporary contacts.
 * Headers match campaign_session_temp_contacts / DAO input fields.
 */
export const TEMP_CONTACT_TEMPLATE_FILENAME =
  "temporary-contact-template.csv";

export const TEMP_CONTACT_CSV_HEADERS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "companyName",
  "city",
] as const;

export function temporaryContactTemplateCsv(): string {
  return `${TEMP_CONTACT_CSV_HEADERS.join(",")}\n`;
}
