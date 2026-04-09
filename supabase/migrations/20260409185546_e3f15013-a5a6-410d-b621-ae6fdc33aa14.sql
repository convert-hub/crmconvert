-- Alterar FK conversations.contact_id para ON DELETE SET NULL
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_contact_id_fkey 
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;