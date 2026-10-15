-- Pin important contacts to the top of lists.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_is_pinned_updated
  ON public.contacts (is_pinned DESC, updated_at DESC)
  WHERE is_active = true;
