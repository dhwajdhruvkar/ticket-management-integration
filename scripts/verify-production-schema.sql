-- Read-only Phase 11 production verification. Every condition raises on
-- failure; successful execution changes no application data or schema.
DO $phase11$
DECLARE
  missing_tables text;
  missing_primary_keys text;
BEGIN
  SELECT string_agg(expected.name, ', ' ORDER BY expected.name)
  INTO missing_tables
  FROM unnest(ARRAY[
    'Tenant', 'User', 'Department', 'AssignmentGroup', 'Ticket',
    'TicketMessage', 'TicketEvent', 'Resolution', 'Citation', 'KBArticle',
    'Problem', 'Change', 'Approval', 'Asset', 'ConfigurationItem',
    'CIRelationship', 'ServiceRequestCatalogItem', 'SlaPolicy',
    'BusinessCalendar', 'AutomationRule', 'Macro', 'CustomFieldDef',
    'Attachment', 'Notification', 'ApiKey', 'EmailMessage', 'AuditRecord'
  ]::text[]) AS expected(name)
  WHERE to_regclass(format('%I.%I', 'public', expected.name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Missing application tables: %', missing_tables;
  END IF;

  SELECT string_agg(expected.name, ', ' ORDER BY expected.name)
  INTO missing_primary_keys
  FROM unnest(ARRAY[
    'Tenant', 'User', 'Department', 'AssignmentGroup', 'Ticket',
    'TicketMessage', 'TicketEvent', 'Resolution', 'Citation', 'KBArticle',
    'Problem', 'Change', 'Approval', 'Asset', 'ConfigurationItem',
    'CIRelationship', 'ServiceRequestCatalogItem', 'SlaPolicy',
    'BusinessCalendar', 'AutomationRule', 'Macro', 'CustomFieldDef',
    'Attachment', 'Notification', 'ApiKey', 'EmailMessage', 'AuditRecord'
  ]::text[]) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid =
          to_regclass(format('%I.%I', 'public', expected.name))
      AND constraint_row.contype = 'p'
      AND constraint_row.convalidated
  );

  IF missing_primary_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Missing or invalid primary keys: %', missing_primary_keys;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Ticket'
      AND column_name = 'deletedAt'
      AND data_type = 'timestamp without time zone'
      AND datetime_precision = 3
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Ticket.deletedAt is missing or has the wrong definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_namespace namespace_row
      ON namespace_row.oid = index_class.relnamespace
    JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE namespace_row.nspname = 'public'
      AND index_class.relname = 'Ticket_tenantId_deletedAt_idx'
      AND index_row.indrelid = 'public."Ticket"'::regclass
      AND index_row.indisvalid
      AND index_row.indisready
      AND NOT index_row.indisunique
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY key_row.ordinality)
        FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY
          AS key_row(attnum, ordinality)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = index_row.indrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['tenantId', 'deletedAt']::name[]
  ) THEN
    RAISE EXCEPTION 'Ticket soft-delete index is missing or invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class table_class ON table_class.oid = index_row.indrelid
    JOIN pg_namespace namespace_row
      ON namespace_row.oid = table_class.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND (NOT index_row.indisvalid OR NOT index_row.indisready)
  ) THEN
    RAISE EXCEPTION 'At least one public index is invalid or not ready';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_namespace namespace_row
      ON namespace_row.oid = constraint_row.connamespace
    WHERE namespace_row.nspname = 'public'
      AND NOT constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'At least one public constraint is not validated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Ticket_tenantId_fkey'
      AND conrelid = 'public."Ticket"'::regclass
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'Ticket tenant foreign key is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "_prisma_migrations"
    WHERE migration_name = '20260821143000_ticket_soft_delete'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Soft-delete migration is not recorded as applied';
  END IF;
END
$phase11$;
