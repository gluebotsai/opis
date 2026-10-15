// @ts-nocheck
import { Eye, X } from "lucide-react";

import { buildSidebarPricingBreakdown } from "../../lib/ccaasSidebarBreakdown.js";
import {
  groupProductRequestDetailRows,
  summarizeProductRequestAssignment,
} from "../../lib/customerProductRequests.js";

function formatMoney(currency, amount) {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  return `${currency || "INR"} ${safe.toLocaleString("en-IN")}`;
}

function formatQtyRate(line) {
  const parts = [];
  if (line.qty !== undefined && line.qty !== null && line.qty !== "") {
    parts.push(`Qty ${line.qty}`);
  }
  if (line.rate !== undefined && line.rate !== null && line.rate !== "") {
    parts.push(`@ ${line.rate}`);
  }
  return parts.join(" · ");
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extra priced rows (setup / implementation / discount) that the sales sidebar
 * often rolls into totals rather than listing as line items.
 */
function buildSetupAndDiscountRows(config = {}) {
  const currency = config.currency || "INR";
  const rows = [];

  const implementationEnabled = config.implementationEnabled !== false;
  const implementationFee = toFiniteNumber(
    config.implementationFee ?? config.implementationCost ?? config.setupFee,
  );
  if (implementationEnabled && implementationFee !== null && implementationFee > 0) {
    rows.push({
      label: "Implementation / setup fee",
      value: formatMoney(currency, implementationFee),
      section: "Setup",
    });
  } else if (config.implementationPurchased === true) {
    rows.push({
      label: "Implementation",
      value: "Already purchased",
      section: "Setup",
    });
  } else if (config.implementationEnabled === false) {
    rows.push({
      label: "Implementation",
      value: "Not included",
      section: "Setup",
    });
  }

  const discountAmount = toFiniteNumber(config.discountAmount);
  const discountPercent = toFiniteNumber(config.discountPercent ?? config.discount);
  if (discountAmount !== null && discountAmount > 0) {
    rows.push({
      label: "Discount amount",
      value: formatMoney(currency, discountAmount),
      section: "Discount",
    });
  } else if (discountPercent !== null && discountPercent > 0) {
    rows.push({
      label: "Discount",
      value: `${discountPercent}%`,
      section: "Discount",
    });
  } else {
    const monthlyDiscountValue = toFiniteNumber(config.discountValue);
    if (monthlyDiscountValue !== null && monthlyDiscountValue > 0) {
      rows.push({
        label: "Plan discount",
        value:
          config.discountType === "fixed"
            ? formatMoney(currency, monthlyDiscountValue)
            : `${monthlyDiscountValue}%`,
        section: "Discount",
      });
    }
  }

  const implementationDiscountValue = toFiniteNumber(config.implementationDiscountValue);
  if (implementationDiscountValue !== null && implementationDiscountValue > 0) {
    rows.push({
      label: "Implementation discount",
      value:
        config.implementationDiscountType === "fixed"
          ? formatMoney(currency, implementationDiscountValue)
          : `${implementationDiscountValue}%`,
      section: "Discount",
    });
  }

  const addonDiscountValue = toFiniteNumber(config.addonDiscountValue);
  if (addonDiscountValue !== null && addonDiscountValue > 0) {
    rows.push({
      label: "Add-on discount",
      value:
        config.addonDiscountType === "fixed"
          ? formatMoney(currency, addonDiscountValue)
          : `${addonDiscountValue}%`,
      section: "Discount",
    });
  }

  return rows;
}

/**
 * Zip productSummary ↔ assignments (1:1 by index), same as product-request details.
 */
export function buildFinanceProductSpecLines(quotation, { productIndex = null } = {}) {
  const summaries = Array.isArray(quotation?.productSummary) ? quotation.productSummary : [];
  const assignments = Array.isArray(quotation?.assignments) ? quotation.assignments : [];
  const count = Math.max(summaries.length, assignments.length);

  if (!count) {
    return [];
  }

  const indexes =
    productIndex === null || productIndex === undefined
      ? Array.from({ length: count }, (_, index) => index)
      : [Number(productIndex)].filter((index) => index >= 0 && index < count);

  return indexes.map((index) => {
    const summary = summaries[index] || {};
    const assignment = assignments[index] || null;
    const config = assignment?.config || {};
    const currency = config.currency || quotation?.currency || "INR";
    const name = summary.name || assignment?.productId || "Product";
    const breakdown = buildSidebarPricingBreakdown(config, { productName: name });
    const configDetails = [
      ...summarizeProductRequestAssignment(assignment),
      ...buildSetupAndDiscountRows(config),
    ];

    return {
      key: `${summary.productId || assignment?.productId || "product"}-${index}`,
      name,
      branchLabel: summary.branchLabel || "",
      billingLabel: summary.billingLabel || summary.branchLabel || "",
      changeTypeLabel: summary.changeTypeLabel || "New purchase",
      changeType: summary.changeType || assignment?.changeType || "new",
      periodLabel: summary.periodLabel || "",
      priceLabel: summary.priceLabel || formatMoney(currency, 0),
      currency,
      configDetails,
      pricingSections: breakdown?.sections || [],
    };
  });
}

function PricingBreakdown({ currency, sections }) {
  const visibleSections = (sections || []).filter((section) => section?.lines?.length);
  if (!visibleSections.length) {
    return null;
  }

  return (
    <div className="finance-product-spec-modal__pricing">
      <h3 className="product-request-details-modal__section-title">Price composition</h3>
      <div className="pricing-summary__breakdown">
        {visibleSections.map((section) => (
          <section
            aria-label={section.title}
            className="pricing-summary__section"
            key={section.title}
          >
            <p className="pricing-summary__section-title">{section.title}</p>
            <ul className="pricing-summary__lines">
              {section.lines.map((line) => (
                <li className="pricing-summary__line" key={line.id}>
                  <div className="pricing-summary__line-main">
                    <span className="pricing-summary__line-label">{line.label}</span>
                    {formatQtyRate(line) || line.includedInBase ? (
                      <span className="pricing-summary__line-meta">
                        {[formatQtyRate(line), line.includedInBase ? "in base" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </div>
                  <strong className="pricing-summary__line-amount">
                    {formatMoney(currency, line.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Full product specification for finance quotation review —
 * configuration details + priced line items (base / config / add-ons / setup).
 */
export function FinanceProductSpecModal({ quotation, productIndex = null, onClose }) {
  if (!quotation) {
    return null;
  }

  const lines = buildFinanceProductSpecLines(quotation, { productIndex });
  const companyName = quotation.lead?.companyName || "Quotation";
  const singleProduct = productIndex !== null && productIndex !== undefined;

  return (
    <div
      aria-label="Product specifications"
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={onClose} />
      <div className="confirm-modal product-request-details-modal finance-product-spec-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon">
            <Eye size={22} />
          </div>
          <div>
            <p className="eyebrow">Finance review</p>
            <h2>{singleProduct ? "Product specification" : "Product specifications"}</h2>
            <p className="confirm-modal__copy">
              {companyName}
              {quotation.id ? ` · Quotation ${quotation.id}` : ""}
            </p>
          </div>
          <button aria-label="Close" className="confirm-modal__close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="product-request-details-modal__body">
          {lines.length === 0 ? (
            <p className="sales-oversight-empty">
              No product configuration was saved with this quotation.
            </p>
          ) : (
            <div className="product-request-details-modal__lines">
              {lines.map((line) => (
                <article className="product-request-details-modal__line" key={line.key}>
                  <div className="product-request-details-modal__line-top">
                    <strong>{line.name}</strong>
                    <span className={`change-type-pill change-type-pill--${line.changeType}`}>
                      {line.changeTypeLabel}
                    </span>
                  </div>
                  {line.branchLabel || line.periodLabel ? (
                    <p className="product-request-details-modal__meta">
                      {[
                        line.branchLabel ? `Branch: ${line.branchLabel}` : "",
                        line.billingLabel && line.billingLabel !== line.branchLabel
                          ? `Billing: ${line.billingLabel}`
                          : "",
                        line.periodLabel ? `Period: ${line.periodLabel}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}

                  {line.configDetails.length > 0 ? (
                    <div className="product-request-details-modal__breakdown">
                      {groupProductRequestDetailRows(line.configDetails).map((group) => (
                        <div
                          className="product-request-details-modal__section"
                          key={`${line.key}-${group.section || "general"}`}
                        >
                          {group.section ? (
                            <h3 className="product-request-details-modal__section-title">
                              {group.section}
                            </h3>
                          ) : null}
                          <dl className="product-request-details-modal__dl">
                            {group.rows.map((row) => (
                              <div key={`${line.key}-${group.section}-${row.label}`}>
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <PricingBreakdown currency={line.currency} sections={line.pricingSections} />

                  {line.priceLabel ? (
                    <p className="product-request-details-modal__price">
                      Line total · {line.priceLabel}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="confirm-modal__footer">
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
