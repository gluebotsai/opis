// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { CCAAS_PLANS, getCcaasPlanLabel } from "../lib/ccaasPlans.js";
import "../styles/admin-pricing.css";
import {
  CCAAS_CONFIGURATION_PRICING_ROWS,
  createCustomConfigurationFeature,
  formatTierVolumeAdminValue,
  getAdminConfigurationDefaultFields,
  getAdminConfigurationDefaultQty,
  getAdminConfigurationDefaultRate,
  getCustomConfigurationFeatures,
  getDisabledConfigurationFeatureIds,
  repairContactCenterConfigurationFeatures,
} from "../lib/ccaasConfiguration.js";
import { getPlanDefaultOptionId, NONE_OPTION_ID } from "../lib/ccaasModules.js";
import {
  createCustomPlanModule,
  getPlanModuleRows,
} from "../lib/planModules.js";
import {
  migrateContactCenterProduct,
} from "../lib/contactCenterAddons.js";
import {
  EMPTY_CHANNEL_SLAB,
  PLAN_ADDON_CHANNELS,
  createChannelSlabKey,
  migratePlanAddons,
  upsertPlanAddonDefaultSlab,
} from "../lib/planAddons.js";
import {
  ADMIN_PRODUCT_ORDER,
  DEFAULT_PRICING_CATALOG,
  buildRegionalCatalogView,
  deepMergeCatalog,
  ensureRegionPricing,
  getRegionPricingSlice,
} from "../lib/pricingCatalogDefaults.js";
import { fetchPricingCatalog, savePricingCatalog, setCachedPricingCatalog } from "../lib/pricingCatalog.js";
import {
  blockNonNumericKeyDown,
  coerceEmptyNumericFieldsToZero,
  formatPricingCatalogValidationErrors,
  handleNumericPaste,
  sanitizeNumericInput,
  sanitizeNumericOrCustomInput,
  sanitizePricingCatalogPayload,
  validatePricingCatalogProductPayload,
  validatePricingCatalogRegionsPayload,
} from "../lib/pricingCatalogValidation.js";

const MODULE_PLAN_TABS = CCAAS_PLANS.map((plan) => ({
  id: plan.id,
  label: plan.subtitle ? `${plan.label} (${plan.subtitle})` : plan.label,
}));

const PRODUCT_NAV_LABELS = {
  "contact-center": "Contact Center",
  crm: "CRM",
  cdp: "CDP",
  campaign: "Campaign",
  "value-management": "Value Mgmt",
  ticketing: "Ticketing",
};

const DEFAULT_REGION = "India";

const CONTACT_CENTER_TABS = [
  { id: "tiers", label: "Configuration" },
  { id: "modules", label: "Plans" },
  { id: "add-ons", label: "Add-ons" },
];

const ADDON_PLAN_TABS = MODULE_PLAN_TABS;

const CAMPAIGN_TABS = [
  { id: "base", label: "Base plan" },
  { id: "channels", label: "Channel rates" },
];

const EMPTY_CHANNEL = {
  defaultCount: "",
  rate: "",
};

const EMPTY_CONTACT_SLAB = {
  contacts: "",
  monthlyPrice: "",
  perContactRate: "",
};

const EMPTY_TICKET_SLAB = {
  tickets: "",
  monthlyPrice: "",
  perTicketRate: "",
};

function catalogsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function prepareCatalogForSave(catalog) {
  const ensured = ensureRegionPricing(catalog);
  const indiaSlice = ensured.regionPricing.India;
  const products = { ...indiaSlice.products };
  if (products["contact-center"]) {
    products["contact-center"] = repairContactCenterConfigurationFeatures(
      products["contact-center"],
    );
  }

  const regionPricing = { ...ensured.regionPricing };
  for (const [region, slice] of Object.entries(regionPricing)) {
    const regionProducts = { ...(slice?.products || {}) };
    if (regionProducts["contact-center"]) {
      regionProducts["contact-center"] = repairContactCenterConfigurationFeatures(
        regionProducts["contact-center"],
      );
    }
    regionPricing[region] = {
      ...slice,
      products: regionProducts,
    };
  }

  return sanitizePricingCatalogPayload({
    ...ensured,
    products,
    shared: indiaSlice.shared,
    regionPricing,
  });
}

function formatCatalogUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());
}

function Field({ allowCustom = false, label, numeric = false, onChange, type = "text", value }) {
  function handleChange(event) {
    let next = event.target.value;
    if (numeric) {
      next = allowCustom ? sanitizeNumericOrCustomInput(next) : sanitizeNumericInput(next);
    }
    onChange(next);
  }

  function handleKeyDown(event) {
    if (!numeric) {
      return;
    }

    blockNonNumericKeyDown(event, { allowCustom, currentValue: value });
  }

  function handlePaste(event) {
    if (!numeric) {
      return;
    }

    handleNumericPaste(event, {
      allowCustom,
      onValue: onChange,
    });
  }

  return (
    <label className={`admin-pricing-field ${numeric ? "admin-pricing-field--numeric" : ""}`}>
      <span>
        {label}
        {numeric ? (
          <span aria-hidden="true" className="admin-pricing-field__required">
            *
          </span>
        ) : null}
      </span>
      <input
        aria-required={numeric || undefined}
        inputMode={numeric ? "decimal" : undefined}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        required={numeric || undefined}
        type={type}
        value={value ?? ""}
      />
    </label>
  );
}

function NumericTableInput({
  allowCustom = false,
  className = "admin-pricing-table__input",
  onChange,
  value,
  ...props
}) {
  return (
    <input
      {...props}
      className={className}
      inputMode="decimal"
      onChange={(event) => {
        const next = allowCustom
          ? sanitizeNumericOrCustomInput(event.target.value)
          : sanitizeNumericInput(event.target.value);
        onChange(next);
      }}
      onKeyDown={(event) => blockNonNumericKeyDown(event, { allowCustom, currentValue: value })}
      onPaste={(event) => handleNumericPaste(event, { allowCustom, onValue: onChange })}
      type="text"
      value={value ?? ""}
    />
  );
}

function Section({ children, description, title, variant }) {
  return (
    <section className={`admin-pricing-section ${variant ? `admin-pricing-section--${variant}` : ""}`}>
      <div className="admin-pricing-section__head">
        <h3>{title}</h3>
        {variant === "one-time" ? <span className="admin-pricing-pill">One-time</span> : null}
      </div>
      {description ? <p className="admin-pricing-section__desc">{description}</p> : null}
      <div className="admin-pricing-section__grid">{children}</div>
    </section>
  );
}

function ImplementationFeeStrip({ currency, onChange, value }) {
  return (
    <div className="admin-pricing-plan-fee">
      <div className="admin-pricing-plan-fee__label">
        <span>Charged once at onboarding</span>
      </div>
      <Field label={`Fee (${currency})`} numeric onChange={onChange} value={value ?? ""} />
    </div>
  );
}

const CHANNEL_LABELS = {
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  chat: "Chat",
  voice: "Voice",
  webchat: "Web chat",
  webPush: "Web Push",
  appPush: "App Push",
  inApp: "In-App",
  rcs: "RCS",
};

function formatChannelLabel(channelId = "") {
  const key = String(channelId || "").trim();
  if (!key) {
    return "";
  }
  if (CHANNEL_LABELS[key]) {
    return CHANNEL_LABELS[key];
  }
  if (CHANNEL_LABELS[key.toLowerCase()]) {
    return CHANNEL_LABELS[key.toLowerCase()];
  }
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function SubTabs({ activeId, items, onChange }) {
  return (
    <div className="admin-pricing-subtabs" role="tablist">
      {items.map((item) => (
        <button
          aria-selected={activeId === item.id}
          className={`admin-pricing-subtabs__item ${activeId === item.id ? "is-active" : ""}`}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function AddItemControl({ addLabel, error, keyLabel, onAdd, placeholder }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");

  function handleAdd() {
    const value = draft.trim();
    if (!value) {
      setLocalError(`Enter a ${keyLabel.toLowerCase()}.`);
      return;
    }

    const result = onAdd(value);
    if (result === false) {
      setLocalError(`That ${keyLabel.toLowerCase()} already exists.`);
      return;
    }

    setDraft("");
    setLocalError("");
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <div className="admin-pricing-add-row">
        <button className="secondary-button admin-pricing-add-row__trigger" onClick={() => setExpanded(true)} type="button">
          <Plus size={14} />
          {addLabel}
        </button>
      </div>
    );
  }

  const fieldError = localError || error;

  return (
    <div className="admin-pricing-add-row admin-pricing-add-row--expanded">
      <label className={`admin-pricing-field${fieldError ? " is-invalid" : ""}`}>
        <span>{keyLabel}</span>
        <input
          aria-invalid={fieldError ? "true" : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError("");
          }}
          placeholder={placeholder}
          type="text"
          value={draft}
        />
        {fieldError ? <span className="admin-pricing-field__error">{fieldError}</span> : null}
      </label>
      <div className="admin-pricing-add-row__actions">
        <button className="primary-button" onClick={handleAdd} type="button">
          Add
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setExpanded(false);
            setDraft("");
            setLocalError("");
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddPlanModuleControl({ onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [capability, setCapability] = useState("");
  const [localError, setLocalError] = useState("");

  function handleAdd() {
    if (!moduleName.trim() || !capability.trim()) {
      setLocalError("Enter both module name and capability.");
      return;
    }

    const result = onAdd(moduleName, capability);
    if (result === false) {
      setLocalError("That module already exists for this plan.");
      return;
    }

    setModuleName("");
    setCapability("");
    setLocalError("");
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <div className="admin-pricing-add-row">
        <button className="secondary-button admin-pricing-add-row__trigger" onClick={() => setExpanded(true)} type="button">
          <Plus size={14} />
          Add modules option
        </button>
      </div>
    );
  }

  return (
    <div className="admin-pricing-add-row admin-pricing-add-row--expanded">
      <label className={`admin-pricing-field${localError ? " is-invalid" : ""}`}>
        <span>Module name</span>
        <input
          aria-invalid={localError ? "true" : undefined}
          onChange={(event) => {
            setModuleName(event.target.value);
            setLocalError("");
          }}
          placeholder="e.g. Analytics"
          type="text"
          value={moduleName}
        />
      </label>
      <label className="admin-pricing-field">
        <span>Capability</span>
        <input
          onChange={(event) => {
            setCapability(event.target.value);
            setLocalError("");
          }}
          placeholder="e.g. Predictive insights"
          type="text"
          value={capability}
        />
      </label>
      <div className="admin-pricing-add-row__actions">
        <button className="primary-button" onClick={handleAdd} type="button">
          Add
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setExpanded(false);
            setModuleName("");
            setCapability("");
            setLocalError("");
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      {localError ? <span className="admin-pricing-add-row__error">{localError}</span> : null}
    </div>
  );
}

function AddConfigurationControl({ onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const [featureName, setFeatureName] = useState("");
  const [rateLabel, setRateLabel] = useState("Rate/unit");
  const [localError, setLocalError] = useState("");

  function handleAdd() {
    if (!featureName.trim()) {
      setLocalError("Enter a feature name.");
      return;
    }

    const result = onAdd(featureName, rateLabel);
    if (result === false) {
      setLocalError("That configuration feature already exists.");
      return;
    }

    setFeatureName("");
    setRateLabel("Rate/unit");
    setLocalError("");
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <div className="admin-pricing-add-row">
        <button
          className="secondary-button admin-pricing-add-row__trigger"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <Plus size={14} />
          Add configuration
        </button>
      </div>
    );
  }

  return (
    <div className="admin-pricing-add-row admin-pricing-add-row--expanded">
      <label className={`admin-pricing-field${localError ? " is-invalid" : ""}`}>
        <span>Feature name</span>
        <input
          aria-invalid={localError ? "true" : undefined}
          onChange={(event) => {
            setFeatureName(event.target.value);
            setLocalError("");
          }}
          placeholder="e.g. Telegram"
          type="text"
          value={featureName}
        />
      </label>
      <label className="admin-pricing-field">
        <span>Rate label</span>
        <input
          onChange={(event) => {
            setRateLabel(event.target.value);
            setLocalError("");
          }}
          placeholder="e.g. Rate/message"
          type="text"
          value={rateLabel}
        />
      </label>
      <div className="admin-pricing-add-row__actions">
        <button className="primary-button" onClick={handleAdd} type="button">
          Add
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setExpanded(false);
            setFeatureName("");
            setRateLabel("Rate/unit");
            setLocalError("");
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      {localError ? <span className="admin-pricing-add-row__error">{localError}</span> : null}
    </div>
  );
}

function PlanModulesTable({ onDelete, onPatch, rows }) {
  return (
    <div className="admin-pricing-table-wrap">
      <table className="admin-pricing-table admin-pricing-table--modules">
        <thead>
          <tr>
            <th>Module</th>
            <th>Capability</th>
            <th className="admin-pricing-table__actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  className="admin-pricing-table__input"
                  onChange={(event) => onPatch(row.id, "moduleName", event.target.value)}
                  type="text"
                  value={row.moduleName ?? ""}
                />
              </td>
              <td>
                <input
                  className="admin-pricing-table__input"
                  onChange={(event) => onPatch(row.id, "capability", event.target.value)}
                  type="text"
                  value={row.capability ?? ""}
                />
              </td>
              <td className="admin-pricing-table__actions">
                <button
                  aria-label={`Delete ${row.moduleName}`}
                  className="icon-button admin-pricing-table__delete"
                  onClick={() => onDelete(row.id)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlabTable({ columns, emptyMessage = "No tiers yet. Add one below.", onDelete, onPatch, rows }) {
  if (!rows.length) {
    return <p className="admin-pricing-empty">{emptyMessage}</p>;
  }

  return (
    <div className="admin-pricing-table-wrap">
      <table className="admin-pricing-table admin-pricing-table--slabs">
        <thead>
          <tr>
            <th>Tier</th>
            {columns.map((column) => (
              <th key={column.field}>{column.label}</th>
            ))}
            {onDelete ? <th className="admin-pricing-table__actions-col">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="admin-pricing-table__tier" title={row.label}>
                {row.label}
              </td>
              {columns.map((column) => (
                <td key={column.field}>
                  {column.numeric ? (
                    <NumericTableInput
                      allowCustom={column.allowCustom}
                      onChange={(next) => onPatch(row.key, column.field, next)}
                      value={row.data[column.field]}
                    />
                  ) : (
                    <input
                      className="admin-pricing-table__input"
                      onChange={(event) => onPatch(row.key, column.field, event.target.value)}
                      type="text"
                      value={row.data[column.field] ?? ""}
                    />
                  )}
                </td>
              ))}
              {onDelete ? (
                <td className="admin-pricing-table__actions">
                  <button
                    aria-label={`Delete ${row.label}`}
                    className="icon-button admin-pricing-table__delete"
                    onClick={() => onDelete(row.key)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactCenterForm({ catalog, currency, onChange, onReplaceContactCenter }) {
  const contactCenter = migrateContactCenterProduct(catalog.products["contact-center"]);
  const p = contactCenter;
  const [activeTab, setActiveTab] = useState("tiers");
  const [modulePlanId, setModulePlanId] = useState(CCAAS_PLANS[0]?.id || "starter");
  const [addonPlanId, setAddonPlanId] = useState(CCAAS_PLANS[0]?.id || "starter");

  function patchPlanModuleRow(rowId, field, value) {
    if (!onReplaceContactCenter) {
      return;
    }

    onReplaceContactCenter((current) => {
      const rows = getPlanModuleRows(current, modulePlanId).map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row,
      );

      return {
        ...current,
        planModules: {
          ...current.planModules,
          [modulePlanId]: rows,
        },
      };
    });
  }

  function addPlanModule(moduleName, capability) {
    if (!onReplaceContactCenter) {
      return false;
    }

    const trimmedName = moduleName.trim();
    const trimmedCapability = capability.trim();
    const rows = getPlanModuleRows(p, modulePlanId);
    const duplicate = rows.some(
      (row) =>
        row.moduleName?.toLowerCase() === trimmedName.toLowerCase() &&
        row.capability?.toLowerCase() === trimmedCapability.toLowerCase(),
    );

    if (duplicate) {
      return false;
    }

    onReplaceContactCenter((current) => ({
      ...current,
      planModules: {
        ...current.planModules,
        [modulePlanId]: [
          ...getPlanModuleRows(current, modulePlanId),
          createCustomPlanModule(trimmedName, trimmedCapability),
        ],
      },
    }));
    return true;
  }

  function removePlanModule(rowId) {
    if (!onReplaceContactCenter) {
      return;
    }

    onReplaceContactCenter((current) => ({
      ...current,
      planModules: {
        ...current.planModules,
        [modulePlanId]: getPlanModuleRows(current, modulePlanId).filter((row) => row.id !== rowId),
      },
    }));
  }

  function patchTierVolume(planId, metricId, value) {
    onChange({
      products: {
        "contact-center": {
          tierDefaultVolumes: {
            [planId]: {
              [metricId]: sanitizeNumericOrCustomInput(value),
            },
          },
        },
      },
    });
  }

  function addConfigurationFeature(itemLabel, rateLabel) {
    if (!onReplaceContactCenter) {
      return false;
    }

    const trimmedLabel = String(itemLabel || "").trim();
    if (!trimmedLabel) {
      return false;
    }

    const labelKey = trimmedLabel.toLowerCase();
    const visibleLabels = new Set(
      getAdminConfigurationDefaultFields(p).map((row) => row.itemLabel.toLowerCase()),
    );
    if (visibleLabels.has(labelKey)) {
      return false;
    }

    const disabledBuiltIn = CCAAS_CONFIGURATION_PRICING_ROWS.find(
      (row) => row.itemLabel.toLowerCase() === labelKey,
    );
    if (disabledBuiltIn && getDisabledConfigurationFeatureIds(p).includes(disabledBuiltIn.id)) {
      onReplaceContactCenter((current) => ({
        ...current,
        disabledConfigurationFeatureIds: getDisabledConfigurationFeatureIds(current).filter(
          (id) => id !== disabledBuiltIn.id,
        ),
      }));
      return true;
    }

    const feature = createCustomConfigurationFeature(trimmedLabel, rateLabel);

    onReplaceContactCenter((current) => {
      let next = {
        ...current,
        configurationFeatures: [...getCustomConfigurationFeatures(current), feature],
      };

      for (const plan of CCAAS_PLANS) {
        const defaultQty = plan.id === "enterprise" ? "custom" : "0";
        next = {
          ...next,
          tierDefaultVolumes: {
            ...(next.tierDefaultVolumes || {}),
            [plan.id]: {
              ...(next.tierDefaultVolumes?.[plan.id] || {}),
              [feature.volumeKey]: defaultQty,
            },
          },
          planAddons: upsertPlanAddonDefaultSlab(next, plan.id, feature.addonChannelId, {
            count: "0",
            rate: "0",
            label: feature.itemLabel,
          }),
        };
      }

      return next;
    });

    return true;
  }

  function removeConfigurationFeature(featureId) {
    if (!onReplaceContactCenter || !featureId) {
      return;
    }

    onReplaceContactCenter((current) => {
      const features = getCustomConfigurationFeatures(current);
      const removedCustom = features.find((row) => row.id === featureId);

      if (removedCustom) {
        const nextFeatures = features.filter((row) => row.id !== featureId);
        const nextVolumes = { ...(current.tierDefaultVolumes || {}) };
        for (const plan of CCAAS_PLANS) {
          const planVolumes = { ...(nextVolumes[plan.id] || {}) };
          if (removedCustom.volumeKey) {
            delete planVolumes[removedCustom.volumeKey];
          }
          nextVolumes[plan.id] = planVolumes;
        }

        const migrated = migratePlanAddons(current);
        const nextPlanAddons = { ...migrated };
        for (const plan of CCAAS_PLANS) {
          const planEntry = { ...(nextPlanAddons[plan.id] || {}) };
          const channels = { ...(planEntry.channels || {}) };
          if (removedCustom.addonChannelId) {
            delete channels[removedCustom.addonChannelId];
          }
          nextPlanAddons[plan.id] = {
            ...planEntry,
            channels,
          };
        }

        return {
          ...current,
          configurationFeatures: nextFeatures,
          tierDefaultVolumes: nextVolumes,
          planAddons: nextPlanAddons,
        };
      }

      const isBuiltIn = CCAAS_CONFIGURATION_PRICING_ROWS.some((row) => row.id === featureId);
      if (!isBuiltIn) {
        return current;
      }

      const disabled = new Set(getDisabledConfigurationFeatureIds(current));
      disabled.add(featureId);
      return {
        ...current,
        disabledConfigurationFeatureIds: [...disabled],
      };
    });
  }

  function patchConfigurationDefaultQty(planId, row, value) {
    const sanitized = sanitizeNumericOrCustomInput(value);

    if (onReplaceContactCenter) {
      onReplaceContactCenter((current) => {
        let next = { ...current };

        if (row.volumeKey) {
          next = {
            ...next,
            tierDefaultVolumes: {
              ...(next.tierDefaultVolumes || {}),
              [planId]: {
                ...(next.tierDefaultVolumes?.[planId] || {}),
                [row.volumeKey]: sanitized,
              },
            },
          };
        }

        if (row.addonChannelId) {
          const rate = getAdminConfigurationDefaultRate(next, planId, row);
          next = {
            ...next,
            planAddons: upsertPlanAddonDefaultSlab(next, planId, row.addonChannelId, {
              count: sanitized.toLowerCase() === "custom" ? "0" : sanitized,
              rate: rate || "0",
              label: row.itemLabel,
            }),
          };
        }

        return next;
      });
      return;
    }

    if (row.volumeKey) {
      patchTierVolume(planId, row.volumeKey, sanitized);
    }
  }

  function patchConfigurationDefaultRate(planId, row, value) {
    const sanitized = sanitizeNumericOrCustomInput(value);

    if (row.usesTierAgentRate) {
      patchTierAgentRate(planId, sanitized);
      return;
    }

        if (!row.addonChannelId || !onReplaceContactCenter) {
      return;
    }

    onReplaceContactCenter((current) => {
      const qty = getAdminConfigurationDefaultQty(current, planId, row);
      const countValue = String(qty || "0");
      return {
        ...current,
        planAddons: upsertPlanAddonDefaultSlab(current, planId, row.addonChannelId, {
          count: countValue.toLowerCase() === "custom" ? "0" : countValue,
          rate: sanitized.toLowerCase() === "custom" ? "0" : sanitized,
          label: row.itemLabel,
        }),
      };
    });
  }

  function patchTierAgentRate(planId, value) {
    const sanitized = sanitizeNumericOrCustomInput(value);
    const voiceOptionId = getPlanDefaultOptionId("voice", planId);

    onChange({
      products: {
        "contact-center": {
          tierAgentRates: {
            [planId]: sanitized,
          },
          licenseTiers: {
            [planId]: {
              monthlyPerUser: sanitized.toLowerCase() === "custom" ? "" : sanitized,
            },
          },
          ...(voiceOptionId && voiceOptionId !== NONE_OPTION_ID
            ? {
                modulePlanPricing: {
                  [planId]: {
                    voice: {
                      [voiceOptionId]: {
                        monthlyPrice: sanitized.toLowerCase() === "custom" ? "0" : sanitized,
                      },
                    },
                  },
                },
              }
            : {}),
        },
      },
    });
  }

  function patchPlanAgentAddon(field, value) {
    onChange({
      products: {
        "contact-center": {
          planAddons: {
            [addonPlanId]: {
              agentCount: { [field]: value },
            },
          },
        },
      },
    });
  }

  function patchPlanQueueCapacityAddon(field, value) {
    onChange({
      products: {
        "contact-center": {
          planAddons: {
            [addonPlanId]: {
              queueCapacity: { [field]: value },
            },
          },
        },
      },
    });
  }

  function patchPlanChannelAddon(channelId, field, value) {
    onChange({
      products: {
        "contact-center": {
          planAddons: {
            [addonPlanId]: {
              channels: {
                [channelId]: { [field]: value },
              },
            },
          },
        },
      },
    });
  }

  function patchPlanChannelSlab(channelId, slabKey, field, value) {
    onChange({
      products: {
        "contact-center": {
          planAddons: {
            [addonPlanId]: {
              channels: {
                [channelId]: {
                  slabs: {
                    [slabKey]: { [field]: value },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  function addPlanChannelSlab(channelId, rawKey) {
    const slabKey = createChannelSlabKey(rawKey);
    if (!slabKey) {
      return false;
    }

    const currentPlan = migratePlanAddons(p)[addonPlanId] || {};
    const slabs = currentPlan.channels?.[channelId]?.slabs || {};
    if (slabs[slabKey]) {
      return false;
    }

    onChange({
      products: {
        "contact-center": {
          planAddons: {
            [addonPlanId]: {
              channels: {
                [channelId]: {
                  slabs: {
                    [slabKey]: {
                      ...EMPTY_CHANNEL_SLAB,
                      count: slabKey,
                      label:
                        !Number.isNaN(Number(slabKey)) && slabKey !== ""
                          ? Number(slabKey).toLocaleString()
                          : slabKey,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    return true;
  }

  function removePlanChannelSlab(channelId, slabKey) {
    if (!onReplaceContactCenter) {
      return;
    }

    onReplaceContactCenter((current) => {
      const migrated = migratePlanAddons(current);
      const plan = migrated[addonPlanId] || migrated.starter;
      const channel = plan.channels?.[channelId] || { slabs: {} };
      const nextSlabs = { ...(channel.slabs || {}) };
      delete nextSlabs[slabKey];

      return {
        ...current,
        planAddons: {
          ...migrated,
          [addonPlanId]: {
            ...plan,
            channels: {
              ...plan.channels,
              [channelId]: {
                ...channel,
                slabs: nextSlabs,
              },
            },
          },
        },
      };
    });
  }

  const planModuleRows = getPlanModuleRows(p, modulePlanId);
  const planAddons = migratePlanAddons(p);
  const activePlanAddons = planAddons[addonPlanId] || planAddons.starter;
  const agentAddon = activePlanAddons.agentCount || {};
  const queueAddon = activePlanAddons.queueCapacity || {};
  const configurationDefaultFields = getAdminConfigurationDefaultFields(p);

  return (
    <div className="admin-pricing-product">
      <SubTabs activeId={activeTab} items={CONTACT_CENTER_TABS} onChange={setActiveTab} />

      {activeTab === "tiers" ? (
        <Section
          description="Prefill purchase Configuration qty and rate. Sales can still edit on the quote. Use 0 for unavailable metrics, or custom for enterprise. Channel rates also update the Default slab under Add-ons."
          title="Configuration defaults"
        >
          <div className="admin-pricing-table-wrap admin-pricing-field--full">
            <table className="admin-pricing-table admin-pricing-table--modules admin-pricing-table--config-defaults">
              <thead>
                <tr>
                  <th>Item</th>
                  {CCAAS_PLANS.map((plan) => (
                    <th key={plan.id}>
                      <span className="admin-pricing-table__plan">{plan.label}</span>
                      {plan.subtitle ? (
                        <span className="admin-pricing-table__plan-sub">{plan.subtitle}</span>
                      ) : null}
                      <span className="admin-pricing-table__plan-meta">Qty · Rate</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {configurationDefaultFields.map((row) => (
                  <tr key={row.id}>
                    <td className="admin-pricing-table__tier">
                      <div className="admin-config-default-item">
                        <span>{row.itemLabel}</span>
                        <button
                          aria-label={`Delete ${row.itemLabel}`}
                          className="icon-button admin-pricing-table__delete"
                          onClick={() => removeConfigurationFeature(row.id)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                    {CCAAS_PLANS.map((plan) => {
                      const qtyValue = getAdminConfigurationDefaultQty(p, plan.id, row);
                      const rateValue = getAdminConfigurationDefaultRate(p, plan.id, row);

                      return (
                        <td key={`${plan.id}-${row.id}`}>
                          <div className="admin-config-default-cell">
                            <label className="admin-config-default-cell__field">
                              <span>Default qty</span>
                              <NumericTableInput
                                allowCustom
                                aria-label={`${plan.label} ${row.itemLabel} qty`}
                                className="admin-pricing-table__input admin-pricing-table__input--price"
                                onChange={(next) => patchConfigurationDefaultQty(plan.id, row, next)}
                                placeholder={plan.id === "enterprise" ? "custom" : "0"}
                                title={formatTierVolumeAdminValue(qtyValue)}
                                value={qtyValue}
                              />
                            </label>
                            <label className="admin-config-default-cell__field">
                              <span>{row.rateLabel}</span>
                              <NumericTableInput
                                allowCustom
                                aria-label={`${plan.label} ${row.rateLabel}`}
                                className="admin-pricing-table__input admin-pricing-table__input--price"
                                onChange={(next) =>
                                  patchConfigurationDefaultRate(plan.id, row, next)
                                }
                                placeholder={plan.id === "enterprise" ? "custom" : "0"}
                                value={rateValue}
                              />
                            </label>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AddConfigurationControl onAdd={addConfigurationFeature} />
        </Section>
      ) : null}

      {activeTab === "modules" ? (
        <>
          <SubTabs activeId={modulePlanId} items={MODULE_PLAN_TABS} onChange={setModulePlanId} />
          <Section
            description={`Define module names and capabilities for ${getCcaasPlanLabel(modulePlanId)}. These appear in sales product pricing when that plan is selected.`}
            title={`${getCcaasPlanLabel(modulePlanId)} plan`}
          >
            <div className="admin-pricing-plan-fee">
              <div className="admin-pricing-plan-fee__label">
                <span className="admin-pricing-pill">One-time</span>
                <span>Implementation fee — charged once at onboarding</span>
              </div>
              <Field
                label={`Fee (${currency})`}
                numeric
                onChange={(v) =>
                  onChange({
                    products: {
                      "contact-center": {
                        licenseTiers: {
                          [modulePlanId]: { implementationFee: v },
                        },
                      },
                    },
                  })
                }
                value={p.licenseTiers?.[modulePlanId]?.implementationFee ?? ""}
              />
            </div>
            <PlanModulesTable
              onDelete={removePlanModule}
              onPatch={patchPlanModuleRow}
              rows={planModuleRows}
            />
            <AddPlanModuleControl onAdd={addPlanModule} />
          </Section>
        </>
      ) : null}

      {activeTab === "add-ons" ? (
        <>
          <SubTabs activeId={addonPlanId} items={ADDON_PLAN_TABS} onChange={setAddonPlanId} />
          <Section
            description={`Configure agent-count, queue capacity, and channel-wise add-ons for ${getCcaasPlanLabel(addonPlanId)}. Sales quotes show enabled rows filtered by the Digital Channels capability on the quote.`}
            title={`${getCcaasPlanLabel(addonPlanId)} add-ons`}
          >
            <div className="admin-plan-addons">
              <div className="admin-plan-addons__block">
                <strong>Agent count increase</strong>
                <label className="checkbox-field">
                  <input
                    checked={agentAddon.enabled !== false}
                    onChange={(event) => patchPlanAgentAddon("enabled", event.target.checked)}
                    type="checkbox"
                  />
                  <span>Available as add-on</span>
                </label>
                <div className="form-grid two-col">
                  <Field
                    label="Label"
                    onChange={(value) => patchPlanAgentAddon("label", value)}
                    value={agentAddon.label ?? ""}
                  />
                  <Field
                    label="Default count"
                    numeric
                    onChange={(value) => patchPlanAgentAddon("defaultCount", value)}
                    value={agentAddon.defaultCount ?? ""}
                  />
                  <Field
                    label="Default rate"
                    numeric
                    onChange={(value) => patchPlanAgentAddon("defaultRate", value)}
                    value={agentAddon.defaultRate ?? ""}
                  />
                </div>
              </div>

              <div className="admin-plan-addons__block">
                <strong>Queue capacity</strong>
                <label className="checkbox-field">
                  <input
                    checked={queueAddon.enabled !== false}
                    onChange={(event) =>
                      patchPlanQueueCapacityAddon("enabled", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Available as add-on</span>
                </label>
                <div className="form-grid two-col">
                  <Field
                    label="Label"
                    onChange={(value) => patchPlanQueueCapacityAddon("label", value)}
                    value={queueAddon.label ?? ""}
                  />
                  <Field
                    label="Default count"
                    numeric
                    onChange={(value) => patchPlanQueueCapacityAddon("defaultCount", value)}
                    value={queueAddon.defaultCount ?? ""}
                  />
                  <Field
                    label="Default rate"
                    numeric
                    onChange={(value) => patchPlanQueueCapacityAddon("defaultRate", value)}
                    value={queueAddon.defaultRate ?? ""}
                  />
                </div>
              </div>

              <div className="admin-plan-addons__block">
                <strong>Channel-wise</strong>
                <div className="admin-plan-channel-list">
                  {PLAN_ADDON_CHANNELS.map((channel) => {
                    const entry = activePlanAddons.channels?.[channel.id] || {};
                    const slabs = entry.slabs || {};
                    const enabled = entry.enabled === true;
                    return (
                      <div className="admin-plan-channel-card" key={channel.id}>
                        <div className="admin-plan-channel-card__header">
                          <label className="checkbox-field">
                            <input
                              checked={enabled}
                              onChange={(event) =>
                                patchPlanChannelAddon(channel.id, "enabled", event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>{channel.label}</span>
                          </label>
                          {enabled ? (
                            <Field
                              label="Display label"
                              onChange={(value) => patchPlanChannelAddon(channel.id, "label", value)}
                              value={entry.label ?? channel.label}
                            />
                          ) : null}
                        </div>

                        {enabled ? (
                          <>
                            <div className="admin-pricing-table-wrap">
                              <table className="admin-pricing-table">
                                <thead>
                                  <tr>
                                    <th>Slab key</th>
                                    <th>Label</th>
                                    <th>Count</th>
                                    <th>Rate</th>
                                    <th className="admin-pricing-table__actions-col">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.keys(slabs).length === 0 ? (
                                    <tr>
                                      <td className="admin-pricing-table__muted" colSpan={5}>
                                        No slabs yet. Add a count-based slab below.
                                      </td>
                                    </tr>
                                  ) : (
                                    Object.entries(slabs).map(([slabKey, slab]) => (
                                      <tr key={slabKey}>
                                        <td className="admin-pricing-table__tier">{slabKey}</td>
                                        <td>
                                          <input
                                            className="admin-pricing-table__input"
                                            onChange={(event) =>
                                              patchPlanChannelSlab(
                                                channel.id,
                                                slabKey,
                                                "label",
                                                event.target.value,
                                              )
                                            }
                                            value={slab.label ?? ""}
                                          />
                                        </td>
                                        <td>
                                          <NumericTableInput
                                            className="admin-pricing-table__input admin-pricing-table__input--price"
                                            onChange={(next) =>
                                              patchPlanChannelSlab(channel.id, slabKey, "count", next)
                                            }
                                            placeholder="0"
                                            value={slab.count ?? ""}
                                          />
                                        </td>
                                        <td>
                                          <NumericTableInput
                                            className="admin-pricing-table__input admin-pricing-table__input--price"
                                            onChange={(next) =>
                                              patchPlanChannelSlab(channel.id, slabKey, "rate", next)
                                            }
                                            placeholder="0"
                                            value={slab.rate ?? ""}
                                          />
                                        </td>
                                        <td className="admin-pricing-table__actions">
                                          <button
                                            aria-label={`Delete ${slabKey} slab`}
                                            className="icon-button admin-pricing-table__delete"
                                            onClick={() =>
                                              removePlanChannelSlab(channel.id, slabKey)
                                            }
                                            type="button"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <AddItemControl
                              addLabel="Add slab"
                              keyLabel="Slab count / key"
                              onAdd={(key) => addPlanChannelSlab(channel.id, key)}
                              placeholder="e.g. 1000"
                            />
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Section>
          <StorageAddOnSection
            currency={currency}
            onPatch={(field, value) =>
              onChange({
                products: {
                  "contact-center": {
                    storageAddOn: { [field]: value },
                  },
                },
              })
            }
            storageAddOn={p.storageAddOn}
          />
        </>
      ) : null}
    </div>
  );
}

function ContactSlabsSection({ currency, description, onChange, productId, slabs, title }) {
  const contactSlabs = slabs || {};

  function patchContactSlab(key, field, value) {
    onChange({ products: { [productId]: { contactSlabs: { [key]: { [field]: value } } } } });
  }

  function addContactSlab(key) {
    if (contactSlabs[key]) {
      return false;
    }

    onChange({
      products: {
        [productId]: {
          contactSlabs: {
            [key]: { ...EMPTY_CONTACT_SLAB, contacts: key },
          },
        },
      },
    });
    return true;
  }

  return (
    <Section description={description} title={title || "Additional contact slabs"}>
      <SlabTable
        columns={[
          { field: "contacts", label: "Contacts label" },
          { field: "monthlyPrice", label: `Monthly price (${currency})`, numeric: true },
          { field: "perContactRate", label: `Per-contact rate (${currency})`, numeric: true },
        ]}
        onPatch={patchContactSlab}
        rows={Object.entries(contactSlabs).map(([key, slab]) => ({
          key,
          label: `${Number(key).toLocaleString()} contacts`,
          data: slab,
        }))}
      />
      <AddItemControl
        addLabel="Add contact tier"
        keyLabel="Contact count"
        onAdd={addContactSlab}
        placeholder="e.g. 75000"
      />
    </Section>
  );
}

function TicketSlabsSection({ currency, description, onChange, slabs, title }) {
  const ticketSlabs = slabs || {};

  function patchTicketSlab(key, field, value) {
    onChange({ products: { ticketing: { ticketSlabs: { [key]: { [field]: value } } } } });
  }

  function addTicketSlab(key) {
    if (ticketSlabs[key]) {
      return false;
    }

    onChange({
      products: {
        ticketing: {
          ticketSlabs: {
            [key]: { ...EMPTY_TICKET_SLAB, tickets: key },
          },
        },
      },
    });
    return true;
  }

  return (
    <Section description={description} title={title || "Additional ticket slabs"}>
      <SlabTable
        columns={[
          { field: "tickets", label: "Tickets label" },
          { field: "monthlyPrice", label: `Monthly price (${currency})`, numeric: true },
          { field: "perTicketRate", label: `Per-ticket rate (${currency})`, numeric: true },
        ]}
        onPatch={patchTicketSlab}
        rows={Object.entries(ticketSlabs).map(([key, slab]) => ({
          key,
          label: `${Number(key).toLocaleString()} tickets`,
          data: slab,
        }))}
      />
      <AddItemControl
        addLabel="Add ticket tier"
        keyLabel="Ticket count"
        onAdd={addTicketSlab}
        placeholder="e.g. 25000"
      />
    </Section>
  );
}

function NumberAddOnSection({ currency, numberAddOn, onPatch, productLabel }) {
  const addon = numberAddOn || {};
  const enabled = addon.enabled !== false;

  return (
    <Section
      description={`Default count and per-number rate for additional ${productLabel} numbers on quotes.`}
      title="Additional numbers"
    >
      <div className="admin-plan-addons__block">
        <label className="checkbox-field">
          <input
            checked={enabled}
            onChange={(event) => onPatch("enabled", event.target.checked)}
            type="checkbox"
          />
          <span>Available as add-on</span>
        </label>
        {enabled ? (
          <div className="form-grid two-col">
            <Field label="Label" onChange={(value) => onPatch("label", value)} value={addon.label ?? ""} />
            <Field
              label="Default count"
              numeric
              onChange={(value) => onPatch("defaultCount", value)}
              value={addon.defaultCount ?? ""}
            />
            <Field
              label={`Default rate (${currency})`}
              numeric
              onChange={(value) => onPatch("defaultRate", value)}
              value={addon.defaultRate ?? ""}
            />
          </div>
        ) : (
          <p className="admin-pricing-hint">Enable to set default count and rate for mid-period and quote add-ons.</p>
        )}
      </div>
    </Section>
  );
}

function StorageAddOnSection({ currency, onPatch, storageAddOn }) {
  const addon = storageAddOn || {};
  const enabled = addon.enabled !== false;
  const unit = addon.unit || "GB";

  return (
    <Section
      description="Per-GB storage add-on price for this product. Defaults: India ₹3000, UK/international $30, Dubai 110 AED — change anytime per region."
      title="Add-On Storage"
    >
      <div className="admin-plan-addons__block">
        <label className="checkbox-field">
          <input
            checked={enabled}
            onChange={(event) => onPatch("enabled", event.target.checked)}
            type="checkbox"
          />
          <span>Available as add-on</span>
        </label>
        {enabled ? (
          <div className="form-grid two-col">
            <Field label="Label" onChange={(value) => onPatch("label", value)} value={addon.label ?? ""} />
            <Field
              label="Unit"
              onChange={(value) => onPatch("unit", value)}
              value={unit}
            />
            <Field
              label="Default GB"
              numeric
              onChange={(value) => onPatch("defaultCount", value)}
              value={addon.defaultCount ?? ""}
            />
            <Field
              label={`Default rate (${currency} / ${unit})`}
              numeric
              onChange={(value) => onPatch("defaultRate", value)}
              value={addon.defaultRate ?? ""}
            />
          </div>
        ) : (
          <p className="admin-pricing-hint">Enable to set the default per-GB storage rate for this product and region.</p>
        )}
      </div>
    </Section>
  );
}

function CrmForm({ catalog, currency, onChange }) {
  const p = catalog.products.crm;
  const numberAddOn = p.numberAddOn || {};

  function patchNumberAddOn(field, value) {
    onChange({
      products: {
        crm: {
          numberAddOn: { [field]: value },
        },
      },
    });
  }

  function patchStorageAddOn(field, value) {
    onChange({
      products: {
        crm: {
          storageAddOn: { [field]: value },
        },
      },
    });
  }

  return (
    <div className="admin-pricing-product">
      <Section description="Core license, contact, and number defaults for CRM quotes." title="Base metrics">
        <Field
          label={`User license rate (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { crm: { base: { userLicenseRate: v } } } })}
          value={p.base.userLicenseRate}
        />
        <Field
          label="Included contacts"
          numeric
          onChange={(v) => onChange({ products: { crm: { base: { includedContacts: v } } } })}
          value={p.base.includedContacts}
        />
        <Field
          label="Number count"
          numeric
          onChange={(v) => onChange({ products: { crm: { base: { numberCount: v } } } })}
          value={p.base.numberCount ?? ""}
        />
        <Field
          label={`Per number price (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { crm: { base: { numberRate: v } } } })}
          value={p.base.numberRate ?? ""}
        />
      </Section>
      <Section description="One-time fee applied on CRM onboarding quotes." title="Implementation" variant="one-time">
        <ImplementationFeeStrip
          currency={currency}
          onChange={(v) => onChange({ products: { crm: { implementationFee: v } } })}
          value={p.implementationFee}
        />
      </Section>
      <Section description="Default rate for additional CRM seats on quotes." title="Additional users">
        <Field
          label={`Additional user rate (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { crm: { additionalUserLicenseRate: v } } })}
          value={p.additionalUserLicenseRate ?? p.base.userLicenseRate}
        />
      </Section>
      <NumberAddOnSection
        currency={currency}
        numberAddOn={numberAddOn}
        onPatch={patchNumberAddOn}
        productLabel="CRM"
      />
      <StorageAddOnSection
        currency={currency}
        onPatch={patchStorageAddOn}
        storageAddOn={p.storageAddOn}
      />
      <ContactSlabsSection
        currency={currency}
        description="Volume tiers for additional CRM contacts."
        onChange={onChange}
        productId="crm"
        slabs={p.contactSlabs}
      />
    </div>
  );
}

function CdpForm({ catalog, currency, onChange }) {
  const p = catalog.products.cdp;

  function patchStorageAddOn(field, value) {
    onChange({
      products: {
        cdp: {
          storageAddOn: { [field]: value },
        },
      },
    });
  }

  return (
    <div className="admin-pricing-product">
      <Section description="Platform subscription defaults for CDP quotes." title="Platform base">
        <Field
          label={`Monthly base price (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { cdp: { base: { monthlyBasePrice: v } } } })}
          value={p.base.monthlyBasePrice}
        />
        <Field
          label="Customer profiles (default)"
          numeric
          onChange={(v) => onChange({ products: { cdp: { base: { customerProfiles: v } } } })}
          value={p.base.customerProfiles}
        />
      </Section>
      <Section description="One-time fee applied on CDP onboarding quotes." title="Implementation" variant="one-time">
        <ImplementationFeeStrip
          currency={currency}
          onChange={(v) => onChange({ products: { cdp: { implementationFee: v } } })}
          value={p.implementationFee ?? ""}
        />
      </Section>
      <StorageAddOnSection
        currency={currency}
        onPatch={patchStorageAddOn}
        storageAddOn={p.storageAddOn}
      />
      <ContactSlabsSection
        currency={currency}
        description="Volume tiers for additional CDP contacts."
        onChange={onChange}
        productId="cdp"
        slabs={p.contactSlabs}
      />
    </div>
  );
}

function CampaignForm({ catalog, currency, onChange }) {
  const p = catalog.products.campaign;
  const [activeTab, setActiveTab] = useState("base");
  // Campaign numberAddOn removed.
  // const numberAddOn = p.numberAddOn || {};

  function patchChannel(channel, field, value) {
    const nextValue = field === "rate" || field === "defaultCount" ? sanitizeNumericInput(value) : value;
    onChange({
      products: {
        campaign: {
          channels: {
            [channel]: { [field]: nextValue },
          },
        },
      },
    });
  }

  // function patchNumberAddOn(field, value) { ... } — Campaign numbers removed

  function patchStorageAddOn(field, value) {
    onChange({
      products: {
        campaign: {
          storageAddOn: { [field]: value },
        },
      },
    });
  }

  function addChannel(key) {
    const normalized = key.toLowerCase().replace(/\s+/g, "");
    if (!normalized || p.channels[normalized]) {
      return false;
    }

    onChange({
      products: {
        campaign: {
          channels: {
            [normalized]: { ...EMPTY_CHANNEL },
          },
        },
      },
    });
    return true;
  }

  const channelRows = Object.entries(p.channels || {}).map(([channel, rates]) => ({
    key: channel,
    label: formatChannelLabel(channel),
    data: rates,
  }));

  return (
    <div className="admin-pricing-product">
      <SubTabs activeId={activeTab} items={CAMPAIGN_TABS} onChange={setActiveTab} />

      {activeTab === "base" ? (
        <>
          <Section description="Monthly subscription defaults for campaign quotes." title="Base plan">
            <Field
              label={`Monthly base price (${currency})`}
              numeric
              onChange={(v) => onChange({ products: { campaign: { base: { monthlyBasePrice: v } } } })}
              value={p.base.monthlyBasePrice}
            />
            <Field
              label="Included contacts"
              numeric
              onChange={(v) => onChange({ products: { campaign: { base: { includedContacts: v } } } })}
              value={p.base.includedContacts}
            />
            {/* Campaign Number count / Per number price removed
            <Field label="Number count" ... />
            <Field label={`Per number price (${currency})`} ... />
            */}
          </Section>
          <Section
            description="One-time fee applied on Campaign onboarding quotes."
            title="Implementation"
            variant="one-time"
          >
            <ImplementationFeeStrip
              currency={currency}
              onChange={(v) => onChange({ products: { campaign: { implementationFee: v } } })}
              value={p.implementationFee ?? ""}
            />
          </Section>
          {/* Campaign NumberAddOnSection removed
          <NumberAddOnSection ... productLabel="Campaign" />
          */}
          <StorageAddOnSection
            currency={currency}
            onPatch={patchStorageAddOn}
            storageAddOn={p.storageAddOn}
          />
          <ContactSlabsSection
            currency={currency}
            description="Volume tiers for additional campaign contacts."
            onChange={onChange}
            productId="campaign"
            slabs={p.contactSlabs}
          />
        </>
      ) : null}

      {activeTab === "channels" ? (
        <Section description="Per-channel usage rates applied on campaign quotes." title="Channel rates">
          <SlabTable
            columns={[
              { field: "defaultCount", label: "Default usage count", numeric: true },
              { field: "rate", label: `Rate (${currency})`, numeric: true },
            ]}
            emptyMessage="No channels yet. Add a channel ID below."
            onPatch={patchChannel}
            rows={channelRows}
          />
          <AddItemControl
            addLabel="Add channel"
            keyLabel="Channel ID"
            onAdd={addChannel}
            placeholder="e.g. rcs"
          />
        </Section>
      ) : null}
    </div>
  );
}

function ValueManagementForm({ catalog, currency, onChange }) {
  const p = catalog.products["value-management"];

  function patchStorageAddOn(field, value) {
    onChange({
      products: {
        "value-management": {
          storageAddOn: { [field]: value },
        },
      },
    });
  }

  return (
    <div className="admin-pricing-product">
      <Section
        description="Monthly subscription defaults for value management quotes."
        title="Subscription base"
      >
        <Field
          label={`Monthly base price (${currency})`}
          numeric
          onChange={(v) =>
            onChange({ products: { "value-management": { base: { monthlyBasePrice: v } } } })
          }
          value={p.base.monthlyBasePrice}
        />
        <Field
          label="Monthly active users (default)"
          numeric
          onChange={(v) =>
            onChange({ products: { "value-management": { base: { monthlyActiveUsers: v } } } })
          }
          value={p.base.monthlyActiveUsers}
        />
      </Section>
      <Section
        description="One-time fee applied on value management onboarding quotes."
        title="Implementation"
        variant="one-time"
      >
        <ImplementationFeeStrip
          currency={currency}
          onChange={(v) => onChange({ products: { "value-management": { implementationFee: v } } })}
          value={p.implementationFee}
        />
      </Section>
      <StorageAddOnSection
        currency={currency}
        onPatch={patchStorageAddOn}
        storageAddOn={p.storageAddOn}
      />
    </div>
  );
}

function TicketingForm({ catalog, currency, onChange }) {
  const p = catalog.products.ticketing;

  function patchStorageAddOn(field, value) {
    onChange({
      products: {
        ticketing: {
          storageAddOn: { [field]: value },
        },
      },
    });
  }

  return (
    <div className="admin-pricing-product">
      <Section description="License and ticket volume defaults for ticketing quotes." title="User & ticket metrics">
        <Field
          label={`User license rate (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { ticketing: { base: { userLicenseRate: v } } } })}
          value={p.base.userLicenseRate}
        />
        <Field
          label="Included tickets"
          numeric
          onChange={(v) => onChange({ products: { ticketing: { base: { includedTickets: v } } } })}
          value={p.base.includedTickets}
        />
        <Field
          label={`Included ticket rate (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { ticketing: { base: { includedTicketRate: v } } } })}
          value={p.base.includedTicketRate}
        />
      </Section>
      <Section
        description="One-time fee applied on Ticketing onboarding quotes."
        title="Implementation"
        variant="one-time"
      >
        <ImplementationFeeStrip
          currency={currency}
          onChange={(v) => onChange({ products: { ticketing: { implementationFee: v } } })}
          value={p.implementationFee ?? ""}
        />
      </Section>
      <StorageAddOnSection
        currency={currency}
        onPatch={patchStorageAddOn}
        storageAddOn={p.storageAddOn}
      />
      <TicketSlabsSection
        currency={currency}
        description="Volume tiers for additional ticketing volume."
        onChange={onChange}
        slabs={p.ticketSlabs}
      />
    </div>
  );
}

function RegionsForm({ catalog, onAddRegion, onChange }) {
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [newTaxLabel, setNewTaxLabel] = useState("");
  const [addError, setAddError] = useState("");

  function patchRegion(name, field, value) {
    onChange({
      regions: {
        [name]: { [field]: value },
      },
    });
  }

  function handleAddRegion() {
    const name = newName.trim();
    if (!name) {
      setAddError("Enter a region name.");
      return;
    }

    if (!newCurrency.trim()) {
      setAddError("Enter a currency code.");
      return;
    }

    const added = onAddRegion(name, newCurrency.trim().toUpperCase(), newTaxLabel.trim() || "VAT");
    if (added === false) {
      setAddError("That region already exists.");
      return;
    }

    setNewName("");
    setNewCurrency("");
    setNewTaxLabel("");
    setAddError("");
  }

  const regionEntries = Object.entries(catalog.regions || {});

  return (
    <div className="admin-pricing-product">
      <p className="admin-pricing-panel__note">
        Each region has its own price catalog. Switch region in the product panel header to edit rates for that market.
      </p>
      <Section description="Currency and tax labels used on quotes for each region." title="Configured regions">
        {regionEntries.length === 0 ? (
          <p className="admin-pricing-empty">No regions yet. Add a market below.</p>
        ) : (
          <div className="admin-pricing-table-wrap">
            <table className="admin-pricing-table admin-pricing-table--regions">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Currency</th>
                  <th>Tax label</th>
                </tr>
              </thead>
              <tbody>
                {regionEntries.map(([name, meta]) => (
                  <tr key={name}>
                    <td className="admin-pricing-table__tier" title={name}>
                      {name}
                    </td>
                    <td>
                      <input
                        className="admin-pricing-table__input admin-pricing-table__input--price"
                        onChange={(event) => patchRegion(name, "currency", event.target.value.toUpperCase())}
                        type="text"
                        value={meta.currency ?? ""}
                      />
                    </td>
                    <td>
                      <input
                        className="admin-pricing-table__input"
                        onChange={(event) => patchRegion(name, "taxLabel", event.target.value)}
                        type="text"
                        value={meta.taxLabel ?? ""}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section description="Clone pricing from the currently selected region into the new market." title="Add region">
        <label className={`admin-pricing-field${addError && !newName.trim() ? " is-invalid" : ""}`}>
          <span>
            Region name <span aria-hidden="true" className="admin-pricing-field__required">*</span>
          </span>
          <input
            aria-invalid={addError && !newName.trim() ? "true" : undefined}
            onChange={(event) => {
              setNewName(event.target.value);
              setAddError("");
            }}
            type="text"
            value={newName}
          />
        </label>
        <label className={`admin-pricing-field${addError && newName.trim() && !newCurrency.trim() ? " is-invalid" : ""}`}>
          <span>
            Currency code <span aria-hidden="true" className="admin-pricing-field__required">*</span>
          </span>
          <input
            aria-invalid={addError && newName.trim() && !newCurrency.trim() ? "true" : undefined}
            onChange={(event) => {
              setNewCurrency(event.target.value);
              setAddError("");
            }}
            type="text"
            value={newCurrency}
          />
        </label>
        <Field label="Tax label" onChange={setNewTaxLabel} value={newTaxLabel} />
        <div className="admin-pricing-add-row">
          <button className="primary-button" onClick={handleAddRegion} type="button">
            <Plus size={14} />
            Add region
          </button>
        </div>
        {addError ? <span className="admin-pricing-add-row__error">{addError}</span> : null}
      </Section>
    </div>
  );
}

const PRODUCT_FORMS = {
  "contact-center": ContactCenterForm,
  crm: CrmForm,
  cdp: CdpForm,
  campaign: CampaignForm,
  "value-management": ValueManagementForm,
  ticketing: TicketingForm,
  regions: RegionsForm,
};

export function AdminPricingPage() {
  const [catalog, setCatalog] = useState(DEFAULT_PRICING_CATALOG);
  const [savedCatalog, setSavedCatalog] = useState(DEFAULT_PRICING_CATALOG);
  const [activeRegion, setActiveRegion] = useState(DEFAULT_REGION);
  const [activeProductId, setActiveProductId] = useState(ADMIN_PRODUCT_ORDER[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = ensureRegionPricing(await fetchPricingCatalog({ force: true }));
        if (!cancelled) {
          setCatalog(data);
          setSavedCatalog(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load pricing catalog.");
          const fallback = ensureRegionPricing(DEFAULT_PRICING_CATALOG);
          setCatalog(fallback);
          setSavedCatalog(fallback);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const regionNames = useMemo(() => Object.keys(catalog.regions || { India: {} }), [catalog.regions]);

  const regionalCatalog = useMemo(
    () => buildRegionalCatalogView(catalog, activeRegion),
    [catalog, activeRegion],
  );

  const regionMeta = catalog.regions?.[activeRegion];
  const currency = regionMeta?.currency ?? "INR";

  const productNavItems = useMemo(
    () =>
      ADMIN_PRODUCT_ORDER.map((id) => {
        const catalogLabel = String(regionalCatalog.products[id]?.label || "").trim();
        const shortLabel = PRODUCT_NAV_LABELS[id] || id;
        return {
          id,
          label: shortLabel,
          title: catalogLabel || shortLabel,
        };
      }),
    [regionalCatalog],
  );

  const activeProduct = useMemo(() => {
    if (activeProductId === "regions") {
      return {
        label: "Regions",
        title: "Regional currency and tax settings",
        lede: "Currency and tax labels used when quoting by region.",
      };
    }

    const catalogLabel = String(regionalCatalog.products[activeProductId]?.label || "").trim();
    const shortLabel = PRODUCT_NAV_LABELS[activeProductId] || activeProductId;
    const PRODUCT_LEDES = {
      "contact-center": `Configuration defaults, plans, and add-ons for ${activeRegion} quotes.`,
      crm: `Licenses, numbers, and contact slabs for ${activeRegion} CRM quotes.`,
      cdp: `Platform base and contact slabs for ${activeRegion} CDP quotes.`,
      campaign: `Base plan, numbers, and channel rates for ${activeRegion} campaign quotes.`,
      "value-management": `Subscription base and implementation for ${activeRegion} value management quotes.`,
      ticketing: `User licenses, tickets, and volume slabs for ${activeRegion} ticketing quotes.`,
    };

    return {
      label: shortLabel,
      title: catalogLabel || shortLabel,
      lede: PRODUCT_LEDES[activeProductId] || `Base rates and defaults for ${activeRegion} quotations.`,
    };
  }, [activeProductId, activeRegion, regionalCatalog]);

  const isDirty = useMemo(() => !catalogsEqual(catalog, savedCatalog), [catalog, savedCatalog]);

  function patchCatalog(partial) {
    setCatalog((current) => ensureRegionPricing(deepMergeCatalog(current, partial)));
    setSuccess("");
  }

  function setProductLabel(productId, value) {
    setCatalog((current) => {
      const ensured = ensureRegionPricing(current);
      const nextLabel = String(value ?? "");
      const nextProducts = {
        ...ensured.products,
        [productId]: {
          ...ensured.products[productId],
          label: nextLabel,
        },
      };
      const nextRegionPricing = Object.fromEntries(
        Object.entries(ensured.regionPricing || {}).map(([regionName, slice]) => [
          regionName,
          {
            ...slice,
            products: {
              ...slice.products,
              [productId]: {
                ...slice.products?.[productId],
                label: nextLabel,
              },
            },
          },
        ]),
      );

      return {
        ...ensured,
        products: nextProducts,
        regionPricing: nextRegionPricing,
      };
    });
    setSuccess("");
  }

  function patchRegionalCatalog(partial) {
    setCatalog((current) => {
      const ensured = ensureRegionPricing(current);
      const slice = getRegionPricingSlice(ensured, activeRegion);
      const mergedSlice = deepMergeCatalog(slice, partial);
      const next = {
        ...ensured,
        regionPricing: {
          ...ensured.regionPricing,
          [activeRegion]: mergedSlice,
        },
      };

      if (activeRegion === "India") {
        next.products = mergedSlice.products;
        next.shared = mergedSlice.shared;
      }

      return next;
    });
    setSuccess("");
  }

  function replaceContactCenter(updater) {
    setCatalog((current) => {
      const ensured = ensureRegionPricing(current);
      const slice = getRegionPricingSlice(ensured, activeRegion);
      const contactCenter = migrateContactCenterProduct(slice.products["contact-center"]);
      const nextContactCenter =
        typeof updater === "function" ? updater(contactCenter) : updater;
      const mergedSlice = {
        ...slice,
        products: {
          ...slice.products,
          "contact-center": nextContactCenter,
        },
      };
      const next = {
        ...ensured,
        regionPricing: {
          ...ensured.regionPricing,
          [activeRegion]: mergedSlice,
        },
      };

      if (activeRegion === "India") {
        next.products = mergedSlice.products;
        next.shared = mergedSlice.shared;
      }

      return next;
    });
    setSuccess("");
  }

  function handleAddRegion(name, currencyCode, taxLabel) {
    if (catalog.regions?.[name]) {
      return false;
    }

    setCatalog((current) => {
      const ensured = ensureRegionPricing(current);
      const template = getRegionPricingSlice(ensured, activeRegion);
      return ensureRegionPricing({
        ...ensured,
        regions: {
          ...ensured.regions,
          [name]: { currency: currencyCode, taxLabel },
        },
        regionPricing: {
          ...ensured.regionPricing,
          [name]: structuredClone(template),
        },
      });
    });
    setSuccess("");
    return true;
  }

  function handleDiscard() {
    setCatalog(structuredClone(savedCatalog));
    setSuccess("");
    setError("");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const scopeProductId = activeProductId;
      let working = ensureRegionPricing(structuredClone(catalog));

      if (scopeProductId === "regions") {
        working.shared = coerceEmptyNumericFieldsToZero(working.shared || {});
        if (working.regionPricing) {
          for (const region of Object.keys(working.regionPricing)) {
            working.regionPricing[region] = {
              ...working.regionPricing[region],
              shared: coerceEmptyNumericFieldsToZero(
                working.regionPricing[region]?.shared || {},
              ),
            };
          }
        }
      } else {
        if (working.products?.[scopeProductId]) {
          working.products[scopeProductId] = coerceEmptyNumericFieldsToZero(
            working.products[scopeProductId],
          );
        }
        if (working.regionPricing) {
          for (const region of Object.keys(working.regionPricing)) {
            const regionProduct = working.regionPricing[region]?.products?.[scopeProductId];
            if (!regionProduct) {
              continue;
            }
            working.regionPricing[region] = {
              ...working.regionPricing[region],
              products: {
                ...working.regionPricing[region].products,
                [scopeProductId]: coerceEmptyNumericFieldsToZero(regionProduct),
              },
            };
          }
        }
      }

      const payload = prepareCatalogForSave(working);
      const validationErrors =
        scopeProductId === "regions"
          ? validatePricingCatalogRegionsPayload(payload)
          : validatePricingCatalogProductPayload(payload, scopeProductId);
      if (validationErrors.length) {
        setError(formatPricingCatalogValidationErrors(validationErrors));
        return;
      }

      const saved = ensureRegionPricing(
        await savePricingCatalog(payload, { scopeProductId }),
      );
      setCatalog(saved);
      setSavedCatalog(saved);
      setCachedPricingCatalog(saved);
      setSuccess(
        scopeProductId === "regions"
          ? "Region settings saved. New quotes will use these values."
          : `${PRODUCT_NAV_LABELS[scopeProductId] || "Product"} pricing saved. New quotes will use these values.`,
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save pricing catalog.");
    } finally {
      setSaving(false);
    }
  }

  const ActiveForm = PRODUCT_FORMS[activeProductId];
  const formOnChange = activeProductId === "regions" ? patchCatalog : patchRegionalCatalog;

  return (
    <div className={`admin-pricing-page ${isDirty ? "has-unsaved" : ""}`}>
      <header className="admin-pricing-page__header">
        <div>
          <h1>Product pricing</h1>
          <p className="admin-pricing-page__subtitle">
            Base prices and usage metrics for quotations.
          </p>
          {catalog.updatedAt ? (
            <small
              className="admin-pricing-page__meta"
              title={`Last saved ${formatCatalogUpdatedAt(catalog.updatedAt)}${
                catalog.updatedBy ? ` by ${catalog.updatedBy}` : ""
              }`}
            >
              Last saved {formatCatalogUpdatedAt(catalog.updatedAt)}
              {catalog.updatedBy ? ` by ${catalog.updatedBy}` : ""}
            </small>
          ) : null}
        </div>
        <button
          className="primary-button"
          disabled={loading || saving || !isDirty}
          onClick={handleSave}
          type="button"
        >
          {saving ? "Saving..." : "Save catalog"}
        </button>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setSuccess("");
        }}
        success={success}
      />

      <div className="admin-pricing-layout">
        <nav aria-label="Products" className="admin-pricing-nav">
          <div className="admin-pricing-nav__group">
            <span className="admin-pricing-nav__label">Products</span>
            {productNavItems.map((item) => (
              <button
                className={`admin-pricing-nav__item ${activeProductId === item.id ? "is-active" : ""}`}
                key={item.id}
                onClick={() => setActiveProductId(item.id)}
                title={item.title}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div aria-hidden className="admin-pricing-nav__divider" />

          <div className="admin-pricing-nav__group">
            <span className="admin-pricing-nav__label">Settings</span>
            <button
              className={`admin-pricing-nav__item ${activeProductId === "regions" ? "is-active" : ""}`}
              onClick={() => setActiveProductId("regions")}
              title="Regional currency and tax settings"
              type="button"
            >
              Regions
            </button>
          </div>
        </nav>

        <div className="admin-pricing-panel">
          <div className="admin-pricing-panel__header">
            <div>
              <h2 title={activeProduct.title}>{activeProduct.label}</h2>
              <p className="admin-pricing-panel__lede">{activeProduct.lede}</p>
            </div>
            <div className="admin-pricing-panel__toolbar">
              {activeProductId !== "regions" ? (
                <Field
                  label="Product name"
                  onChange={(value) => setProductLabel(activeProductId, value)}
                  value={regionalCatalog.products[activeProductId]?.label || ""}
                />
              ) : null}
              {activeProductId !== "regions" ? (
                <label className="admin-pricing-region-select">
                  <span>Region</span>
                  <select
                    aria-label="Pricing region"
                    onChange={(event) => setActiveRegion(event.target.value)}
                    value={activeRegion}
                  >
                    {regionNames.map((name) => {
                      const meta = catalog.regions[name];
                      return (
                        <option key={name} value={name}>
                          {name} · {meta?.currency || ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="admin-pricing-panel__body">
            {loading ? (
              <p className="admin-pricing-page__loading">Loading pricing catalog...</p>
            ) : ActiveForm ? (
              <ActiveForm
                catalog={activeProductId === "regions" ? catalog : regionalCatalog}
                currency={currency}
                key={`${activeProductId}-${activeRegion}`}
                onAddRegion={handleAddRegion}
                onChange={formOnChange}
                onReplaceContactCenter={
                  activeProductId === "contact-center" ? replaceContactCenter : undefined
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      {isDirty ? (
        <div className="admin-pricing-savebar">
          <span className="admin-pricing-savebar__indicator">
            <span aria-hidden className="admin-pricing-savebar__dot" />
            Unsaved changes
          </span>
          <div className="admin-pricing-savebar__actions">
            <button className="secondary-button" disabled={saving} onClick={handleDiscard} type="button">
              Discard
            </button>
            <button className="primary-button" disabled={saving} onClick={handleSave} type="button">
              {saving ? "Saving..." : "Save catalog"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
