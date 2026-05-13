ALTER TABLE public.chatbot_flows ADD COLUMN IF NOT EXISTS whatsapp_instance_id uuid NULL;
ALTER TABLE public.message_sequences ADD COLUMN IF NOT EXISTS whatsapp_instance_id uuid NULL;
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS whatsapp_instance_id uuid NULL;