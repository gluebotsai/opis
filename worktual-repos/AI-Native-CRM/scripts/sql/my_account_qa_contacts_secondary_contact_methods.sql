-- Secondary emails / phones on contacts (multi-value; primary email/phone stay scalar).

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS secondary_emails text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS secondary_phones text[] NOT NULL DEFAULT '{}';
