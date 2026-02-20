-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';