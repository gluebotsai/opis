# Forms workflow

**Tools:** RUN_FIELDS_SPECIALIST, RUN_THEME_SPECIALIST, RUN_DESIGN_SPECIALIST, ROUTE_TO_CREATE_CAMPAIGN, ROUTE_TO_MODULE.

## Collect / map

- Pass exact user wording in `instruction` to specialists.
- Layout words (top/bottom) mean order, not field values.
- Campaign/save/launch language → route tools, never new field labels.

## Clarify

- Soft campaign handoff: summarize form, ask yes/no (`user_confirmed=false`), then on yes `user_confirmed=true`.
- If `field_count` is 0, design first — do not route to create-campaign.

## Dynamic Context

Form title, fields, theme, `field_count`, `published`, `public_url`, `pending_campaign_handoff`.
