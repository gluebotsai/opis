# WhatsApp approved / rejected workflows

## Approved

Send Meta-approved template as-is. Resolve audience via FILTER_CONTACTS / SET_AUDIENCE before SEND_APPROVED_TEMPLATE. Never claim sent unless tool `ok=true`.

## Rejected

Fix copy via SET_TEMPLATE_FIELDS; unique name for resubmit; SUBMIT_FOR_APPROVAL only on explicit yes.
