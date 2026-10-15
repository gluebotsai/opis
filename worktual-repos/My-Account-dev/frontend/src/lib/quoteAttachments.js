export function getQuoteSessionAttachments(quoteSession) {
  if (!quoteSession) {
    return [];
  }

  if (Array.isArray(quoteSession.invoices) && quoteSession.invoices.length > 0) {
    return quoteSession.invoices
      .filter((entry) => entry?.pdfBase64 && entry?.fileName)
      .map((entry) => ({
        fileName: entry.fileName,
        contentBase64: entry.pdfBase64,
      }));
  }

  if (quoteSession.pdfBase64 && quoteSession.fileName) {
    return [
      {
        fileName: quoteSession.fileName,
        contentBase64: quoteSession.pdfBase64,
      },
    ];
  }

  return [];
}

export function buildMailAttachmentPayload(attachments) {
  if (!attachments.length) {
    return {};
  }

  if (attachments.length === 1) {
    return { attachment: attachments[0] };
  }

  return { attachments };
}

export function buildQuotationPreviewEntries(quotation) {
  if (!quotation) {
    return [];
  }

  if (Array.isArray(quotation.invoices) && quotation.invoices.length > 0) {
    return quotation.invoices
      .filter((entry) => entry?.pdfBase64)
      .map((entry, index) => ({
        id: entry.fileName || `invoice-${index}`,
        fileName: entry.fileName || `invoice-${index + 1}.pdf`,
        pdfDataUrl: `data:application/pdf;base64,${entry.pdfBase64}`,
        label:
          entry.billingLabel ||
          entry.branchLabel ||
          entry.fileName ||
          `Invoice ${index + 1}`,
      }));
  }

  if (quotation.pdfBase64) {
    return [
      {
        id: quotation.fileName || "invoice",
        fileName: quotation.fileName || "quotation.pdf",
        pdfDataUrl: `data:application/pdf;base64,${quotation.pdfBase64}`,
        label: quotation.fileName || "Invoice",
      },
    ];
  }

  return [];
}

/** Preview entries from server-generated per-product invoice PDFs. */
export function buildProductInvoicePreviewEntries(quotation) {
  if (!quotation || !Array.isArray(quotation.productInvoices)) {
    return [];
  }

  return quotation.productInvoices
    .filter((entry) => entry?.pdfBase64)
    .map((entry, index) => ({
      id: entry.id || entry.productId || `product-invoice-${index}`,
      fileName: entry.fileName || `invoice-${index + 1}.pdf`,
      pdfDataUrl: `data:application/pdf;base64,${entry.pdfBase64}`,
      label: entry.label || entry.billingLabel || entry.productId || `Product ${index + 1}`,
      productId: entry.productId || "",
      branchLabel: entry.branchLabel || "",
    }));
}
