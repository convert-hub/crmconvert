-- Tabela N:N: relacionamento entre prompts e documentos
CREATE TABLE IF NOT EXISTS public.prompt_template_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_template_id UUID NOT NULL REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(prompt_template_id, document_id)
);

-- RLS
ALTER TABLE public.prompt_template_documents ENABLE ROW LEVEL SECURITY;

-- Policy: acesso via tenant do prompt_template
CREATE POLICY "Users can manage prompt_template_documents for their tenant"
  ON public.prompt_template_documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.prompt_templates pt
      JOIN public.tenant_memberships tm ON tm.tenant_id = pt.tenant_id
      WHERE pt.id = prompt_template_documents.prompt_template_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prompt_templates pt
      JOIN public.tenant_memberships tm ON tm.tenant_id = pt.tenant_id
      WHERE pt.id = prompt_template_documents.prompt_template_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = true
    )
  );

-- Índices
CREATE INDEX idx_ptd_prompt_template_id ON public.prompt_template_documents(prompt_template_id);
CREATE INDEX idx_ptd_document_id ON public.prompt_template_documents(document_id);

-- Novo overload de search_knowledge com _document_ids
CREATE OR REPLACE FUNCTION public.search_knowledge(
  _tenant_id uuid,
  _query_embedding vector,
  _match_count integer DEFAULT 5,
  _match_threshold double precision DEFAULT 0.7,
  _category text DEFAULT NULL,
  _document_ids uuid[] DEFAULT NULL
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
    AND (_document_ids IS NULL OR kc.document_id = ANY(_document_ids))
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$$;