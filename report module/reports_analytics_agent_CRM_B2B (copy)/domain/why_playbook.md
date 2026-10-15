# B2B CRM Analytical "Why" Diagnostic Playbook

When answering root-cause and diagnostic questions ("Why did pipeline drop?", "Why was deal X lost?", "Why is win rate low?"):

1. **Measure Baseline & Delta**:
   - Compare current period against prior period using flow metrics (`won_revenue`, `lost_revenue`, `new_pipeline_month`).
   - For snapshot pipeline changes, compute the Flow Bridge:
     $$\Delta \text{Pipeline} = \text{New Created Deals} - \text{Closed Won} - \text{Closed Lost}$$

2. **Decompose by Core Dimensions**:
   - Segment by Sales Rep Owner (`pipeline_by_owner`)
   - Segment by Stage (`pipeline_by_stage`)
   - Segment by Industry & Company Tier
   - Segment by Currency (never blend currencies)

3. **Rate vs Volume Analysis**:
   - Determine if revenue change was driven by deal count volume or deal conversion rate (`win_rate`).

4. **Pipeline Stagnation & Slippage**:
   - Identify deals past `expected_close_date`.
   - Identify deals with `days_since_last_touch >= 14` (stale deals).

5. **Loss Reasons & Competitive Signals**:
   - Review `lost_reasons` distribution (price, competitor, timing, product gap).
   - Trace activity logs and demo notes for named lost deals.

6. **Synthesize Findings**:
   - State what happened (the verified figures).
   - State the primary driver (volume vs conversion vs specific losses).
   - Provide concrete next-step recommendations based on data.
