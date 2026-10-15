import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Save, Settings2, Trash2 } from "lucide-react";

import { CCAAS_PLANS, getCcaasPlanLabel } from "../lib/ccaasPlans.js";
import {
  CCAAS_TIER_VOLUME_FIELDS,
  formatTierVolumeAdminValue,
} from "../lib/ccaasConfiguration.js";
import {
  createCustomPlanModule,
  getPlanModuleRows,
} from "../lib/planModules.js";
import {
  CONTACT_CENTER_ADDON_SECTIONS,
  EMPTY_ADDON_BUNDLE,
  createAddonBundleKey,
  defaultLabelForAddonBundle,
  migrateContactCenterProduct,
  resolveAddonBundles,
} from "../lib/contactCenterAddons.js";
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
  formatPricingCatalogValidationErrors,
  handleNumericPaste,
  sanitizeNumericInput,
  sanitizeNumericOrCustomInput,
  sanitizePricingCatalogPayload,
  validatePricingCatalogPayload,
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
  { id: "tiers", label: "Tiers" },
  { id: "modules", label: "Plans" },
  { id: "add-ons", label: "Add-ons" },
];

const ADDON_TABS = CONTACT_CENTER_ADDON_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
}));

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
  return sanitizePricingCatalogPayload({
    ...ensured,
    products: indiaSlice.products,
    shared: indiaSlice.shared,
  });
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
        {numeric ? <span className="admin-pricing-field__required">Required</span> : null}
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

  return (
    <div className="admin-pricing-add-row admin-pricing-add-row--expanded">
      <label className="admin-pricing-field">
        <span>{keyLabel}</span>
        <input
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError("");
          }}
          placeholder={placeholder}
          type="text"
          value={draft}
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
            setDraft("");
            setLocalError("");
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      {localError || error ? <p className="form-error admin-pricing-add-row__error">{localError || error}</p> : null}
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
      <label className="admin-pricing-field">
        <span>Module name</span>
        <input
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
      {localError ? <p className="form-error admin-pricing-add-row__error">{localError}</p> : null}
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

function BundleAddonsSection({
  addLabel,
  bundles,
  currency,
  description,
  keyLabel,
  onAdd,
  onDelete,
  onPatch,
  placeholder,
  title,
}) {
  return (
    <Section description={description} title={title}>
      <SlabTable
        columns={[
          { field: "label", label: "Label" },
          { field: "rate", label: `Rate (${currency})`, numeric: true },
        ]}
        onDelete={onDelete}
        onPatch={onPatch}
        rows={Object.entries(bundles).map(([key, bundle]) => ({
          key,
          label: bundle.label || key,
          data: bundle,
        }))}
      />
      <AddItemControl
        addLabel={addLabel}
        keyLabel={keyLabel}
        onAdd={onAdd}
        placeholder={placeholder}
      />
    </Section>
  );
}

function SlabTable({ columns, onDelete, onPatch, rows }) {
  return (
    <div className="admin-pricing-table-wrap">
      <table className="admin-pricing-table">
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
              <td className="admin-pricing-table__tier">{row.label}</td>
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
  const [activeAddonId, setActiveAddonId] = useState(ADDON_TABS[0]?.id || "voice");

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

  function patchTierAgentRate(planId, value) {
    onChange({
      products: {
        "contact-center": {
          tierAgentRates: {
            [planId]: sanitizeNumericOrCustomInput(value),
          },
        },
      },
    });
  }

  function patchLiveAgentAdditionalRate(value) {
    onChange({
      products: {
        "contact-center": {
          liveAgent: { additionalAgentRate: value },
        },
      },
    });
  }

  function patchLiveAgentTelcoCharge(value) {
    onChange({
      products: {
        "contact-center": {
          liveAgent: { telcoLineCharge: value },
        },
      },
    });
  }

  function removeAddonBundle(addonId, bundleKey) {
    if (!onReplaceContactCenter) {
      return;
    }

    onReplaceContactCenter((current) => {
      const bundles = { ...resolveAddonBundles(current, addonId) };
      delete bundles[bundleKey];

      return {
        ...current,
        addons: {
          ...current.addons,
          [addonId]: { bundles },
        },
      };
    });
  }

  function patchAddonBundle(addonId, bundleKey, field, value) {
    onChange({
      products: {
        "contact-center": {
          addons: {
            [addonId]: {
              bundles: {
                [bundleKey]: { [field]: value },
              },
            },
          },
        },
      },
    });
  }

  function addAddonBundle(addonId, rawKey) {
    const bundleKey = createAddonBundleKey(addonId, rawKey);
    if (!bundleKey) {
      return false;
    }

    const bundles = resolveAddonBundles(p, addonId);
    if (bundles[bundleKey]) {
      return false;
    }

    onChange({
      products: {
        "contact-center": {
          addons: {
            [addonId]: {
              bundles: {
                [bundleKey]: {
                  ...EMPTY_ADDON_BUNDLE,
                  label: defaultLabelForAddonBundle(addonId, bundleKey),
                },
              },
            },
          },
        },
      },
    });
    return true;
  }

  const planModuleRows = getPlanModuleRows(p, modulePlanId);
  const tierDefaultVolumes = p.tierDefaultVolumes || {};
  const tierAgentRates = p.tierAgentRates || {};
  const activeAddon =
    CONTACT_CENTER_ADDON_SECTIONS.find((section) => section.id === activeAddonId) ||
    CONTACT_CENTER_ADDON_SECTIONS[0];
  const activeAddonBundles = resolveAddonBundles(p, activeAddon.id);
  const isHumanAgentAddon = activeAddon.kind === "additional-agent-rate";

  return (
    <>
      <SubTabs activeId={activeTab} items={CONTACT_CENTER_TABS} onChange={setActiveTab} />

      {activeTab === "tiers" ? (
        <Section
          description="Default included usage per user per month for each license tier. Sales quotes multiply volume metrics by agent count. Use 0 for unavailable metrics, or custom for enterprise."
          title="Tier based default volume"
        >
          <div className="admin-pricing-table-wrap admin-pricing-field--full">
            <table className="admin-pricing-table admin-pricing-table--modules">
              <thead>
                <tr>
                  <th>Metric (per user/month)</th>
                  {CCAAS_PLANS.map((plan) => (
                    <th key={plan.id}>
                      {plan.label}
                      {plan.subtitle ? ` (${plan.subtitle})` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="admin-pricing-table__tier">Agent price</td>
                  {CCAAS_PLANS.map((plan) => (
                    <td key={`${plan.id}-agent-price`}>
                      <NumericTableInput
                        allowCustom
                        className="admin-pricing-table__input admin-pricing-table__input--price"
                        onChange={(next) => patchTierAgentRate(plan.id, next)}
                        placeholder={plan.id === "enterprise" ? "custom" : "0"}
                        value={tierAgentRates[plan.id] ?? ""}
                      />
                    </td>
                  ))}
                </tr>
                {CCAAS_TIER_VOLUME_FIELDS.map((metric) => (
                  <tr key={metric.id}>
                    <td className="admin-pricing-table__tier">{metric.label}</td>
                    {CCAAS_PLANS.map((plan) => {
                      const rawValue = tierDefaultVolumes[plan.id]?.[metric.id] ?? "";

                      return (
                        <td key={`${plan.id}-${metric.id}`}>
                          <NumericTableInput
                            allowCustom
                            className="admin-pricing-table__input admin-pricing-table__input--price"
                            onChange={(next) => patchTierVolume(plan.id, metric.id, next)}
                            placeholder={plan.id === "enterprise" ? "custom" : "0"}
                            title={formatTierVolumeAdminValue(rawValue)}
                            value={rawValue}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {activeTab === "modules" ? (
        <>
          <SubTabs activeId={modulePlanId} items={MODULE_PLAN_TABS} onChange={setModulePlanId} />
          <Section
            description={`Define module names and capabilities for ${getCcaasPlanLabel(modulePlanId)}. These appear in sales product pricing when that plan is selected.`}
            title={`${getCcaasPlanLabel(modulePlanId)} modules`}
          >
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
          <SubTabs activeId={activeAddonId} items={ADDON_TABS} onChange={setActiveAddonId} />
          {isHumanAgentAddon ? (
            <Section
              description={activeAddon.description}
              title={`${activeAddon.label} add-ons`}
            >
              <Field
                label={`Additional agent price (${currency})`}
                numeric
                onChange={patchLiveAgentAdditionalRate}
                value={p.liveAgent?.additionalAgentRate ?? ""}
              />
              <Field
                label={`Telco line charge / agent (${currency})`}
                numeric
                onChange={patchLiveAgentTelcoCharge}
                value={p.liveAgent?.telcoLineCharge ?? ""}
              />
            </Section>
          ) : (
            <BundleAddonsSection
              addLabel={activeAddon.addLabel}
              bundles={activeAddonBundles}
              currency={currency}
              description={activeAddon.description}
              keyLabel={activeAddon.keyLabel}
              onAdd={(key) => addAddonBundle(activeAddon.id, key)}
              onDelete={(bundleKey) => removeAddonBundle(activeAddon.id, bundleKey)}
              onPatch={(bundleKey, field, value) =>
                patchAddonBundle(activeAddon.id, bundleKey, field, value)
              }
              placeholder={activeAddon.placeholder}
              title={`${activeAddon.label} add-ons`}
            />
          )}
        </>
      ) : null}
    </>
  );
}

function CrmForm({ catalog, currency, onChange }) {
  const p = catalog.products.crm;

  return (
    <>
      <Section description="Core license and contact limits for CRM quotes." title="Base metrics">
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
      </Section>
      <Section description="Charged once during CRM onboarding." title="Implementation" variant="one-time">
        <Field
          label={`Implementation fee (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { crm: { implementationFee: v } } })}
          value={p.implementationFee}
        />
      </Section>
    </>
  );
}

function CdpForm({ catalog, currency, onChange }) {
  const p = catalog.products.cdp;

  return (
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
      <Field
        label="Data sources (default)"
        numeric
        onChange={(v) => onChange({ products: { cdp: { base: { dataSources: v } } } })}
        value={p.base.dataSources}
      />
    </Section>
  );
}

function CampaignForm({ catalog, currency, onChange }) {
  const p = catalog.products.campaign;
  const [activeTab, setActiveTab] = useState("base");

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

  return (
    <>
      <SubTabs activeId={activeTab} items={CAMPAIGN_TABS} onChange={setActiveTab} />

      {activeTab === "base" ? (
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
        </Section>
      ) : null}

      {activeTab === "channels" ? (
        <Section description="Per-channel usage rates applied on campaign quotes." title="Channel rates">
          <SlabTable
            columns={[
              { field: "defaultCount", label: "Default usage count", numeric: true },
              { field: "rate", label: `Rate (${currency})`, numeric: true },
            ]}
            onPatch={patchChannel}
            rows={Object.entries(p.channels).map(([channel, rates]) => ({
              key: channel,
              label: channel,
              data: rates,
            }))}
          />
          <AddItemControl
            addLabel="Add channel"
            keyLabel="Channel ID"
            onAdd={addChannel}
            placeholder="e.g. rcs"
          />
        </Section>
      ) : null}
    </>
  );
}

function ValueManagementForm({ catalog, currency, onChange }) {
  const p = catalog.products["value-management"];

  return (
    <>
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
      <Section description="Charged once during value management onboarding." title="Implementation" variant="one-time">
        <Field
          label={`Implementation fee (${currency})`}
          numeric
          onChange={(v) => onChange({ products: { "value-management": { implementationFee: v } } })}
          value={p.implementationFee}
        />
      </Section>
    </>
  );
}

function TicketingForm({ catalog, currency, onChange }) {
  const p = catalog.products.ticketing;

  return (
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
  );
}

function SharedSlabsForm({ catalog, currency, onChange }) {
  function patchContactSlab(key, field, value) {
    onChange({ shared: { contactSlabs: { [key]: { [field]: value } } } });
  }

  function patchTicketSlab(key, field, value) {
    onChange({ shared: { ticketSlabs: { [key]: { [field]: value } } } });
  }

  function addContactSlab(key) {
    if (catalog.shared.contactSlabs[key]) {
      return false;
    }

    onChange({
      shared: {
        contactSlabs: {
          [key]: { ...EMPTY_CONTACT_SLAB, contacts: key },
        },
      },
    });
    return true;
  }

  function addTicketSlab(key) {
    if (catalog.shared.ticketSlabs[key]) {
      return false;
    }

    onChange({
      shared: {
        ticketSlabs: {
          [key]: { ...EMPTY_TICKET_SLAB, tickets: key },
        },
      },
    });
    return true;
  }

  return (
    <>
      <p className="admin-pricing-panel__note">
        Used by CRM, Campaign, and Ticketing when sales adds contacts or tickets beyond included limits.
      </p>
      <Section description="Volume tiers for additional CRM and campaign contacts." title="Additional contact slabs">
        <SlabTable
          columns={[
            { field: "contacts", label: "Contacts label" },
            { field: "monthlyPrice", label: `Monthly price (${currency})`, numeric: true },
            { field: "perContactRate", label: `Per-contact rate (${currency})`, numeric: true },
          ]}
          onPatch={patchContactSlab}
          rows={Object.entries(catalog.shared.contactSlabs).map(([key, slab]) => ({
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
      <Section description="Volume tiers for additional ticketing volume." title="Additional ticket slabs">
        <SlabTable
          columns={[
            { field: "tickets", label: "Tickets label" },
            { field: "monthlyPrice", label: `Monthly price (${currency})`, numeric: true },
            { field: "perTicketRate", label: `Per-ticket rate (${currency})`, numeric: true },
          ]}
          onPatch={patchTicketSlab}
          rows={Object.entries(catalog.shared.ticketSlabs).map(([key, slab]) => ({
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
    </>
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

  return (
    <>
      <p className="admin-pricing-panel__note">
        Each region has its own price catalog. Switch region in the panel header to edit product pricing for that market.
      </p>
      <Section description="Currency and tax labels used on quotes for each region." title="Configured regions">
        <div className="admin-pricing-table-wrap">
          <table className="admin-pricing-table">
            <thead>
              <tr>
                <th>Region</th>
                <th>Currency</th>
                <th>Tax label</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(catalog.regions || {}).map(([name, meta]) => (
                <tr key={name}>
                  <td className="admin-pricing-table__tier">{name}</td>
                  <td>
                    <input
                      className="admin-pricing-table__input"
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
      </Section>
      <Section description="Clone pricing from the currently selected region into the new market." title="Add region">
        <Field label="Region name" onChange={setNewName} value={newName} />
        <Field label="Currency code" onChange={setNewCurrency} value={newCurrency} />
        <Field label="Tax label" onChange={setNewTaxLabel} value={newTaxLabel} />
        <div className="admin-pricing-add-row">
          <button className="primary-button" onClick={handleAddRegion} type="button">
            <Plus size={14} />
            Add region
          </button>
        </div>
        {addError ? <p className="form-error admin-pricing-add-row__error">{addError}</p> : null}
      </Section>
    </>
  );
}

const PRODUCT_FORMS = {
  "contact-center": ContactCenterForm,
  crm: CrmForm,
  cdp: CdpForm,
  campaign: CampaignForm,
  "value-management": ValueManagementForm,
  ticketing: TicketingForm,
  shared: SharedSlabsForm,
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
      ADMIN_PRODUCT_ORDER.map((id) => ({
        id,
        label: PRODUCT_NAV_LABELS[id] || id,
        title: regionalCatalog.products[id]?.label || id,
      })),
    [regionalCatalog],
  );

  const activeProduct = useMemo(() => {
    if (activeProductId === "shared") {
      return { label: "Shared slabs", title: "Shared pricing slabs" };
    }

    if (activeProductId === "regions") {
      return { label: "Regions", title: "Regional currency and tax settings" };
    }

    return {
      label: PRODUCT_NAV_LABELS[activeProductId] || activeProductId,
      title: regionalCatalog.products[activeProductId]?.label || activeProductId,
    };
  }, [activeProductId, regionalCatalog]);

  const isDirty = useMemo(() => !catalogsEqual(catalog, savedCatalog), [catalog, savedCatalog]);

  function patchCatalog(partial) {
    setCatalog((current) => ensureRegionPricing(deepMergeCatalog(current, partial)));
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
      const payload = prepareCatalogForSave(catalog);
      const validationErrors = validatePricingCatalogPayload(payload);
      if (validationErrors.length) {
        setError(formatPricingCatalogValidationErrors(validationErrors));
        return;
      }

      const saved = ensureRegionPricing(await savePricingCatalog(payload));
      setCatalog(saved);
      setSavedCatalog(saved);
      setCachedPricingCatalog(saved);
      setSuccess("Pricing catalog saved. New quotes will use these values.");
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
          <p className="admin-pricing-breadcrumb">
            Admin
            <ChevronRight aria-hidden size={14} />
            Product pricing
          </p>
          <h1>
            <Settings2 size={24} />
            Product pricing catalog
          </h1>
          <p>Base prices and usage metrics for quotations.</p>
          {catalog.updatedAt ? (
            <small className="admin-pricing-page__meta">
              Last saved {new Date(catalog.updatedAt).toLocaleString()}
              {catalog.updatedBy ? ` by ${catalog.updatedBy}` : ""}
            </small>
          ) : null}
        </div>
        <button className="primary-button" disabled={loading || saving || !isDirty} onClick={handleSave} type="button">
          <Save size={16} />
          {saving ? "Saving..." : "Save catalog"}
        </button>
      </header>

      {error ? <p className="form-error admin-pricing-page__banner">{error}</p> : null}
      {success ? <p className="admin-pricing-page__success admin-pricing-page__banner">{success}</p> : null}

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
            <span className="admin-pricing-nav__label">Shared</span>
            <button
              className={`admin-pricing-nav__item ${activeProductId === "shared" ? "is-active" : ""}`}
              onClick={() => setActiveProductId("shared")}
              title="Contact and ticket volume slabs"
              type="button"
            >
              Shared slabs
            </button>
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
              <h2>{activeProduct.label}</h2>
              {activeProductId !== "shared" && activeProductId !== "regions" ? (
                <p className="admin-pricing-panel__subtitle">{activeProduct.title}</p>
              ) : null}
            </div>
            {activeProductId !== "regions" ? (
              <label className="admin-pricing-region-select">
                <span className="sr-only">Pricing region</span>
                <select onChange={(event) => setActiveRegion(event.target.value)} value={activeRegion}>
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
              <Save size={16} />
              {saving ? "Saving..." : "Save catalog"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
