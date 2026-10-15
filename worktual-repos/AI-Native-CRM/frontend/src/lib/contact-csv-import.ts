/** Sample CSVs for contact import (Load sample / Download). */

export const CONTACT_CSV_SAMPLE_B2B = `first_name,last_name,email,phone,title,company,company_domain,contact_type,lead_status,lead_source,status
Priya,Nair,priya.nair@acme.com,+91 98765 43210,VP Sales,Acme Corp,acme.com,lead,new,csv_import,active
James,Chen,james.chen@globex.io,+1 415 555 0199,Director,Globex,globex.io,lead,contacted,csv_import,active
`;

export const CONTACT_CSV_SAMPLE_B2C = `first_name,last_name,email,phone,title,contact_type,lead_status,lead_source,status
Asha,Patel,asha.patel@gmail.com,+1 206 555 0144,,lead,new,csv_import,active
`;

export function contactCsvSample(businessType: string | null | undefined): string {
  return businessType === "b2c" ? CONTACT_CSV_SAMPLE_B2C : CONTACT_CSV_SAMPLE_B2B;
}

export const CONTACT_CSV_REQUIRED_HINT =
  "Required: first_name, last_name, email. Optional: phone, title, company, company_domain, contact_type, lead_status, lead_source, status, city, country, notes.";
