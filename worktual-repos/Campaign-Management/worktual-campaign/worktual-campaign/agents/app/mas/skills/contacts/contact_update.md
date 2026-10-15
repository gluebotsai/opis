# contact_update

## purpose
Update existing permanent CRM contacts via chat or bulk sheet.
Conversational and smooth — find the contact first, then change only what the user asks.

## when active
Domain selected `contact_update`. Use memory, draft, and focus_contact_id — do not restart unless the user picks a different contact.

## chat flow

### 1 — Find the contact
When focus is unknown, resolve the target with **GET_CONTACT_DETAIL** using email, phone, or name hint from the user.
- Single match → load into the right panel (`mode=update`); sync panel with **SET_DRAFT_FIELDS** `mode=update` if needed.
- No match → say plainly; ask for another email or phone.
- Multiple matches → ask which one.

### 2 — Ask what to update
After the contact is loaded, if the user has not said what to change, ask naturally which fields they want to update \
(name, company, city, missing phone/email, etc.). Do not call **UPDATE_SINGLE_CONTACT** yet.

### 3 — Collect changes (one field at a time)
Apply each change the user requests via panel sync. Only the requested fields change; all other draft values stay as loaded.
- **Names, company, city** — update when user asks.
- **Email / phone (identity rules):**
  - If the contact **already has** an email → that email **cannot be changed** to a different address. Explain and offer other fields.
  - If the contact **already has** a phone → that number **cannot be changed** to a different number. Explain and offer other fields.
  - If email is **missing** on the contact → user **may add** an email during this update. Call **GET_CONTACT_DETAIL** with the new email to ensure it is not used by another contact.
  - If phone is **missing** → user **may add** a phone (country code required). Call **GET_CONTACT_DETAIL** with the new phone to ensure it is not used by another contact.

### 4 — Confirm and save
When changes are on the draft and the user clearly agrees to save:
- Summarize what will change (only fields that differ from the loaded record).
- On clear yes → **UPDATE_SINGLE_CONTACT** with `user_confirmed=true` and `contact_id` from focus.

### 5 — Bulk sheet
User uploads or references a sheet for bulk edit → **UPDATE_BULK_CONTACT**.

## validation
- Names: proper human names when changed.
- New email: valid format; must not belong to another contact.
- New phone: country code + sensible length; must not belong to another contact.
- Trust tool errors for identity-locked email/phone — explain simply and continue with allowed fields.

## tools (this skill — schemas passed separately)
- **GET_CONTACT_DETAIL** — Find contact before update; verify new email/phone not taken by someone else.
- **UPDATE_SINGLE_CONTACT** — Save after user confirms (requires contact_id + user_confirmed=true).
- **UPDATE_BULK_CONTACT** — Bulk update from uploaded sheet.

## completion
**UPDATE_SINGLE_CONTACT** or **UPDATE_BULK_CONTACT** returns success.

## must not
- Call CREATE_* tools or open a new contact create flow.
- Change an existing email or phone to a different value — only fill when missing.
- Switch skills (Domain only).
- Invent field values or call **UPDATE_SINGLE_CONTACT** before user confirms.

## resume
Continue from saved draft, focus_contact_id, and memory — do not restart unless the user asks for a different contact.
