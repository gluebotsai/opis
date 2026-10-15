

select
    cast(id as text)                as outbound_email_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(ticket_number as text)     as ticket_number,
    cast(to_email as text)          as recipient_email,
    cast(to_email as text)          as to_email,
    cast(subject as text)           as email_subject,
    cast(subject as text)           as subject,
    cast(body_preview as text)      as body_preview,
    cast(error as text)             as error,
    cast(kind as text)              as email_kind,
    cast(kind as text)              as kind,
    cast(status as text)            as email_status,
    cast(status as text)            as status,
    created_at                      as sent_at,
    created_at,
    (lower(cast(status as text)) = 'sent') as is_sent
from "worktual_bigint"."ticketing"."outbound_email_log"