// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Inbox } from "lucide-react";

import { fetchCommissionSlabs, formatSlabRange } from "../lib/commissions.js";
import { getLeadCountryDefaults } from "../lib/countryDefaults.js";
import { COUNTRY_OPTIONS } from "../lib/leads.js";
import "../styles/admin-users-light.css";
import "../styles/finance-partner-commissions.css";

function CountryFilterDropdown({
  containerRef,
  country,
  countries,
  onClose,
  onCountryChange,
  onReset,
}) {
  useEffect(() => {
    function handlePointerDown(event) {
      const container = containerRef?.current;
      if (container && !container.contains(event.target)) {
        onClose();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [containerRef, onClose]);

  return (
    <div
      className="admin-users-filter-dropdown finance-partner-commissions-filter"
      role="dialog"
      aria-label="Filter commission slabs"
    >
      <div className="finance-partner-commissions-filter__scroll">
        <div className="admin-users-filter-dropdown__section">
          <p className="admin-users-filter-dropdown__title">Filter by</p>
          <div className="admin-users-filter-dropdown__field">
            <span>Country</span>
            <select
              aria-label="Filter commission slabs by country"
              onChange={(event) => onCountryChange(event.target.value)}
              value={country}
            >
              {countries.map((option) => (
                <option key={option} value={option}>
                  {option} ({getLeadCountryDefaults(option).currency})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button className="secondary-button" onClick={onReset} type="button">
          Reset
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Apply
        </button>
      </div>
    </div>
  );
}

export function CommissionSlabsReadonly({
  title = "Commission slabs",
  variant = "card",
}) {
  const filterAnchorRef = useRef(null);
  const [country, setCountry] = useState("India");
  const [showFilters, setShowFilters] = useState(false);
  const [slabs, setSlabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currency = getLeadCountryDefaults(country).currency || "INR";
  const isPanel = variant === "panel";
  const countriesWithSlabs = useMemo(() => COUNTRY_OPTIONS, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCommissionSlabs({ country })
      .then((rows) => {
        if (!cancelled) {
          setSlabs(rows.filter((slab) => slab.isActive !== false));
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load slabs.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  const countryControl = (
    <label className="field commission-slabs-page__country-inline">
      <span>Country</span>
      <select
        aria-label="Filter commission slabs by country"
        onChange={(event) => setCountry(event.target.value)}
        value={country}
      >
        {countriesWithSlabs.map((option) => (
          <option key={option} value={option}>
            {option} ({getLeadCountryDefaults(option).currency})
          </option>
        ))}
      </select>
    </label>
  );

  const table = !loading && !error && slabs.length > 0 ? (
    <div className={isPanel ? "admin-users-panel__table-wrap" : undefined}>
      <table
        className={
          isPanel
            ? "admin-users-table finance-partner-commissions-slabs-table"
            : "commission-slabs-table"
        }
      >
        <thead>
          <tr>
            <th>Deal range ({currency})</th>
            <th>Commission rate</th>
          </tr>
        </thead>
        <tbody>
          {slabs.map((slab) => (
            <tr key={slab.id}>
              <td title={formatSlabRange(slab)}>{formatSlabRange(slab)}</td>
              <td title={`${Number(slab.ratePercent).toFixed(2)}%`}>
                {Number(slab.ratePercent).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : null;

  if (isPanel) {
    return (
      <section className="admin-users-panel finance-partner-commissions-slabs-panel partner-bank-slabs-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>{title}</h2>
            <p>
              Percentage of paid quotation totals by country · {country} ({currency})
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            <div className="admin-users-panel__filter-anchor" ref={filterAnchorRef}>
              <button
                className={`admin-users-panel__tool-button ${
                  showFilters || country !== "India" ? "is-active" : ""
                }`}
                onClick={() => setShowFilters((current) => !current)}
                type="button"
              >
                <Filter size={16} aria-hidden="true" />
                Filters
              </button>
              {showFilters ? (
                <CountryFilterDropdown
                  containerRef={filterAnchorRef}
                  countries={countriesWithSlabs}
                  country={country}
                  onClose={() => setShowFilters(false)}
                  onCountryChange={setCountry}
                  onReset={() => setCountry("India")}
                />
              ) : null}
            </div>
          </div>
        </header>
        <div className="admin-users-panel__body">
          {error ? (
            <div className="finance-partner-commissions-empty" role="alert">
              <Inbox size={28} aria-hidden="true" />
              <h3>Could not load slabs</h3>
              <p>{error}</p>
            </div>
          ) : null}
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading slabs…
            </p>
          ) : null}
          {!loading && !error && slabs.length === 0 ? (
            <div className="finance-partner-commissions-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No active slabs</h3>
              <p>No active commission slabs published for {country}.</p>
            </div>
          ) : null}
          {table}
        </div>
      </section>
    );
  }

  return (
    <section className="commission-slabs-card">
      <header className="commission-slabs-card__header">
        <div>
          <h2>{title}</h2>
          <p>Percentage of paid quotation totals by country.</p>
        </div>
        {countryControl}
      </header>
      <div className="commission-slabs-card__body">
        {error ? (
          <p className="form-error" style={{ padding: "16px 24px" }}>
            {error}
          </p>
        ) : null}
        {loading ? <p className="admin-directory-panel__empty">Loading slabs…</p> : null}
        {!loading && !error && slabs.length === 0 ? (
          <p className="admin-directory-panel__empty">
            No active commission slabs published for {country}.
          </p>
        ) : null}
        {table}
      </div>
    </section>
  );
}
