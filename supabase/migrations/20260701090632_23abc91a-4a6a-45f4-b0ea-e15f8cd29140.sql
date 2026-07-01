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

  SELECT id, tenant_id, source, ctwa_clid, utm_source, utm_medium, utm_campaign, ad_id, custom_fields
    INTO c
  FROM public.contacts
  WHERE id = NEW.contact_id
    AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Inherit scalar attribution fields only when NEW is null (first-touch semantics on the opportunity).
  NEW.ctwa_clid   := COALESCE(NEW.ctwa_clid,   c.ctwa_clid);
  NEW.utm_source  := COALESCE(NEW.utm_source,  c.utm_source);
  NEW.utm_medium  := COALESCE(NEW.utm_medium,  c.utm_medium);
  NEW.utm_campaign:= COALESCE(NEW.utm_campaign,c.utm_campaign);
  NEW.ad_id       := COALESCE(NEW.ad_id,       c.ad_id);

  -- Only propagate source='ctwa' if the contact is genuinely CTWA.
  IF NEW.source IS NULL AND c.source = 'ctwa' THEN
    NEW.source := 'ctwa';
  END IF;

  -- Merge custom_fields.ctwa without losing any existing key.
  contact_ctwa := COALESCE((c.custom_fields->'ctwa'), NULL);
  IF contact_ctwa IS NOT NULL THEN
    existing_cf   := COALESCE(NEW.custom_fields, '{}'::jsonb);
    existing_ctwa := COALESCE(existing_cf->'ctwa', '{}'::jsonb);
    -- existing opportunity ctwa keys win over inherited ones.
    merged_ctwa := contact_ctwa || existing_ctwa;
    NEW.custom_fields := jsonb_set(existing_cf, '{ctwa}', merged_ctwa, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_inherit_ctwa_trg ON public.opportunities;
CREATE TRIGGER opportunities_inherit_ctwa_trg
BEFORE INSERT ON public.opportunities
FOR EACH ROW
EXECUTE FUNCTION public.opportunities_inherit_ctwa();