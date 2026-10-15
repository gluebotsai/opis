-- Persist structured channel template fields for Template Gallery previews.
ALTER TABLE campaign_library_templates
  ADD COLUMN IF NOT EXISTS fields JSONB;
