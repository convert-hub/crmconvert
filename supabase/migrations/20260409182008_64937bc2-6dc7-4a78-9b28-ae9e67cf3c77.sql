ALTER TABLE public.prompt_templates
  ADD COLUMN IF NOT EXISTS knowledge_category text DEFAULT NULL;

COMMENT ON COLUMN public.prompt_templates.knowledge_category IS 'Categoria de documentos da base de conhecimento que este prompt deve consultar. NULL = busca em todos os documentos.';