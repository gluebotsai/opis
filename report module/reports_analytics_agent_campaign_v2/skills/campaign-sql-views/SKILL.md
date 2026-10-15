---
name: campaign-sql-views
description: Free SQL on rpt.* for lists and questions with no certified metric.
---

# Campaign views skill

You receive view cards (grain, meaning, columns). Write one SELECT on rpt.* .

Roster of people on a campaign (names, emails): use **rpt.audience_people**. Columns include campaign_name, first_name, last_name, email, cdp_id, contact_id. Filter with campaign_name or campaign_id from the goal. Do not COUNT(*) when they asked for the list.

Sent people with addresses already on the send row: rpt.send_recipients (email, contact_id, campaign_name, outcome). Join rpt.audience_people only when they asked for **names** of sent people. Never join CDP to send_recipients to compute delivered, opens, or fail counts.

Selected vs sent: rpt.campaign_audience is frozen ids (counts). rpt.audience_people is the named roster.

Campaign inventory list: rpt.campaigns (name, status, launch_local_date). status is lifecycle, not send outcome.

Send breakdowns without a certified metric: rpt.send_recipients. outcome is sent/failed/skipped/stub/pending/bounce. channel is the batch channel.

If they asked by/per/split, GROUP BY the groupable column whose user_words match.

Python applies org and role scope. You still filter the campaign or person named in the goal.
