CREATE OR REPLACE FUNCTION public.opportunities_inherit_ctwa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  contact_ctwa JSONB;
  existing_cf JSONB;
  existing_ctwa JSONB;
  merged_ctwa JSONB;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, tenant_id, source, ctwa_clid, utm_source, utm_medium, utm_campaign, custom_fields
    INTO c
  FROM public.contacts
  WHERE id = NEW.contact_id
    AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.ctwa_clid    := COALESCE(NEW.ctwa_clid,    c.ctwa_clid);
  NEW.utm_source   := COALESCE(NEW.utm_source,   c.utm_source);
  NEW.utm_medium   := COALESCE(NEW.utm_medium,   c.utm_medium);
  NEW.utm_campaign := COALESCE(NEW.utm_campaign, c.utm_campaign);

  IF NEW.source IS NULL AND c.source = 'ctwa' THEN
    NEW.source := 'ctwa';
  END IF;

  contact_ctwa := COALESCE((c.custom_fields->'ctwa'), NULL);
  IF contact_ctwa IS NOT NULL THEN
    existing_cf   := COALESCE(NEW.custom_fields, '{}'::jsonb);
    existing_ctwa := COALESCE(existing_cf->'ctwa', '{}'::jsonb);
    merged_ctwa := contact_ctwa || existing_ctwa;
    NEW.custom_fields := jsonb_set(existing_cf, '{ctwa}', merged_ctwa, true);
  END IF;

  RETURN NEW;
END;
$$;