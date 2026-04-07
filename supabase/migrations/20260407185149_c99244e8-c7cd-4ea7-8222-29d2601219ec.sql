
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge documents table
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  chunk_count INTEGER DEFAULT 0,
  error TEXT,
  created_by UUID REFERENCES public.tenant_memberships(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_documents' AND policyname = 'Members view knowledge docs') THEN
    CREATE POLICY "Members view knowledge docs" ON public.knowledge_documents FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_documents' AND policyname = 'Admin/Manager manages knowledge docs') THEN
    CREATE POLICY "Admin/Manager manages knowledge docs" ON public.knowledge_documents FOR ALL TO authenticated USING (is_admin_or_manager(tenant_id)) WITH CHECK (is_admin_or_manager(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_documents' AND policyname = 'SaaS admin manages knowledge docs') THEN
    CREATE POLICY "SaaS admin manages knowledge docs" ON public.knowledge_documents FOR ALL TO public USING (is_saas_admin()) WITH CHECK (is_saas_admin());
  END IF;
END $$;

-- Knowledge chunks table
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  chunk_index INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_chunks' AND policyname = 'Members view knowledge chunks') THEN
    CREATE POLICY "Members view knowledge chunks" ON public.knowledge_chunks FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_chunks' AND policyname = 'Admin/Manager manages knowledge chunks') THEN
    CREATE POLICY "Admin/Manager manages knowledge chunks" ON public.knowledge_chunks FOR ALL TO authenticated USING (is_admin_or_manager(tenant_id)) WITH CHECK (is_admin_or_manager(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_chunks' AND policyname = 'SaaS admin manages knowledge chunks') THEN
    CREATE POLICY "SaaS admin manages knowledge chunks" ON public.knowledge_chunks FOR ALL TO public USING (is_saas_admin()) WITH CHECK (is_saas_admin());
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx ON public.knowledge_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_document_idx ON public.knowledge_chunks (document_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_tenant_idx ON public.knowledge_documents (tenant_id);

-- Similarity search function
CREATE OR REPLACE FUNCTION public.search_knowledge(
  _tenant_id UUID,
  _query_embedding vector(1536),
  _match_count INTEGER DEFAULT 5,
  _match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  document_id UUID,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    kc.id,
    kc.content,
    kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.tenant_id = _tenant_id
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$$;
