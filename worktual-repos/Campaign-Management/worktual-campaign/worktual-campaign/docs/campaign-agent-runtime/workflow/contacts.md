# Contacts workflow

**Tools:** LOOKUP_CONTACT, GET_CONTACT, SEARCH_CONTACTS, SET_DRAFT_FIELDS, CREATE_CONTACT, UPDATE_CONTACT, REQUEST_DELETE / CONFIRM_DELETE, IMPORT_CONTACTS, company-pack tools, ROUTE_TO_MODULE.

## Collect

- Required: first_name, last_name, city, phone (+ country code). B2B also company_name. Email optional.
- Map free text into draft fields via SET_DRAFT_FIELDS every gather turn.
- Out-of-order answers accepted; ask only `missing_fields[0]` next.

## Clarify

- Ambiguous “create” / “new” with no object → ask contact vs other workspace.
- Stay on contacts for new-contact intent (SET_DRAFT_FIELDS mode=create), do not route away.

## Dynamic Context

`draft_contact`, `missing_fields`, focus contact id/panel, org B2B/B2C profile.
