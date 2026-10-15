# CCaaS Knowledge Graph Analytics Skills Index

This directory contains the formal skill playbooks and reasoning patterns for the **Contact Center Knowledge Graph Analytics Executor**.

---

## Skills Catalog

| Skill Name | Purpose & Specialization | Playbook File |
| :--- | :--- | :--- |
| **`root-cause-4step-traversal`** | Mandatory 5-step causal graph audit (Population $\rightarrow$ Telemetry $\rightarrow$ Attribution $\rightarrow$ System Facts $\rightarrow$ Narrative). | [`root_cause_4step_traversal.md`](./root_cause_4step_traversal.md) |
| **`telemetry-ground-truth-protocol`** | Authoritative telemetry dictionary & fact attribution standards. | [`telemetry_ground_truth_protocol.md`](./telemetry_ground_truth_protocol.md) |
| **`hierarchical-duration-engine`** | Mathematical precision, channel duration segregation, and hierarchical time formatting. | [`hierarchical_duration_engine.md`](./hierarchical_duration_engine.md) |
| **`error-recovery-and-guardrails`** | Anti-hallucination, domain fencing, division-by-zero protection, and self-repair recipes. | [`error_recovery_and_guardrails.md`](./error_recovery_and_guardrails.md) |
| **`analytics-graph-path`** | Multi-hop graph traversals across conversations, queues, agents, and customer journeys. | [`analytics_graph_path.md`](./analytics_graph_path.md) |
| **`analytics-predictive-risk-modeling`** | Forward-looking risk quantification (queue overflow, abandonment, transfer loops, SLA exposure). | [`analytics_predictive_risk_modeling.md`](./analytics_predictive_risk_modeling.md) |
| **`analytics-prescriptive-action-targeting`** | Joining operational schedules, shifts, and queues for concrete, targeted recommendations. | [`analytics_prescriptive_action_targeting.md`](./analytics_prescriptive_action_targeting.md) |

---

## 3-Pillar Operational Mapping

```
                               ┌────────────────────────────────────────┐
                               │  Knowledge Graph Execution Engine      │
                               └───────────────────┬────────────────────┘
                                                   │
                ┌──────────────────────────────────┼──────────────────────────────────┐
                ▼                                  ▼                                  ▼
   ┌─────────────────────────┐        ┌─────────────────────────┐        ┌─────────────────────────┐
   │ Pillar 1: Descriptive   │        │ Pillar 2: Predictive    │        │ Pillar 3: Prescriptive  │
   │ Intelligence            │        │ Operational Risk        │        │ Recommendations         │
   ├─────────────────────────┤        ├─────────────────────────┤        ├─────────────────────────┤
   │ • root-cause-4step-     │        │ • analytics-predictive- │        │ • analytics-prescriptive│
   │   traversal             │        │   risk-modeling         │        │   -action-targeting     │
   │ • telemetry-ground-     │        │ • root-cause-4step-     │        │ • hierarchical-duration-│
   │   truth-protocol        │        │   traversal (Step 4)    │        │   engine                │
   │ • hierarchical-duration-│        │                         │        │                         │
   │   engine                │        │                         │        │                         │
   └─────────────────────────┘        └─────────────────────────┘        └─────────────────────────┘
```
