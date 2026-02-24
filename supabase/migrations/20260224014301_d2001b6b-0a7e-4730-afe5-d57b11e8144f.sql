-- Rename inactivity_hours to inactivity_minutes and convert existing values
ALTER TABLE public.stages ADD COLUMN inactivity_minutes integer DEFAULT NULL;

-- Migrate existing data: convert hours to minutes
UPDATE public.stages SET inactivity_minutes = inactivity_hours * 60 WHERE inactivity_hours IS NOT NULL AND inactivity_hours > 0;

-- Drop old column
ALTER TABLE public.stages DROP COLUMN inactivity_hours;