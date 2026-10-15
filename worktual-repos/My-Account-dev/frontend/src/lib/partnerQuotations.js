/** Partner-facing quotation status labels (keep in sync with server/partnerQuotations.js). */
export function partnerQuotationStatusLabel(status) {
  if (!status) {
    return "Not quoted";
  }
  if (status === "Pending Finance Review") {
    return "Pending finance review";
  }
  if (status === "Approved") {
    return "Awaiting payment";
  }
  if (status === "Paid") {
    return "Paid";
  }
  if (status === "Rejected") {
    return "Rejected";
  }
  return String(status);
}

export function partnerCanViewInvoice(status) {
  return status === "Approved" || status === "Paid";
}
