-- Remove On Hold from ticket status catalog.
-- Existing On Hold tickets move to Pending.

SET search_path TO ticketing;

UPDATE ticketing.tickets
SET status = 'Pending', updated_at = NOW()
WHERE status = 'On Hold';

DELETE FROM ticketing.ticket_statuses
WHERE status = 'On Hold';
