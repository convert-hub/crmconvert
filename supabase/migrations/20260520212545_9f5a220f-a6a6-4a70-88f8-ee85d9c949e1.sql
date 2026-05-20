
-- Migrate existing automations.conditions to new shape: { trigger: {...legacy fields}, filters: [] }
-- Idempotent: only rewrites rows that don't yet have the 'filters' key.
UPDATE public.automations
SET conditions = jsonb_build_object(
  'trigger', COALESCE(conditions, '{}'::jsonb) - 'filters',
  'filters', COALESCE(conditions->'filters', '[]'::jsonb)
)
WHERE conditions IS NULL
   OR NOT (conditions ? 'filters')
   OR NOT (conditions ? 'trigger');
