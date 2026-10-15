import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { getLeadCountryDefaults } from "./countryDefaults.js";
import {
  billingGroupLabel,
  groupAssignmentsByBillingTarget,
  normalizeAssignmentsBilling,
  resolveInvoiceMode,
  validateInvoiceModeForAssignments,
} from "./assignments.js";
import { formatLeadAddresses, getBranchById, getBranchTaxNumber, HQ_BRANCH_ID } from "./leads.js";
import { getCcaasPlanLabel } from "./ccaasPlans.js";
import {
  isModuleBillable,
  isPerAgentModuleOption,
} from "./ccaasModules.js";
import { getModuleDisplayLabel } from "./planModules.js";
import {
  createDefaultCcaasAddons,
  createDefaultUsageDetails,
  getCcaasConfigurationFields,
} from "./ccaasConfiguration.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import { emptyInvoiceBreakdown, isFeatureEnabled } from "./pricingFeatures.js";
import { getContactChargeSlabs, getTicketSlabs } from "./pricingRuntime.js";

const COMPANY = {
  name: "Worktual",
  tagline: "Enterprise Software Provider",
  address:
    "Second Floor, SAI SADHAN, TS No 125, North Phase, Thiru Vi Ka Industrial Estate, Ekkatuthangal, Chennai, Tamil Nadu 600032, India",
  phone: "073388 72200",
  email: "ajsworktual@gmail.com",
};

const GST_RATE = 0.18;
const HSN_SAC = "998315";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(currency, amount) {
  return formatMoneyDisplay(currency, amount);
}

function formatMoneyDisplay(currency, amount) {
  const value = toNumber(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (currency === "INR") {
    return `Rs. ${value}`;
  }

  return `${currency} ${value}`;
}

function discountAmount(config, amount) {
  const discountValue = toNumber(config.discountValue);
  if (config.discountType === "fixed") {
    return Math.min(discountValue, amount);
  }
  return Math.min(amount * (discountValue / 100), amount);
}

function ccaasLines(config) {
  const lines = [];
  const modulesConfig = config.modules || {};
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const addons = config.addons || createDefaultCcaasAddons();

  if (config.licenseTier) {
    lines.push({
      section: "License Plan",
      label: getCcaasPlanLabel(config.licenseTier) || config.licenseTier,
      amount: 0,
    });
  }

  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!isModuleBillable(selection)) {
      continue;
    }

    let amount = toNumber(selection.price);
    const agentCount = Math.max(1, toNumber(usageDetails.agentCount) || 0);

    if (isPerAgentModuleOption(moduleId, selection.optionId)) {
      amount *= agentCount;
    }

    lines.push({
      section: "CCaaS Modules",
      label: getModuleDisplayLabel(moduleId, selection),
      amount,
    });
  }

  const catalog = getCachedPricingCatalog();
  const tierDefaultVolumes = catalog.products?.["contact-center"]?.tierDefaultVolumes || {};
  const configurationFields = getCcaasConfigurationFields(
    modulesConfig,
    config.licenseTier,
    tierDefaultVolumes,
  );

  for (const field of configurationFields) {
    const value = usageDetails[field.id];
    if (!value) {
      continue;
    }

    lines.push({
      section: "Configuration",
      label: `${field.label}: ${value}`,
      amount: 0,
    });
  }

  if (addons.sessionBundle && addons.sessionBundle !== "none") {
    const sessionLabel =
      addons.sessionBundle === "custom"
        ? `${addons.sessionCount || "Custom"} sessions`
        : `${Number(addons.sessionBundle).toLocaleString()} sessions`;

    lines.push({
      section: "Add-ons",
      label: `Sessions — ${sessionLabel}`,
      amount: toNumber(addons.sessionPrice),
    });
  }

  if (addons.multilingualOption === "addon") {
    lines.push({
      section: "Add-ons",
      label: "Multilingual add-on",
      amount: toNumber(addons.multilingualPrice),
    });
  }

  const monthlySubtotal = lines
    .filter((line) => line.type !== "setup")
    .reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = lines
    .filter((line) => line.type === "setup")
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, monthlySubtotal);

  return { lines, currency: config.currency || "INR", monthlySubtotal, setupSubtotal, discount };
}

function simpleLines(config, sectionLabel) {
  const currency = config.currency || "INR";
  const monthlySubtotal = toNumber(config.monthlyBasePrice);
  const setupSubtotal = toNumber(config.setupFee || config.implementationCost || config.implementationFee);
  const discount = discountAmount(config, monthlySubtotal);

  return {
    lines: [{ section: sectionLabel, label: "Monthly base price", amount: monthlySubtotal }],
    currency,
    monthlySubtotal,
    setupSubtotal,
    discount,
  };
}

function crmLines(config) {
  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "usersEnabled")) {
    lines.push({
      section: "CRM License",
      label: `${config.userCount} users @ ${config.userLicenseRate}/user`,
      amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
    });
  }

  if (config.additionalContactsEnabled) {
    lines.push({
      section: "CRM License",
      label: `Additional contacts slab (${config.additionalContactSlab})`,
      amount: toNumber(getContactChargeSlabs(config.region)[config.additionalContactSlab]?.monthlyPrice),
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationCost)
    : 0;
  const discount = discountAmount(config, monthlySubtotal);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function cdpLines(config) {
  if (!isFeatureEnabled(config, "platformEnabled")) {
    return emptyInvoiceBreakdown(config.currency);
  }

  return simpleLines(config, "CDP Platform");
}

function campaignLines(config) {
  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "basePlanEnabled")) {
    lines.push({
      section: "Campaign Plan",
      label: "Monthly base price",
      amount: toNumber(config.monthlyBasePrice),
    });
  }

  if (config.additionalContactsEnabled) {
    lines.push({
      section: "Campaign Plan",
      label: `Additional contacts slab (${config.additionalContactSlab})`,
      amount: toNumber(getContactChargeSlabs(config.region)[config.additionalContactSlab]?.monthlyPrice),
    });
  }

  if (isFeatureEnabled(config, "channelsEnabled")) {
    const channelAmount =
      toNumber(config.emailCount) * toNumber(config.emailRate) +
      toNumber(config.smsCount) * toNumber(config.smsRate) +
      toNumber(config.whatsappCredits) * toNumber(config.whatsappRate) +
      toNumber(config.webPushSubscribers) * toNumber(config.webPushRate) +
      toNumber(config.appPushSubscribers) * toNumber(config.appPushRate) +
      toNumber(config.inAppSubscribers) * toNumber(config.inAppRate);

    if (channelAmount > 0) {
      lines.push({
        section: "Campaign Plan",
        label: "Channel usage",
        amount: channelAmount,
      });
    }
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, monthlySubtotal);

  return { lines, currency, monthlySubtotal, setupSubtotal: 0, discount };
}

function valueManagementLines(config) {
  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "subscriptionEnabled")) {
    lines.push({
      section: "Customer Value Management",
      label: "Monthly base price",
      amount: toNumber(config.monthlyBasePrice),
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const discount = discountAmount(config, monthlySubtotal);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function ticketingLines(config) {
  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "usersEnabled")) {
    lines.push({
      section: "Ticketing License",
      label: `${config.userCount} users @ ${config.userLicenseRate}/user`,
      amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
    });
  }

  if (config.additionalTicketsEnabled) {
    lines.push({
      section: "Ticketing License",
      label: `Additional tickets slab (${config.additionalTicketSlab})`,
      amount: toNumber(getTicketSlabs(config.region)[config.additionalTicketSlab]?.monthlyPrice),
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, monthlySubtotal);

  return { lines, currency, monthlySubtotal, setupSubtotal: 0, discount };
}

function getProductInvoice(product, config) {
  if (!config) {
    return null;
  }

  let breakdown;
  if (config.pricingMode === "ccaas") {
    breakdown = ccaasLines(config);
  } else if (config.pricingMode === "crm") {
    breakdown = crmLines(config);
  } else if (config.pricingMode === "cdp") {
    breakdown = cdpLines(config);
  } else if (config.pricingMode === "campaign") {
    breakdown = campaignLines(config);
  } else if (config.pricingMode === "value-management") {
    breakdown = valueManagementLines(config);
  } else if (config.pricingMode === "ticketing") {
    breakdown = ticketingLines(config);
  } else {
    breakdown = simpleLines(config, product.name);
  }

  const monthlySubtotal = Math.max(breakdown.monthlySubtotal - breakdown.discount, 0);
  const multiplier = config.billingCycle === "yearly" ? 12 : 1;
  const finalMonthly = monthlySubtotal * multiplier;
  const totalDue = finalMonthly + breakdown.setupSubtotal;
  const billingLabel = config.billingCycle === "yearly" ? "Yearly" : "Monthly";

  return {
    productName: product.name,
    ...breakdown,
    finalMonthly,
    totalDue,
    billingLabel,
    multiplier,
  };
}

/** Logo for invoice header — icon only on dark background */
export async function prepareInvoiceLogo(logoUrl, { forDarkBackground = true, iconOnly = true } = {}) {
  const response = await fetch(logoUrl);
  if (!response.ok) {
    throw new Error("Could not load company logo.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const sourceWidth = iconOnly
          ? Math.max(Math.floor(image.naturalWidth * 0.22), 1)
          : image.naturalWidth;
        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");

        if (!forDarkBackground) {
          context.filter = "brightness(0)";
        }

        context.drawImage(
          image,
          0,
          0,
          sourceWidth,
          image.naturalHeight,
          0,
          0,
          sourceWidth,
          image.naturalHeight,
        );

        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          width: sourceWidth,
          height: image.naturalHeight,
        });
      };
      image.onerror = () => reject(new Error("Could not process company logo."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function splitAddressLines(address, maxWidth, doc) {
  return doc.splitTextToSize(address, maxWidth);
}

function formatInvoiceDate(date = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function capitalizeWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function numberToWordsIndian(amount) {
  const rupees = Math.floor(toNumber(amount));
  const paise = Math.round((toNumber(amount) - rupees) * 100);

  if (rupees === 0 && paise === 0) {
    return "Zero Rupees Only";
  }

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigit(value) {
    if (value < 20) {
      return ones[value];
    }

    const remainder = value % 10;
    return `${tens[Math.floor(value / 10)]}${remainder ? ` ${ones[remainder]}` : ""}`.trim();
  }

  function threeDigit(value) {
    if (value >= 100) {
      const remainder = value % 100;
      return `${ones[Math.floor(value / 100)]} Hundred${remainder ? ` And ${twoDigit(remainder)}` : ""}`.trim();
    }

    return twoDigit(value);
  }

  function convert(value) {
    if (value >= 10000000) {
      const crores = Math.floor(value / 10000000);
      const remainder = value % 10000000;
      return `${convert(crores)} Crore${remainder ? ` ${convert(remainder)}` : ""}`.trim();
    }

    if (value >= 100000) {
      const lakhs = Math.floor(value / 100000);
      const remainder = value % 100000;
      return `${convert(lakhs)} Lakh${remainder ? ` ${convert(remainder)}` : ""}`.trim();
    }

    if (value >= 1000) {
      const thousands = Math.floor(value / 1000);
      const remainder = value % 1000;
      return `${threeDigit(thousands)} Thousand${remainder ? ` And ${threeDigit(remainder)}` : ""}`.trim();
    }

    return threeDigit(value);
  }

  let words = `${convert(rupees)} Rupees`;
  if (paise > 0) {
    words += ` And ${convert(paise)} Paise`;
  }

  return `${capitalizeWords(words)} Only`;
}

function buildProductDescription(item, locationLabel = "") {
  const recurringLabel = item.billingLabel === "Yearly" ? "Yearly" : "Monthly";
  const parts = item.lines.map((line) => `${line.section}: ${line.label}`);

  if (item.changeTypeLabel && item.changeTypeLabel !== "New") {
    parts.unshift(`Type: ${item.changeTypeLabel}`);
  }

  if (locationLabel) {
    parts.unshift(`Location: ${locationLabel}`);
  }

  parts.push(`HSN/SAC: ${HSN_SAC}`);
  parts.push(`${recurringLabel} billing`);

  if (item.discount > 0) {
    parts.push("Discount applied on subtotal");
  }

  return parts.join("\n");
}

function buildInvoiceRows(productInvoices, locationLabel = "") {
  const rows = [];

  for (const item of productInvoices) {
    const itemLocation = item.locationLabel || locationLabel;

    rows.push({
      product: item.productName,
      description: buildProductDescription(item, itemLocation),
      qty: "1",
      unitPrice: item.finalMonthly,
      subtotal: item.finalMonthly,
      currency: item.currency,
    });

    if (item.setupSubtotal > 0) {
      rows.push({
        product: `${item.productName} — Setup`,
        description: `One-time implementation / setup fee\nHSN/SAC: ${HSN_SAC}`,
        qty: "1",
        unitPrice: item.setupSubtotal,
        subtotal: item.setupSubtotal,
        currency: item.currency,
      });
    }
  }

  return rows;
}

function drawSectionLabel(doc, label, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(label.toUpperCase(), x, y);
}

function measureWrappedLines(doc, lines, maxWidth, lineHeight = 3.6) {
  let height = 0;

  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, maxWidth);
    height += wrapped.length * lineHeight;
  }

  return height;
}

function drawFooterBox(doc, x, y, width, title, lines) {
  const padding = 3;
  const titleHeight = 6;
  const contentHeight = measureWrappedLines(doc, lines, width - padding * 2);
  const height = titleHeight + contentHeight + padding * 2;

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  doc.text(title, x + padding, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(70, 70, 70);

  let lineY = y + titleHeight + padding;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, width - padding * 2);
    doc.text(wrapped, x + padding, lineY);
    lineY += wrapped.length * 3.6;
  }

  return height;
}

function drawFinancialSummary(doc, x, y, width, currency, subtotal, cgst, sgst, grandTotal) {
  const rowHeight = 5.5;
  const padding = 4;
  const rows = [
    ["Subtotal", formatMoneyDisplay(currency, subtotal)],
    ["@ 9% CGST", formatMoneyDisplay(currency, cgst)],
    ["@ 9% SGST", formatMoneyDisplay(currency, sgst)],
  ];

  const height = padding * 2 + 8 + rows.length * rowHeight + 8;

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text("Financial Summary", x + padding, y + 6);

  let rowY = y + 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);

  for (const [label, value] of rows) {
    doc.text(label, x + padding, rowY);
    doc.text(value, x + width - padding, rowY, { align: "right" });
    rowY += rowHeight;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(x + padding, rowY, x + width - padding, rowY);
  rowY += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text("Total Amount:", x + padding, rowY);
  doc.text(formatMoneyDisplay(currency, grandTotal), x + width - padding, rowY, { align: "right" });

  return height;
}

function ensureSpace(doc, y, needed, margin) {
  const pageHeight = doc.internal.pageSize.getHeight();

  if (y + needed <= pageHeight - margin) {
    return y;
  }

  doc.addPage();
  return margin;
}

function renderInvoiceHeader(doc, { logo, invoiceNumber, invoiceDate, margin, pageWidth }) {
  const logoWidthMm = 28;
  const logoHeightMm = (logo.height / logo.width) * logoWidthMm;
  const companyInfoX = margin + logoWidthMm + 8;
  const companyInfoWidth = pageWidth - companyInfoX - margin - 46;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const headerAddressLines = splitAddressLines(COMPANY.address, companyInfoWidth, doc);
  const headerContactLines = [`Phone: ${COMPANY.phone}`, `Email: ${COMPANY.email}`];
  const headerTextBlockHeight =
    5 + headerAddressLines.length * 3.4 + headerContactLines.length * 3.4;
  const headerHeight = Math.max(logoHeightMm + 14, headerTextBlockHeight + 14, 40);

  doc.setFillColor(26, 26, 26);
  doc.rect(0, 0, pageWidth, headerHeight, "F");

  const logoY = (headerHeight - logoHeightMm) / 2;
  doc.addImage(logo.dataUrl, "PNG", margin, logoY, logoWidthMm, logoHeightMm);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(COMPANY.tagline, companyInfoX, logoY + 4);

  doc.setFontSize(7);
  let headerLineY = logoY + 9;
  headerAddressLines.forEach((line) => {
    doc.text(line, companyInfoX, headerLineY);
    headerLineY += 3.4;
  });
  headerContactLines.forEach((line) => {
    doc.text(line, companyInfoX, headerLineY);
    headerLineY += 3.4;
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Invoice #: ${invoiceNumber}`, pageWidth - margin, logoY + 4, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Date: ${formatInvoiceDate(invoiceDate)}`, pageWidth - margin, logoY + 10, {
    align: "right",
  });

  return headerHeight;
}

function renderCustomerBlock(doc, {
  lead,
  billingAddress,
  billingLabel,
  country = "",
  taxNumber = "",
  margin,
  contentWidth,
  y,
}) {
  const leftColWidth = contentWidth * 0.52;
  const rightColX = margin + leftColWidth + 8;
  const rightColWidth = contentWidth - leftColWidth - 8;
  const customerStartY = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(lead.companyName || "—", margin, y + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text(billingLabel ? `Bill to (${billingLabel}):` : "Billing Address:", margin, y + 11);

  const resolvedAddress =
    billingAddress ||
    lead.billingAddress ||
    formatLeadAddresses(lead)
      .map((entry) => entry.address)
      .filter(Boolean)
      .join(", ") ||
    "—";

  const resolvedCountry = country || lead.country || "";
  const taxDefaults = getLeadCountryDefaults(resolvedCountry);
  const resolvedTaxNumber = taxNumber || lead.taxNumber || "";

  let addressBlock = resolvedAddress;
  if (resolvedCountry) {
    addressBlock += `\n${resolvedCountry}`;
  }
  if (resolvedTaxNumber) {
    addressBlock += `\n${taxDefaults.taxFieldLabel}: ${resolvedTaxNumber}`;
  }

  const billingLines = doc.splitTextToSize(addressBlock, leftColWidth - 2);
  doc.text(billingLines, margin, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text("Primary Contact", rightColX, y + 4);

  const contactLines = [
    `Name: ${lead.contactName || "—"}`,
    `Title: ${lead.designation || "—"}`,
    `Email: ${lead.workEmail || "—"}`,
    `Phone: ${lead.mobileNumber ? `${lead.mobileCountryCode || ""} ${lead.mobileNumber}`.trim() : "—"}`,
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);

  let contactY = y + 11;
  for (const line of contactLines) {
    const wrapped = doc.splitTextToSize(line, rightColWidth);
    doc.text(wrapped, rightColX, contactY);
    contactY += wrapped.length * 4.2;
  }

  const leftBlockHeight = 16 + billingLines.length * 4;
  const rightBlockHeight = contactY - customerStartY;

  return customerStartY + Math.max(leftBlockHeight, rightBlockHeight, 24) + 10;
}

function renderItemsTable(doc, { productInvoices, margin, contentWidth, y }) {
  drawSectionLabel(doc, "Items", margin, y);
  y += 5;

  const invoiceRows = buildInvoiceRows(productInvoices);
  const colProduct = 30;
  const colQty = 10;
  const colPrice = 30;
  const colSubtotal = 30;
  const colDescription = contentWidth - colProduct - colQty - colPrice - colSubtotal;

  const tableBody = invoiceRows.map((row) => [
    row.product,
    row.description,
    row.qty,
    formatMoneyDisplay(row.currency, row.unitPrice),
    formatMoneyDisplay(row.currency, row.subtotal),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Product/Service", "Description", "Qty", "Unit Price", "Subtotal"]],
    body: tableBody,
    tableWidth: contentWidth,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
      textColor: [30, 30, 30],
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [90, 90, 90],
      fontStyle: "bold",
      fontSize: 7,
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: colProduct, fontStyle: "bold" },
      1: { cellWidth: colDescription },
      2: { halign: "center", cellWidth: colQty },
      3: { halign: "right", cellWidth: colPrice },
      4: { halign: "right", cellWidth: colSubtotal, fontStyle: "bold" },
    },
    didParseCell(data) {
      if (data.section === "body" && (data.column.index === 3 || data.column.index === 4)) {
        data.cell.styles.fontSize = 7;
      }
    },
  });

  return {
    finalY: doc.lastAutoTable.finalY + 12,
    invoiceRows,
  };
}

function renderInvoiceFooter(doc, {
  margin,
  pageWidth,
  contentWidth,
  y,
  currency,
  invoiceRows,
  invoiceDate,
}) {
  const subtotal = invoiceRows.reduce((sum, row) => sum + row.subtotal, 0);
  const cgst = subtotal * (GST_RATE / 2);
  const sgst = subtotal * (GST_RATE / 2);
  const grandTotal = subtotal + cgst + sgst;

  const summaryWidth = 78;
  const summaryX = pageWidth - margin - summaryWidth;
  const wordsWidth = contentWidth - summaryWidth - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);

  const wordsText = `Amount in words: ${numberToWordsIndian(grandTotal)}`;
  const wordsLines = doc.splitTextToSize(wordsText, wordsWidth);
  const wordsHeight = wordsLines.length * 4.2;

  y = ensureSpace(doc, y, Math.max(wordsHeight, 40) + 12, margin);
  doc.text(wordsLines, margin, y);

  const summaryHeight = drawFinancialSummary(
    doc,
    summaryX,
    y,
    summaryWidth,
    currency,
    subtotal,
    cgst,
    sgst,
    grandTotal,
  );

  y += Math.max(wordsHeight, summaryHeight) + 14;

  const footerBoxWidth = (contentWidth - 8) / 3;
  const validityEnd = new Date(invoiceDate);
  validityEnd.setDate(validityEnd.getDate() + 30);
  const billingStart = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), 1);
  const billingEnd = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 1, 0);

  const footerSections = [
    {
      title: "Terms & Conditions",
      lines: [
        "Validity Period",
        `This quotation is valid until ${formatInvoiceDate(validityEnd)}.`,
        "Prices are subject to applicable taxes as mentioned above.",
      ],
    },
    {
      title: "Payment Terms",
      lines: [
        `Due on ${formatInvoiceDate(invoiceDate)}`,
        `Billing period: ${formatInvoiceDate(billingStart)} to ${formatInvoiceDate(billingEnd)}`,
      ],
    },
    {
      title: "Delivery Timeline",
      lines: [
        "Monthly invoices will be generated at the start of each billing cycle.",
        "GST will be applied as per prevailing tax regulations.",
      ],
    },
  ];

  const estimatedFooterHeight =
    Math.max(
      ...footerSections.map((section) =>
        12 + measureWrappedLines(doc, section.lines, footerBoxWidth - 6),
      ),
    ) + 8;

  y = ensureSpace(doc, y, estimatedFooterHeight, margin);

  const footerHeights = footerSections.map((section, index) =>
    drawFooterBox(
      doc,
      margin + index * (footerBoxWidth + 4),
      y,
      footerBoxWidth,
      section.title,
      section.lines,
    ),
  );

  return y + Math.max(...footerHeights) + margin;
}

function buildInvoicePdf({
  lead,
  logo,
  productInvoices,
  billingAddress,
  billingLabel = "",
  country = "",
  taxNumber = "",
  invoiceNumberSuffix = "",
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const currency = productInvoices[0]?.currency || "INR";
  const invoiceDate = new Date();
  const invoiceNumber = `WT-${invoiceDate.getFullYear()}-${lead.domainId || "0000"}${invoiceNumberSuffix}`;

  const headerHeight = renderInvoiceHeader(doc, {
    logo,
    invoiceNumber,
    invoiceDate,
    margin,
    pageWidth,
  });

  let y = headerHeight + 10;

  drawSectionLabel(doc, "Customer details", margin, y);
  y += 6;

  y = renderCustomerBlock(doc, {
    lead,
    billingAddress,
    billingLabel,
    country,
    taxNumber,
    margin,
    contentWidth,
    y,
  });

  const { finalY, invoiceRows } = renderItemsTable(doc, {
    productInvoices,
    margin,
    contentWidth,
    y,
  });

  renderInvoiceFooter(doc, {
    margin,
    pageWidth,
    contentWidth,
    y: finalY,
    currency,
    invoiceRows,
    invoiceDate,
  });

  return doc;
}

function buildConsolidatedInvoicePdf({ lead, logo, billingGroups }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const invoiceDate = new Date();
  const invoiceNumber = `WT-${invoiceDate.getFullYear()}-${lead.domainId || "0000"}`;

  const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);
  const currency = allProductInvoices[0]?.currency || "INR";

  const headerHeight = renderInvoiceHeader(doc, {
    logo,
    invoiceNumber,
    invoiceDate,
    margin,
    pageWidth,
  });

  let y = headerHeight + 10;

  drawSectionLabel(doc, "Customer details", margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(lead.companyName || "—", margin, y + 4);
  y += 12;

  const allInvoiceRows = [];

  for (const group of billingGroups) {
    y = ensureSpace(doc, y, 40, margin);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(`Bill to: ${group.label}`, margin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(70, 70, 70);
    const groupCountry = group.country || lead.country || "";
    const groupTaxDefaults = getLeadCountryDefaults(groupCountry);
    const groupTaxLine = group.taxNumber
      ? `\n${groupTaxDefaults.taxFieldLabel}: ${group.taxNumber}`
      : "";
    const addressLines = doc.splitTextToSize(
      `${group.address}\n${groupCountry}${groupTaxLine}`,
      contentWidth * 0.6,
    );
    doc.text(addressLines, margin, y);
    y += addressLines.length * 4.2 + 6;

    const { finalY, invoiceRows } = renderItemsTable(doc, {
      productInvoices: group.productInvoices,
      margin,
      contentWidth,
      y,
    });

    allInvoiceRows.push(...invoiceRows);
    y = finalY;
  }

  renderInvoiceFooter(doc, {
    margin,
    pageWidth,
    contentWidth,
    y,
    currency,
    invoiceRows: allInvoiceRows,
    invoiceDate,
  });

  return doc;
}

function assignmentToProductInvoice(product, assignment, lead) {
  const invoice = getProductInvoice(product, assignment.config);
  if (!invoice || invoice.totalDue <= 0) {
    return null;
  }

  return {
    ...invoice,
    locationLabel: getBranchById(lead, assignment.branchId)?.label || "—",
    changeTypeLabel: assignment.changeType
      ? assignment.changeType.charAt(0).toUpperCase() + assignment.changeType.slice(1)
      : "New",
  };
}

function computeGroupSubtotal(productInvoices, locationLabel = "") {
  const rows = buildInvoiceRows(productInvoices, locationLabel);
  return rows.reduce((sum, row) => sum + row.subtotal, 0);
}

function computeGroupTotals(productInvoices, locationLabel = "") {
  const subtotal = Math.round(computeGroupSubtotal(productInvoices, locationLabel) * 100) / 100;
  const currency = productInvoices[0]?.currency || "INR";
  const cgst = subtotal * (GST_RATE / 2);
  const sgst = subtotal * (GST_RATE / 2);
  const grandTotal = Math.round((subtotal + cgst + sgst) * 100) / 100;

  return {
    subtotal,
    cgst,
    sgst,
    grandTotal,
    currency,
    gstRate: GST_RATE,
  };
}

export function computeQuotationPaymentTotals({ assignments, products, lead }) {
  const normalizedAssignments = normalizeAssignmentsBilling(assignments);
  const billingGroups = buildBillingGroups(normalizedAssignments, products, lead);

  if (!billingGroups.length) {
    return {
      subtotal: 0,
      grandTotal: 0,
      currency: "INR",
      gstRate: GST_RATE,
    };
  }

  let subtotal = 0;
  let currency = "INR";

  for (const group of billingGroups) {
    subtotal += computeGroupSubtotal(group.productInvoices, group.label);
    currency = group.productInvoices[0]?.currency || currency;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const grandTotal = Math.round(subtotal * (1 + GST_RATE) * 100) / 100;

  return {
    subtotal,
    grandTotal,
    currency,
    gstRate: GST_RATE,
  };
}

function buildBillingGroups(assignments, products, lead) {
  const grouped = groupAssignmentsByBillingTarget(assignments);
  const billingGroups = [];

  for (const [billingTargetId, groupAssignments] of grouped.entries()) {
    const branch = getBranchById(lead, billingTargetId);
    const productInvoices = groupAssignments
      .map((assignment) => {
        const product = products.find((entry) => entry.id === assignment.productId);
        return assignmentToProductInvoice(product, assignment, lead);
      })
      .filter(Boolean);

    if (productInvoices.length === 0) {
      continue;
    }

    billingGroups.push({
      billingTargetId,
      label: billingGroupLabel(lead, billingTargetId),
      address: branch?.address || lead.billingAddress || "—",
      country: branch?.country || lead.country || "",
      taxNumber: getBranchTaxNumber(lead, billingTargetId),
      productInvoices,
    });
  }

  return billingGroups;
}

function invoiceSuffixForBillingTarget(billingTargetId, index) {
  if (billingTargetId === HQ_BRANCH_ID) {
    return index > 0 ? "-HQ" : "";
  }

  return `-${String(billingTargetId).slice(0, 4).toUpperCase()}`;
}

async function pdfToResult(doc, fileName) {
  const dataUrl = doc.output("datauristring");
  const blob = doc.output("blob");
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return {
    blob,
    dataUrl,
    fileName,
    pdfBase64: btoa(binary),
  };
}

export async function buildQuotationInvoice({
  lead,
  logoUrl,
  products,
  productConfigs,
  assignments,
  invoiceMode = "consolidated",
}) {
  if (!lead) {
    throw new Error("Lead details are missing.");
  }

  const logo = await prepareInvoiceLogo(logoUrl);
  const safeCompanyName = (lead.companyName || "lead").replace(/[^\w-]+/g, "-");

  if (assignments?.length) {
    const normalizedAssignments = normalizeAssignmentsBilling(assignments);
    const effectiveInvoiceMode = resolveInvoiceMode(normalizedAssignments, lead, invoiceMode);
    const validationError = validateInvoiceModeForAssignments(
      normalizedAssignments,
      lead,
      effectiveInvoiceMode,
    );

    if (validationError) {
      throw new Error(validationError);
    }

    const billingGroups = buildBillingGroups(normalizedAssignments, products, lead);

    if (billingGroups.length === 0) {
      throw new Error(
        "Cannot create an invoice with zero purchase amount. Enable and configure at least one product feature with pricing.",
      );
    }

    if (effectiveInvoiceMode === "per_branch" && billingGroups.length > 1) {
      const invoices = [];

      for (let index = 0; index < billingGroups.length; index += 1) {
        const group = billingGroups[index];
        const suffix = invoiceSuffixForBillingTarget(group.billingTargetId, index);
        const doc = buildInvoicePdf({
          lead,
          logo,
          productInvoices: group.productInvoices,
          billingAddress: group.address,
          billingLabel: group.label,
          country: group.country,
          taxNumber: group.taxNumber,
          invoiceNumberSuffix: suffix,
        });
        const totals = computeGroupTotals(group.productInvoices, group.label);
        const fileName = `Worktual-Invoice-${safeCompanyName}-${lead.domainId || "lead"}${suffix}.pdf`;
        const result = await pdfToResult(doc, fileName);

        invoices.push({
          billingTargetId: group.billingTargetId,
          branchLabel: group.label,
          label: group.label,
          ...totals,
          ...result,
        });
      }

      const primary = invoices[0];
      const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);

      return {
        invoiceMode: effectiveInvoiceMode,
        invoices,
        blob: primary.blob,
        dataUrl: primary.dataUrl,
        fileName: primary.fileName,
        pdfBase64: primary.pdfBase64,
        productInvoices: allProductInvoices,
        billingGroups,
      };
    }

    const doc =
      billingGroups.length === 1
        ? buildInvoicePdf({
            lead,
            logo,
            productInvoices: billingGroups[0].productInvoices,
            billingAddress: billingGroups[0].address,
            billingLabel: billingGroups[0].label,
            country: billingGroups[0].country,
            taxNumber: billingGroups[0].taxNumber,
          })
        : buildConsolidatedInvoicePdf({ lead, logo, billingGroups });

    const fileName = `Worktual-Invoice-${safeCompanyName}-${lead.domainId || "lead"}.pdf`;
    const result = await pdfToResult(doc, fileName);
    const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);
    const totals = computeQuotationPaymentTotals({
      assignments: normalizedAssignments,
      products,
      lead,
    });

    return {
      invoiceMode: effectiveInvoiceMode,
      invoices: [
        {
          billingTargetId: billingGroups[0].billingTargetId,
          branchLabel: billingGroups.length === 1 ? billingGroups[0].label : "Consolidated",
          label: billingGroups.length === 1 ? billingGroups[0].label : "Consolidated",
          ...totals,
          ...result,
        },
      ],
      ...result,
      ...totals,
      productInvoices: allProductInvoices,
      billingGroups,
    };
  }

  const productInvoices = products
    .map((product) => getProductInvoice(product, productConfigs[product.id]))
    .filter(Boolean);

  if (productInvoices.length === 0) {
    throw new Error("No product pricing found for this quotation.");
  }

  const doc = buildInvoicePdf({ lead, logo, productInvoices });
  const fileName = `Worktual-Invoice-${safeCompanyName}-${lead.domainId || "lead"}.pdf`;
  const result = await pdfToResult(doc, fileName);

  return {
    invoiceMode: "consolidated",
    invoices: [{ billingTargetId: HQ_BRANCH_ID, label: "Head office", ...result }],
    ...result,
    productInvoices,
    billingGroups: [],
  };
}

export async function downloadQuotationInvoice({
  lead,
  logoUrl,
  products,
  productConfigs,
  assignments,
  invoiceMode,
}) {
  const { blob, fileName } = await buildQuotationInvoice({
    lead,
    logoUrl,
    products,
    productConfigs,
    assignments,
    invoiceMode,
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export { getProductInvoice };
