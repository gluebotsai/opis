-- Drop static B2B seed catalog and pre-gallery generated variants.
-- Keeps current gallery rows: ideaKey:channel:(img|txt):01 with campaign idea metadata.

DELETE FROM "campaign_library_templates"
WHERE "source" = 'system';

DELETE FROM "campaign_library_templates"
WHERE "source" = 'generated'
  AND (
    "seed_slug" IS NULL
    OR "seed_slug" !~ '^[^:]+:(email|whatsapp|web_push|app_push):(img|txt):01$'
  );
