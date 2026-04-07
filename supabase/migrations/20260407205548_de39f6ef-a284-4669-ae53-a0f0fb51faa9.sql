
ALTER TABLE public.knowledge_documents 
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.knowledge_chunks 
  ADD COLUMN IF NOT EXISTS document_name text;

CREATE OR REPLACE FUNCTION public.search_knowledge(
  _tenant_id uuid,
  _query_embedding vector,
  _match_count integer DEFAULT 5,
  _match_threshold double precision DEFAULT 0.7,
  _category text DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, document_id uuid, similarity double precision, document_name text, category text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    kc.id, kc.content, kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity,
    kc.document_name,
    kd.category
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.tenant_id = _tenant_id
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
    AND (_category IS NULL OR kd.category = _category)
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$$;
