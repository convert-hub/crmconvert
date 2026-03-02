-- Move messages from duplicate conversation to the main one
UPDATE public.messages 
SET conversation_id = '7878f7bc-0307-47ae-bd2e-9a1937260e9b' 
WHERE conversation_id = 'd7e731cf-f407-4bb3-ad50-6baf26d69550';

-- Link the opportunity to the main conversation
UPDATE public.conversations 
SET opportunity_id = '375589e5-f4a2-449b-af89-28cea344623e'
WHERE id = '7878f7bc-0307-47ae-bd2e-9a1937260e9b';

-- Delete the duplicate conversation
DELETE FROM public.conversations 
WHERE id = 'd7e731cf-f407-4bb3-ad50-6baf26d69550';