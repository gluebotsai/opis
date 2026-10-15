-- Shared Worktual From is not a campaign send identity.
-- Launch uses My Accounts mailbox only.

DELETE FROM "email_senders"
WHERE lower("from_email") LIKE '%@worktual.tech';

DELETE FROM "email_domains"
WHERE lower("domain") IN ('worktual.tech', 'www.worktual.tech');
