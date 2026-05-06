INSERT INTO public.saas_admins (user_id)
VALUES ('412e8c50-20d3-4af8-9517-94696af75f74')
ON CONFLICT (user_id) DO NOTHING;