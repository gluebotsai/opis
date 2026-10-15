-- Canonical CDP contact id (TEXT) on operational tables.
-- Values are legacy numeric strings ("86") or CDP ids ("CDP-webchat-org1003-visitor_...").

DO $$
DECLARE
  rec record;
  item jsonb;
  view_def text;
  view_backup jsonb := '[]'::jsonb;
BEGIN
  FOR rec IN
    SELECT DISTINCT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    JOIN pg_class ref ON ref.oid = a.attrelid
    JOIN pg_namespace refn ON refn.oid = ref.relnamespace
    WHERE refn.nspname = 'ccass'
      AND ref.relname IN (
        'conversations',
        'agent_missed_contacts',
        'agent_tasks',
        'proactive_callback_attempts'
      )
      AND a.attname = 'contact_id'
      AND c.relkind IN ('v', 'm')
  LOOP
    SELECT pg_get_viewdef(rec.qualified_name::regclass, true) INTO view_def;
    view_backup := view_backup || jsonb_build_array(
      jsonb_build_object('qualified_name', rec.qualified_name, 'definition', view_def)
    );
    EXECUTE format('DROP VIEW IF EXISTS %s CASCADE', rec.qualified_name);
  END LOOP;

  EXECUTE 'ALTER TABLE ccass.conversations ADD COLUMN IF NOT EXISTS cdp_contact_id TEXT';

  EXECUTE $sql$
    ALTER TABLE ccass.conversations
      ALTER COLUMN contact_id TYPE TEXT
      USING COALESCE(
        NULLIF(TRIM(cdp_contact_id), ''),
        CASE WHEN contact_id IS NOT NULL THEN contact_id::text END
      )
  $sql$;

  EXECUTE 'DROP INDEX IF EXISTS idx_conversations_org_cdp_contact';
  EXECUTE 'ALTER TABLE ccass.conversations DROP COLUMN IF EXISTS cdp_contact_id';

  EXECUTE $sql$
    ALTER TABLE ccass.agent_missed_contacts
      ALTER COLUMN contact_id TYPE TEXT
      USING CASE WHEN contact_id IS NOT NULL THEN contact_id::text END
  $sql$;

  EXECUTE $sql$
    ALTER TABLE ccass.agent_tasks
      ALTER COLUMN contact_id TYPE TEXT
      USING CASE WHEN contact_id IS NOT NULL THEN contact_id::text END
  $sql$;

  EXECUTE $sql$
    ALTER TABLE ccass.proactive_callback_attempts
      ALTER COLUMN contact_id TYPE TEXT
      USING CASE WHEN contact_id IS NOT NULL THEN contact_id::text END
  $sql$;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cdp'
      AND table_name = 'interactions'
      AND column_name = 'contact_id'
      AND udt_name <> 'text'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE cdp.interactions
        ALTER COLUMN contact_id TYPE TEXT
        USING CASE WHEN contact_id IS NOT NULL THEN contact_id::text END
    $sql$;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(view_backup) LOOP
    EXECUTE format(
      'CREATE VIEW %s AS %s',
      item->>'qualified_name',
      item->>'definition'
    );
  END LOOP;
END $$;
