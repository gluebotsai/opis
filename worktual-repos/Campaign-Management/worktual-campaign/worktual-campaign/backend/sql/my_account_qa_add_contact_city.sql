-- Run against my_account_qa (account DB). Campaign MS must not issue DDL at request time.
-- Extra audience fields belong on public.contacts only.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.contacts.city IS
  'Optional city for campaign audience filters; owned by account contacts table.';
