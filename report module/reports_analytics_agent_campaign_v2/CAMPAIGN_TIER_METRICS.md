# Campaign metrics (simple)

Paste into pgAdmin for this workspace:

```text
organization_id = 1012
branch_id       = 1004
```

Tables **without** `branch_id` (CDP, events, suppressions, caps, mailbox, …) filter **org 1012 only**. Campaigns and sends also use **branch 1004**.

Same meaning as [CAMPAIGN_DATABASE_METRICS.md](../campaign_docs/CAMPAIGN_DATABASE_METRICS.md). Not the pack’s certified templates.

## Shared rules

- **Time (Dashboard):** `campaign.campaigns.launch_local_date`, not `created_at`. Optional: `AND c.launch_local_date >= 'YYYY-MM-DD' AND c.launch_local_date < 'YYYY-MM-DD'`.
- **Ran:** `c.status IN ('live','completed','cancelled')`.
- **Drop PPC-only** on Dashboard headlines: campaign has a `campaign_channels.channel` that is not `ppc`.
- **Delivery outcome** (`r` = `campaign.campaign_send_recipients`):

```sql
CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END
```

- **Delivered** = CASE = `'sent'`. Join: `r` → `b` on `b.id = r.batch_id` → `c` on `c.id = r.campaign_id`.
- Rates: unique `opened_at` / `clicked_at` over delivered. Do not use `open_count` for unique open rate.

---

## Inventory (not Dashboard “ran”)

### `campaigns_total` — how many campaigns are there

**Definition:** Every saved campaign, including draft and scheduled.

**Calculation:** `COUNT(*)`. No status filter. No PPC drop.

**Tables / columns:** `campaign.campaigns.id`, `organization_id`, `branch_id`, `status`.

```sql
SELECT COUNT(*) AS campaigns_total
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

---

## Tier 1 — Dashboard

### T1.1 `campaigns_ran`

**Definition:** Campaigns that actually ran (not draft, not scheduled).

**Calculation:** Count ran rows. Exclude PPC-only.

**Tables / columns:** `campaigns.status`, `launch_local_date`, `organization_id`, `branch_id`; `campaign_channels.channel`.

```sql
SELECT COUNT(*) AS campaigns_ran
FROM campaign.campaigns c
WHERE c.organization_id = 1012
  AND c.branch_id = 1004
  AND c.status IN ('live','completed','cancelled')
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_channels ch
    WHERE ch.campaign_id = c.id AND ch.organization_id = 1012 AND ch.channel <> 'ppc'
  );
```

### T1.2 `campaigns_sent` — Sent headline

**Definition:** Count of **campaigns** with at least one delivered message (not message volume).

**Tables / columns:** `campaigns.id`; recipient delivery CASE; `campaign_send_batches.channel`.

```sql
SELECT COUNT(DISTINCT c.id) AS campaigns_sent
FROM campaign.campaigns c
WHERE c.organization_id = 1012
  AND c.branch_id = 1004
  AND c.status IN ('live','completed','cancelled')
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_channels ch
    WHERE ch.campaign_id = c.id AND ch.organization_id = 1012 AND ch.channel <> 'ppc'
  )
  AND EXISTS (
    SELECT 1
    FROM campaign.campaign_send_recipients r
    JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
    WHERE r.campaign_id = c.id
      AND r.organization_id = 1012
      AND CASE
        WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
        WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
        WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
        WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
          OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
        WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
        WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
        WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
        ELSE 'pending'
      END = 'sent'
  );
```

### T1.3 `campaigns_failed` — Failed headline

**Definition:** Campaigns with at least one failed/cancelled recipient. Bounce is not this card.

**Tables / columns:** `campaign_send_recipients.status`, `campaign_id`.

```sql
SELECT COUNT(DISTINCT c.id) AS campaigns_failed
FROM campaign.campaigns c
WHERE c.organization_id = 1012
  AND c.branch_id = 1004
  AND c.status IN ('live','completed','cancelled')
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = c.id
      AND r.organization_id = 1012
      AND lower(coalesce(r.status,'')) IN ('failed','cancelled')
  );
```

### T1.4 `email_open_rate`

**Definition:** Unique email opens ÷ email delivered. Do **not** use `open_count`.

**Tables / columns:** `campaign_send_batches.channel = 'email'`; `campaign_send_recipients.opened_at`.

```sql
SELECT
  CASE WHEN COUNT(*) FILTER (WHERE b.channel = 'email') = 0 THEN NULL
  ELSE LEAST(1.0,
    COUNT(*) FILTER (WHERE b.channel = 'email' AND r.opened_at IS NOT NULL)::numeric
    / COUNT(*) FILTER (WHERE b.channel = 'email')
  ) END AS email_open_rate
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

### T1.5 `click_rate`

**Definition:** Unique clicks ÷ delivered on email, push, web.

**Tables / columns:** `campaign_send_batches.channel`; `campaign_send_recipients.clicked_at`.

```sql
SELECT
  CASE WHEN COUNT(*) FILTER (WHERE b.channel IN ('email','push','web')) = 0 THEN NULL
  ELSE LEAST(1.0,
    COUNT(*) FILTER (WHERE b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL)::numeric
    / COUNT(*) FILTER (WHERE b.channel IN ('email','push','web'))
  ) END AS click_rate
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

### T1.6 `delivered_by_channel`

**Definition:** Delivered messages per batch channel.

**Tables / columns:** `campaign_send_batches.channel`.

```sql
SELECT b.channel, COUNT(*) AS messages_delivered
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent'
GROUP BY b.channel;
```

### T1.7 `delivery_trend`

**Definition:** Per launch day: delivered, unique email opens, unique email clicks.

**Tables / columns:** `campaigns.launch_local_date`; `opened_at`, `clicked_at`; `b.channel`.

```sql
SELECT c.launch_local_date AS day,
       COUNT(*) FILTER (
         WHERE CASE
           WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
           WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
           WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
           WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
             OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
           WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
           WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
           WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
           ELSE 'pending'
         END = 'sent'
       ) AS messages_delivered
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
GROUP BY c.launch_local_date
ORDER BY 1;
```

### T1.8 `monitor_preview`

**Definition:** Per campaign: targeted (`audience_count`), delivered, opened, clicked.

**Tables / columns:** `campaigns.name`, `audience_count`, `status`.

```sql
SELECT c.id, c.name, c.audience_count AS targeted
FROM campaign.campaigns c
WHERE c.organization_id = 1012
  AND c.branch_id = 1004
  AND c.status IN ('live','completed','cancelled')
ORDER BY c.launch_local_date DESC NULLS LAST
LIMIT 5;
```

---

## Tier 2 — Campaign, messages, events, PPC

### T2.1 `audience_selected`

**Definition:** Frozen planned people (`audience_count`).

**Tables / columns:** `campaigns.audience_count`; `campaign_audience.contact_id`.

```sql
SELECT COALESCE(SUM(audience_count), 0) AS audience_selected
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

### T2.2 `messages_sent`

**Definition:** Recipient rows with outcome sent (message volume).

```sql
SELECT COUNT(*) AS messages_sent
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

### T2.3 `messages_failed`

**Tables / columns:** `campaign_send_recipients.status`.

```sql
SELECT COUNT(*) AS messages_failed
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND lower(coalesce(r.status,'')) IN ('failed','cancelled');
```

### T2.4 `messages_bounced`

**Tables / columns:** `status`, `skip_fail_reason`.

```sql
SELECT COUNT(*) AS messages_bounced
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND (
    lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce')
    OR lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%'
  );
```

### T2.5 `messages_delivered`

**Definition:** Sent, not bounce, not stub.

```sql
SELECT COUNT(*) AS messages_delivered
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

### T2.6 `unique_opens` / `unique_clicks`

**Tables / columns:** `opened_at`, `clicked_at`; `campaign_send_batches.channel`.

```sql
SELECT COUNT(*) AS unique_opens
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel = 'email'
  AND r.opened_at IS NOT NULL
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

```sql
SELECT COUNT(*) AS unique_clicks
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel IN ('email','push','web')
  AND r.clicked_at IS NOT NULL
  AND CASE
    WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
    WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
    WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
    WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
      OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
    WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
    WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
    WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
    ELSE 'pending'
  END = 'sent';
```

### T2.7 `total_opens` / `total_clicks`

**Tables / columns:** `open_count`, `click_count`.

```sql
SELECT COALESCE(SUM(r.open_count), 0) AS total_opens
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004;
```

```sql
SELECT COALESCE(SUM(r.click_count), 0) AS total_clicks
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004;
```

### T2.8 `ctor`

**Definition:** Unique email clicks ÷ unique email opens.

```sql
SELECT
  CASE WHEN COUNT(*) FILTER (WHERE r.opened_at IS NOT NULL) = 0 THEN NULL
  ELSE COUNT(*) FILTER (WHERE r.clicked_at IS NOT NULL)::numeric
       / COUNT(*) FILTER (WHERE r.opened_at IS NOT NULL)
  END AS ctor
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel = 'email';
```

### T2.9 `ab_variant_performance`

**Tables / columns:** `ab_variant`, `opened_at`, `clicked_at`.

```sql
SELECT r.ab_variant, COUNT(*) AS n
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel = 'email'
GROUP BY r.ab_variant;
```

### T2.10 `audience_missed`

**Definition:** Frozen audience with no sent recipient.

**Tables / columns:** `campaign_audience.contact_id`; `campaign_send_recipients.contact_id`.

```sql
SELECT COUNT(*) AS audience_missed
FROM campaign.campaign_audience a
JOIN campaign.campaigns c ON c.id = a.campaign_id
WHERE c.organization_id = 1012
  AND c.branch_id = 1004
  AND NOT EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = a.campaign_id
      AND r.contact_id = a.contact_id
      AND r.organization_id = 1012
      AND lower(coalesce(r.status,'')) IN ('sent','delivered')
  );
```

### T2.11 `contact_delivery_rates`

**Tables / columns:** `campaign_send_recipients.contact_id`.

```sql
SELECT r.contact_id, COUNT(*) AS rows
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
GROUP BY r.contact_id;
```

### T2.12 `contact_campaigns_received`

```sql
SELECT r.contact_id, COUNT(DISTINCT r.campaign_id) AS contact_campaigns_received
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND lower(coalesce(r.status,'')) IN ('sent','delivered')
GROUP BY r.contact_id;
```

### T2.13 Events (org 1012 only; no branch on these tables)

**Tables / columns:** `campaign_opportunity_events.open_count`, `submission_count`, `public_id`; `campaign_form_submissions.event_public_id`.

```sql
SELECT COALESCE(SUM(open_count), 0) AS event_opens
FROM campaign.campaign_opportunity_events
WHERE organization_id = 1012;
```

```sql
SELECT COUNT(*) AS event_submissions
FROM campaign.campaign_form_submissions
WHERE organization_id = 1012;
```

```sql
SELECT
  CASE WHEN COALESCE(SUM(open_count), 0) = 0 THEN NULL
  ELSE SUM(submission_count)::numeric / SUM(open_count)
  END AS event_conversion
FROM campaign.campaign_opportunity_events
WHERE organization_id = 1012;
```

### T2.14 PPC

**Tables / columns:** `campaigns.launch_plan` JSON `channel_run`.

```sql
SELECT COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,impressions}','')::numeric), 0) AS ppc_impressions
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

```sql
SELECT COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric), 0) AS ppc_clicks
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

```sql
SELECT COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,spend}','')::numeric), 0) AS ppc_spend
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

```sql
SELECT COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,conversions}','')::numeric), 0) AS ppc_conversions
FROM campaign.campaigns
WHERE organization_id = 1012
  AND branch_id = 1004;
```

---

## Contact / CDP (org 1012; no branch on CDP)

Do not join CDP to send facts for these counts.

### C.1 `cdp_contact_count`

```sql
SELECT COUNT(*) AS cdp_contact_count
FROM cdp.customer_profile
WHERE organization_id = 1012
  AND coalesce(custom_fields->>'campaign_deleted','') <> 'true';
```

### C.2 `cdp_contacts_blocked`

```sql
SELECT COUNT(*) AS cdp_contacts_blocked
FROM cdp.customer_profile
WHERE organization_id = 1012
  AND blocked = true;
```

### C.3 `contact_unsubscribed`

```sql
SELECT COUNT(*) AS contact_unsubscribed
FROM campaign.campaign_contact_engagement
WHERE organization_id = 1012
  AND email_unsubscribed = true;
```

### C.4 / C.5 lifetime opens / clicks

```sql
SELECT COALESCE(SUM(email_open_count), 0) AS contact_lifetime_opens
FROM campaign.campaign_contact_engagement
WHERE organization_id = 1012;
```

```sql
SELECT COALESCE(SUM(email_click_count), 0) AS contact_lifetime_clicks
FROM campaign.campaign_contact_engagement
WHERE organization_id = 1012;
```

### C.6 `contacts_engaged`

```sql
SELECT COUNT(DISTINCT r.contact_id) AS contacts_engaged
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND (r.opened_at IS NOT NULL OR r.clicked_at IS NOT NULL);
```

### C.7 `contacts_never_opened`

```sql
SELECT COUNT(*) AS contacts_never_opened
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel = 'email'
  AND r.opened_at IS NULL
  AND lower(coalesce(r.status,'')) IN ('sent','delivered');
```

### C.8 `contact_push_reachability`

```sql
SELECT COUNT(*) AS contact_push_reachability
FROM campaign.push_endpoints
WHERE organization_id = 1012
  AND active = true;
```

### C.9 `identity_keys_count`

```sql
SELECT COUNT(*) AS identity_keys_count
FROM cdp.identity_keys
WHERE organization_id = 1012;
```

---

## Tier 3 — Ops

### T3.1 `stub_sends`

```sql
SELECT COUNT(*) AS stub_sends
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND (
    lower(coalesce(r.status,'')) IN ('stub','stub_sent')
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
  );
```

### T3.2 `bounce_rate`

```sql
SELECT
  COUNT(*) FILTER (
    WHERE lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce')
       OR lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%'
  )::numeric
  / NULLIF(COUNT(*), 0) AS bounce_rate
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND b.channel = 'email';
```

### T3.3a `suppressions`

```sql
SELECT COUNT(*) AS suppressions
FROM campaign.email_suppressions
WHERE organization_id = 1012;
```

### T3.3b `unsubscribes`

```sql
SELECT COUNT(*) AS unsubscribes
FROM campaign.campaign_contact_engagement
WHERE organization_id = 1012
  AND email_unsubscribed = true;
```

### T3.4 `email_cap_health`

```sql
SELECT hourly_cap, daily_cap, warmup_stage, health_status
FROM campaign.email_sending_caps
WHERE organization_id = 1012;
```

### T3.5 `domain_auth`

```sql
SELECT COUNT(*) AS domain_count,
       COUNT(*) FILTER (WHERE spf_ok AND dkim_ok AND dmarc_ok) AS fully_authenticated
FROM campaign.email_domains
WHERE organization_id = 1012;
```

### T3.6 `channel_readiness`

```sql
SELECT COUNT(*) AS channel_readiness
FROM campaign.channel_sending_profiles
WHERE organization_id = 1012;
```

### T3.7 `mailbox_send_ready`

```sql
SELECT COUNT(*) AS mailbox_rows,
       COUNT(*) FILTER (WHERE o.needs_reauth IS TRUE) AS needs_reauth
FROM accounts.setup_channel_configs c
JOIN accounts.setup_email_configs e ON e.channel_config_id = c.id
LEFT JOIN accounts.mail_oauth_connections o ON o.id = e.oauth_connection_id
WHERE c.organization_id = 1012;
```

### T3.8 `regulated_template_status`

```sql
SELECT COUNT(*) AS regulated_template_status
FROM campaign.regulated_channel_templates
WHERE organization_id = 1012;
```

### T3.9 website visitors / web push

```sql
SELECT COUNT(*) AS website_visitor_count
FROM campaign.website_contacts
WHERE organization_id = 1012;
```

```sql
SELECT COUNT(*) AS web_push_subscribers
FROM campaign.website_contacts
WHERE organization_id = 1012
  AND subscribed = true;
```

### T3.10 `push_endpoint_inventory`

```sql
SELECT COUNT(*) AS push_endpoint_inventory
FROM campaign.push_endpoints
WHERE organization_id = 1012;
```

### T3.11 gallery / library

```sql
SELECT COUNT(*) AS gallery_ops
FROM campaign.campaign_gallery_jobs
WHERE organization_id = 1012;
```

```sql
SELECT COALESCE(SUM(used_count), 0) AS library_ops
FROM campaign.campaign_library_templates
WHERE organization_id = 1012;
```

### T3.12 `daily_report_email_log`

```sql
SELECT COUNT(*) AS daily_report_email_log
FROM campaign.daily_report_email_deliveries
WHERE organization_id = 1012;
```

### T3.13 `notifications_unread`

```sql
SELECT COUNT(*) AS notifications_unread
FROM campaign.app_notifications
WHERE organization_id = 1012
  AND read_at IS NULL;
```

### T3.14 pending / live send

```sql
SELECT COUNT(*) AS pending_recipients
FROM campaign.campaign_send_recipients r
JOIN campaign.campaigns c ON c.id = r.campaign_id
WHERE r.organization_id = 1012
  AND c.branch_id = 1004
  AND lower(coalesce(r.status,'')) NOT IN ('sent','delivered','failed','cancelled','skipped','stub','stub_sent','bounced','hard_bounce','soft_bounce');
```

```sql
SELECT COUNT(*) AS live_send_pressure
FROM campaign.campaign_send_batches b
JOIN campaign.campaigns c ON c.id = b.campaign_id
WHERE b.organization_id = 1012
  AND c.branch_id = 1004
  AND b.status IN ('queued','sending');
```

### T3.15 `entitlement_health`

```sql
SELECT COUNT(*) AS entitlement_health
FROM campaign.organization_products
WHERE organization_id = 1012
  AND branch_id = 1004
  AND product_code = 'campaign';
```

---

## Related

| File | Use |
|------|-----|
| [CAMPAIGN_DATABASE_METRICS.md](../campaign_docs/CAMPAIGN_DATABASE_METRICS.md) | Column catalog |
| `product/sql/*.sql` | Certified pack templates |
