# CRM B2B Knowledge Graph Reporting & Analytics Agent

Autonomous, production-grade Knowledge Graph Agent for B2B CRM pipeline analytics, commercial path traversal, and empirical root-cause explanation.

---

## 1. Core Architecture & Standards

- **Zero Hardcoding**: All graph query planning is 100% dynamically decided by the LLM reasoning over the verified schema, ontology, and certified Cypher template registry. No `if/elif` keyword fallback matching exists.
- **Pure Knowledge Graph**: Operates exclusively over the Neo4j Graph Database using read-only Cypher queries (`MATCH ... RETURN`).
- **Honest Failure over Fake Answers**: Any metric lacking schema inputs in the database (e.g. rep quota targets, stage conversion duration, won reason mix) fails honestly with status `UNSUPPORTED`.
- **Rigorous Empirical Grounding**: Explanations cite verified database facts: exact deal titles, stages, amounts, lost reasons, forecast reasons, quote acceptance, invoice due dates, and BANT flags. No speculative psychology.
- **Multi-Tenancy**: Automatically routes queries to tenant database `org1003` (default: `DEFAULT_ORG_ID=1003`).

---

## 2. Commercial Entity Path & Schema

The agent traverses the B2B commercial relationship graph:

$$\text{Account / Company} \longrightarrow \text{Deal} \longrightarrow \text{Quote} \longrightarrow \text{SalesOrder} \longrightarrow \text{Invoice} \longrightarrow \text{Contract}$$

- **`Deal`**: Sales opportunities (`id`, `title`, `stage`, `amount`, `currency`, `expected_close_date`, `closed_at`, `lost_reason`, `forecast_category`, `forecast_reason`, `forecast_flagged`).
  - Stage Probabilities: `qualification` (0.10), `discover` (0.25), `propose` (0.50), `negotiate` (0.75), `closed_won` (1.0), `closed_lost` (0.0).
- **`Account` / `Company`**: Accounts (`id`, `name`, `channel_role`, `domain`, `industry`, `lifecycle_status`).
- **`SalesProfile`**: Person CRM overlay (`id`, `lead_status`, `lead_source`, `crm_status`, `bant_budget`, `bant_authority`, `bant_need`, `bant_timeline`, `disqualify_reason`, `converted_deal_id`).
- **`Contact`**: CDP person record (`cdp_id`, `first_name`, `last_name`, `country`).
- **`Quote`**: Commercial quotation (`id`, `number`, `status`, `approval_status`, `total`, `discount_pct`).
- **`SalesOrder`**: Confirmed order (`id`, `order_number`, `status`, `total`).
- **`Invoice`**: Cash collection billing (`id`, `number`, `status`, `approval_status`, `total`, `due_at`, `paid_at`).
- **`Contract`**: Term agreement (`id`, `name`, `status`, `arr`, `billing_frequency`, `auto_renew`).
- **`Meeting` / `Appointment`**: Scheduled customer interaction (`id`, `status`, `starts_at`, `title`).
- **`Task`**: Operational action item (`id`, `status`, `priority`, `due_at`, `summary`).

---

## 3. Certified Cypher Templates (graph 360 / why / path)

Warehouse counts and money KPIs live in SQL `product/`. This executor keeps graph walks only.

| Template ID | Purpose |
| :--- | :--- |
| `deal_root_cause_loss` | Closed-lost deals grouped by empirical `lost_reason` with citations |
| `deal_forecast_risk_and_stall` | Open deals flagged forecast risk / omitted |
| `deal_commercial_path_walk` | Deal → Quote → Invoice → Contract |
| `customer_account_commercial_summary` | 360 commercial neighborhood for a named account |
| `contact_timeline_and_bant` | Contact BANT and meeting timeline |

---

## 4. Unsupported Metrics Catalog (Honest Refusals)

The following metrics are explicitly refused as `UNSUPPORTED` because required schema inputs are absent:
- **`quota_attainment`**: Rep monthly/quarterly targets are not stored in the database.
- **`time_in_stage`**: Deal stage history is not stored; only current stage is tracked.
- **`stage_conversion`**: Conversion rates between stages require transition history logs.
- **`won_reason_mix`**: Won deals do not have a won-reason column.
- **`email_open_rate`**: Email open/click events are not tracked on activity rows.
- **`campaign_attribution_roi`**: Multi-touch campaign spend is not stored in CRM deals.

---

## 5. Security & RBAC Governance

- **Read-Only Enforcement**: Blocks `CREATE`, `MERGE`, `DELETE`, `SET`, `DROP`, `ALTER`, etc.
- **Limit Capping**: All queries capped at `LIMIT 100`.
- **Role Scoping**:
  - `admin`, `sales_manager`, `finance`: Organization-wide data visibility (`can_view_all_records = true`).
  - `sales_rep`, `presales`, `viewer`: Scoped to `owner_user_id = $user_id`. Fail-closed sentinel `0` if user ID is missing.
- **Domain Fencing**: Prohibits ticketing queries (`Ticket`, `TicketSLA`, etc.).
- **Credential Protection**: Blocks queries accessing passwords, secrets, or API token hashes.

---

## 6. How to Run

### Command Line Interface (CLI)
```bash
# Query active pipeline for org 1003
python main.py "What is our lead status mix across contacts?" --org-id 1003 --role admin

# Query deal loss root causes
python main.py "Why were our deals lost?" --org-id 1003 --role admin

# Test honest refusal on ungrounded metric
python main.py "What is our quota attainment percentage?" --org-id 1003 --role admin
```

### Streamlit Interactive Test Interface
```bash
streamlit run app.py --server.port 8506
```

### Run Automated Test Suite
```bash
pytest tests/ -v
```
All 24 automated tests pass successfully.
