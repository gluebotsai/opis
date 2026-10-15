-- Shared conversation grain. Inlined by templates that need it.
-- One conversation even after many transfers. Names already on rpt.conversations.
-- Do not LEFT JOIN children here.
SELECT *
FROM rpt.conversations conversations
