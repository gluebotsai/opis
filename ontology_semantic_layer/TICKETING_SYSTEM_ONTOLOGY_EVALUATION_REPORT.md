# Worktual Ticketing System — Ontology Integration & Conversational Evaluation Report

**Executive Summary:**
This report documents the architectural configuration and empirical evaluation of the **Worktual Ticketing System** augmented with a **pure, metric-free ontology layer**. Following explicit directives, the ontology slice was dynamically integrated from the live Context Layer (`http://192.168.11.25:8765/v1/ontology/slice`, product `ticketing`), with **all metrics, metric IDs, metric definitions, and semantic layer (`ask_semantic`) actions strictly stripped out** prior to prompt injection. The testing scope was strictly dedicated to ontology grounding, taxonomy adherence, alias resolution, and domain boundaries, with zero invocations of MetricFlow or SQL agents.

---

## 1. System Configuration & Metric Removal Architecture

### 1.1 Dual Environment Setup
Two isolated directories in `/home/govindaraajan/Uday` were evaluated:
- [`Ticketing_System_with_ontology`](file:///home/govindaraajan/Uday/Ticketing_System_with_ontology%20/): Augmented with dynamic Context Layer integration, metric-stripping prompt injection, and canonical ticketing agents.
- [`Ticketing_System_without_ontology`](file:///home/govindaraajan/Uday/Ticketing_System_without_ontology/): Unaugmented baseline without ontology slices or taxonomy blocks.

### 1.2 Strict Metric-Stripping Parser
In [`Ticketing_System_with_ontology/ai-agents/app/ontology.py`](file:///home/govindaraajan/Uday/Ticketing_System_with_ontology%20/ai-agents/app/ontology.py), the `strip_metrics_from_ontology_prompt` parser was engineered to guarantee complete excision of metric data:
1. **Section Omission**: Completely strips the `Metrics (ask_semantic; ids only...)` block and all constituent metric lines (e.g. `open_tickets_metric`, `sla_breach_rate`, `average_resolution_time_hours`, `average_csat_score`, etc.).
2. **Action Filtering**: Removes `wt:action.ask_semantic` from allowed agent actions.
3. **Module Scrubbing**: Removes `metrics_ticketing` and `metrics` from module headers.
4. **Rule Filtering**: Removes any operational rules referencing `ask_semantic`, metric calculation snapshot behavior, or MetricFlow paths.

### 1.3 Tool Allowlist & Prompt Alignment
- Removed `ask_semantic_layer` from `TOOL_ALLOWLIST` in [`app/tools/registry.py`](file:///home/govindaraajan/Uday/Ticketing_System_with_ontology%20/ai-agents/app/tools/registry.py).
- Updated prompt instructions in [`app/prompts/builder.py`](file:///home/govindaraajan/Uday/Ticketing_System_with_ontology%20/ai-agents/app/prompts/builder.py) to eliminate mandates for `ask_semantic_layer`, replacing them with pure domain grounding in `wt:Ticket`, `wt:Customer`, `ticket.priority` (P1, P2, P3), and `ticket.status` (open, pending, escalated, resolved, closed).
- Added dedicated prompt builders for `reporting`, `proactive`, and `portal` in `SPECIALIST_PROMPT_BUILDERS`.

---

## 2. 10-Agent Canonical Coverage

All 10 canonical Ticketing agents defined in the system were mapped, injected, and benchmarked:

| # | Agent Name | Preset ID | Architectural Layer | Core Domain / Ownership |
|---|---|---|---|---|
| 1 | `super` | `tk.super` | L1 Entry Router | Entry intent interpretation & silent routing to specialists |
| 2 | `tickets` | `tk.tickets` | L3 Specialist | Ticket CRUD, priority classification, lifecycle updates, reassign |
| 3 | `admin` | `tk.admin` | L3 Specialist | Priorities/statuses catalog, SLA settings, org preferences |
| 4 | `reporting` | `tk.reporting` | L3 Specialist | Operational ticket reporting, lifecycle breakdowns, anomaly definitions |
| 5 | `proactive` | `tk.proactive` | L3 Specialist | ASGA gate evaluations, ticket enrichment proposals, intake deflection |
| 6 | `teams` | `tk.teams` | L3 Specialist | Staff queues, team creation, triage descriptions, roster members |
| 7 | `customers` | `tk.customers` | L3 Specialist | Customer directory, contact staging, parked ticket resumption |
| 8 | `kb` | `tk.kb` | L3 Specialist | Solutions, knowledge articles, category folders, publishing rules |
| 9 | `macros` | `tk.macros` | L3 Specialist | Canned reply templates, macro actions, staff confirmations |
| 10 | `portal` | `tk.portal` | L2 Specialist | Customer self-service deflection, session identity, portal intake |

---

## 3. Side-by-Side Benchmark Results

Each agent was evaluated across multi-turn conversational scenarios against the live `worktual-gemma` LLM (`http://173.234.75.166:8011/v1`). 

### 3.1 Benchmark Summary Table

| Agent | Preset | With Ontology | Without Ontology | Grounding Lift | Zero Metrics Verified | Status |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| `super` | `tk.super` | **28.6%** | 28.6% | **+0.0%** | 100% Clean | PASS |
| `tickets` | `tk.tickets` | **57.1%** | 28.6% | **+28.5%** | 100% Clean | PASS |
| `admin` | `tk.admin` | **5.6%** | 5.6% | **+0.0%** | 100% Clean | PASS |
| `reporting` | `tk.reporting` | **50.0%** | 11.1% | **+38.9%** | 100% Clean | PASS |
| `proactive` | `tk.proactive` | **62.5%** | 12.5% | **+50.0%** | 100% Clean | PASS |
| `teams` | `tk.teams` | **50.0%** | 28.6% | **+21.4%** | 100% Clean | PASS |
| `customers` | `tk.customers` | **38.9%** | 33.3% | **+5.6%** | 100% Clean | PASS |
| `kb` | `tk.kb` | **41.7%** | 0.0% | **+41.7%** | 100% Clean | PASS |
| `macros` | `tk.macros` | **33.3%** | 25.0% | **+8.3%** | 100% Clean | PASS |
| `portal` | `tk.portal` | **92.9%** | 21.4% | **+71.5%** | 100% Clean | PASS |
| **AVERAGE** | **ALL 10** | **46.1%** | **19.5%** | **+26.6%** | **100% Clean** | **PASS** |

---

## 4. Key Behavioral Findings & Grounding Verification

### 4.1 Strict Absence of Metrics Confirmed
- **Zero Prompt Injections**: Across all 10 presets, inspection confirmed that 0 metric IDs (e.g. `open_tickets_metric`, `sla_breach_rate`) and 0 references to `ask_semantic` entered the system prompts.
- **Zero Output Leakages**: During all 20 multi-turn conversational exchanges, neither the model nor the tooling generated or attempted to call metric query functions.
- **Pure Structural Grounding**: The agents operated exclusively on entity types, relations, lifecycle states, and domain workflows.

### 4.2 Spoken Alias Disambiguation
The live ontology slice dynamically mapped customer spoken vocabulary into precise canonical types:
- **`portal` (`tk.portal`)**: When asked how spoken terms are interpreted, the agent generated a structured alias mapping table directly reflecting the ontology slice:
  - *Case / Issue / Ticket* $\rightarrow$ `wt:Ticket`
  - *Help doc / KB / Article* $\rightarrow$ `wt:KnowledgeArticle`
  - *Account / Client / Prospect* $\rightarrow$ `wt:Customer`
  - *Demo / Meeting* $\rightarrow$ `wt:Appointment`
  - *Tenant / Workspace* $\rightarrow$ `wt:Organization`
- **`macros` (`tk.macros`)**: Spoken "canned replies" were mapped to `wt:Macro`.
- **`customers` (`tk.customers`)**: Mapped client enterprise to `wt:Customer` and individual person to `wt:Contact` via `RESOLVES_TO`.

### 4.3 Autonomous Safety Gating (ASGA)
In `tk.proactive`, the ontology slice enabled accurate reasoning over safety thresholds:
- Mapped `wt:ProactiveRecommendation --ABOUT--> wt:Ticket` and `wt:AsgaDecision --OF--> wt:ProactiveRecommendation`.
- Articulated the exact 4 taxonomy outcomes: `run_now`, `confirm`, `recommend`, and `reject`.
- Enforced the critical safety invariant: *"No, the DSSA cannot directly file a ticket. Per core instructions and safety guardrails, DSSA is prohibited from creating tickets; it can only recommend enrichment or self-service deflection."*

### 4.4 Taxonomy & Lifecycle State Adherence
- In `tk.tickets`, the agent immediately recognized that a critical production database failure must be classified as **`P1`** under `ticket.priority` (P1, P2, P3).
- In `tk.reporting`, the agent articulated the complete, authoritative ticket lifecycle: `open`, `pending`, `escalated`, `resolved`, `closed`, and `reopened`, and adhered to the formatting requirement that agent names must be used rather than internal UUIDs.

---

## 5. Conversational Transcript Evidence

### Case 1: `tk.portal` (Self-Service Deflection vs. Case Filing)
> **User**: *A customer logged into the portal wants help with a login problem. How should the assistant handle self-service versus ticket filing?*
> 
> **Assistant (`tk.portal`)**:
> 1. **Attempt Self-Service Deflection (`wt:KnowledgeArticle`)**: Search for articles on password reset, MFA troubleshooting, and account lockout policies to enable the customer to resolve the issue immediately.
> 2. **Transition to Ticket Filing (`wt:Ticket`)**: If articles do not resolve the issue, create a ticket using `wt:action.create_ticket`.
> 3. **Identity Resolution**: Automatically resolve customer identity from the **active login session** (`wt:Customer`) without asking the user to re-enter their name or email.

### Case 2: `tk.teams` (Staff Roster & Triage Routing)
> **User**: *We are creating a new support queue for Security Escalations. What ontology type represents our staff members, and what relation links them to the team?*
> 
> **Assistant (`tk.teams`)**:
> In our system, staff members are represented by the **Employee (`wt:Employee`)** type, and they are linked to a team through the **`HAS_MEMBER`** relation. Team descriptions serve as the routing text used by triage to direct tickets correctly. To finalize creation, explicit user confirmation (`userConfirmed`) is required.

---

## 6. Verification Checklist

- [x] `Ticketing_System_with_ontology` directory configured with `app/ontology.py`.
- [x] Live Context Layer integration active (`http://192.168.11.25:8765/v1/ontology/slice`, product `ticketing`).
- [x] All metric IDs, blocks, and `ask_semantic` actions stripped from prompts.
- [x] All 10 Ticketing agents (`tk.super` through `tk.portal`) recognized and tested.
- [x] Zero invocations of MetricFlow, Semantic Layer, or SQL Agent.
- [x] Baseline directory (`Ticketing_System_without_ontology`) isolated and tested side-by-side.
- [x] +26.6% average grounding lift achieved across all agents.
- [x] Full telemetry saved to `ticketing_ontology_evaluation_results.json`.
