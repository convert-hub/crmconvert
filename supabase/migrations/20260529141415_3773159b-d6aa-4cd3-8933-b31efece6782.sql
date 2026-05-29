-- Bucket privado para mídia recebida do WhatsApp
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- Coluna para o caminho persistente
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS storage_path text;

CREATE INDEX IF NOT EXISTS idx_messages_storage_path
  ON public.messages (storage_path)
  WHERE storage_path IS NOT NULL;

-- Policies no storage.objects: path começa com {tenant_id}/...
DROP POLICY IF EXISTS "whatsapp-media tenant read" ON storage.objects;
CREATE POLICY "whatsapp-media tenant read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "whatsapp-media tenant insert" ON storage.objects;
CREATE POLICY "whatsapp-media tenant insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "whatsapp-media tenant update" ON storage.objects;
CREATE POLICY "whatsapp-media tenant update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
);