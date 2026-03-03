
-- Fix FK constraints for safe deletion of conversations
ALTER TABLE public.activities DROP CONSTRAINT activities_conversation_id_fkey;
ALTER TABLE public.activities ADD CONSTRAINT activities_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_messages DROP CONSTRAINT scheduled_messages_conversation_id_fkey;
ALTER TABLE public.scheduled_messages ADD CONSTRAINT scheduled_messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.flow_executions DROP CONSTRAINT flow_executions_conversation_id_fkey;
ALTER TABLE public.flow_executions ADD CONSTRAINT flow_executions_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

-- Fix FK constraints for safe deletion of contacts
ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;

ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_contact_id_fkey;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.activities DROP CONSTRAINT activities_contact_id_fkey;
ALTER TABLE public.activities ADD CONSTRAINT activities_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.flow_executions DROP CONSTRAINT flow_executions_contact_id_fkey;
ALTER TABLE public.flow_executions ADD CONSTRAINT flow_executions_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
