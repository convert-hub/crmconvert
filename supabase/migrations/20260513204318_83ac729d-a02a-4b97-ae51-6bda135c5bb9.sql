UPDATE public.conversations c
SET whatsapp_instance_id = wi.id
FROM public.whatsapp_instances wi
WHERE c.whatsapp_instance_id IS NULL
  AND c.channel = 'whatsapp'
  AND wi.tenant_id = c.tenant_id
  AND wi.provider = 'uazapi'
  AND wi.is_active = true
  AND (
    SELECT count(*) FROM public.whatsapp_instances wi2
    WHERE wi2.tenant_id = c.tenant_id AND wi2.provider = 'uazapi' AND wi2.is_active = true
  ) = 1;