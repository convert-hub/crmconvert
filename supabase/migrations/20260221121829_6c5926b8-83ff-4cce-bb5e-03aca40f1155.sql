
-- Fix the contact with LID-based phone number by setting the real number from provider_chat_id
UPDATE public.contacts 
SET phone = '+553193995818'
WHERE id = 'f4a80838-12ae-400f-bd8b-d9911d221e15';

-- Reassign any conversations from the duplicate contact to the corrected one
UPDATE public.conversations
SET contact_id = 'f4a80838-12ae-400f-bd8b-d9911d221e15'
WHERE contact_id = 'fa99c442-a916-4a35-8380-7981dab77cb4';

-- Reassign any messages referencing the duplicate
UPDATE public.messages
SET tenant_id = tenant_id
WHERE conversation_id IN (
  SELECT id FROM public.conversations WHERE contact_id = 'fa99c442-a916-4a35-8380-7981dab77cb4'
);

-- Delete the duplicate contact
DELETE FROM public.contacts
WHERE id = 'fa99c442-a916-4a35-8380-7981dab77cb4';
