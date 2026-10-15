# Show all emails for a customer

Use the customer email on the ticket. Match it to `cdp.identity_keys`, take the `cdp_id`, then load every email conversation for that contact.

Booxoo is organization `1012`. That organization has email addresses on contacts, but no email conversations stored yet. The only stored email threads are in organization `1000`. The sample below is from there.

## 1. Find the contact

```sql
SELECT cdp_id
FROM cdp.identity_keys
WHERE organization_id = :organization_id
  AND key_type IN ('email', 'email_secondary')
  AND lower(key_value) = lower(:customer_email)
LIMIT 1;
```

`:organization_id` is the ticket's organization. For Booxoo that is `1012`.

## 2. Load the email conversations

```sql
SELECT
  id,
  subject,
  status,
  visitor_id,
  contact_id,
  created_at
FROM ccass.conversations
WHERE organization_id = :organization_id
  AND channel = 'email'
  AND contact_id = :cdp_id
ORDER BY created_at;
```

`contact_id` is the `cdp_id`. `visitor_id` is the address used on that one thread. A customer can have more than one conversation. Show closed ones too.

## 3. Load the messages

```sql
SELECT
  id,
  conversation_id,
  sender_type,
  direction,
  body,
  created_at
FROM ccass.conversation_messages
WHERE organization_id = :organization_id
  AND conversation_id = ANY(:conversation_ids)
  AND visibility = 'customer'
ORDER BY created_at;
```

Group messages under the conversation subject, oldest first.

- `sender_type = customer` is the customer's email.
- `sender_type = bot` is the email bot reply.
- `sender_type = agent` is a live agent reply.

Do not read `ccass.email_delivery_outbox` for the thread. That table is only the send queue.

## Matched record

This is a real row. The identity key and the conversation point at the same contact.

| Field | Value |
| --- | --- |
| organization_id | 1000 |
| identity key_type | email |
| identity key_value | email@mail.salesforce.com |
| cdp_id | CDP-email-org1000-email@mail.salesforce.com |
| conversation_id | 120953 |
| subject | How about we close deals faster with Starter Suite? |
| status | resolved |
| visitor_id | email@mail.salesforce.com |
| contact_id | CDP-email-org1000-email@mail.salesforce.com |

Messages on that conversation:

| message_id | sender_type | direction | created_at | body |
| --- | --- | --- | --- | --- |
| 10006 | customer | inbound | 2026-09-23T04:06:38.350Z | See how your deals are progressing, manage prospects, and keep tasks tidy – it's easier than you think. |
| 10029 | agent | outbound | 2026-09-23T07:50:20.053Z | Thank you for sharing the details about Starter Suite. How can I help you with this product today? |
