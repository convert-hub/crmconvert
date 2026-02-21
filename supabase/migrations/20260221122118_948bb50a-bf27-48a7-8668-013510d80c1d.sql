
-- Delete in correct order respecting foreign keys
DELETE FROM public.messages WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.conversation_reviews WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.conversations WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.activities WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.stage_moves WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.opportunities WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
DELETE FROM public.contacts WHERE tenant_id = '818c8136-ec24-4a87-b79e-5d822077dc23';
