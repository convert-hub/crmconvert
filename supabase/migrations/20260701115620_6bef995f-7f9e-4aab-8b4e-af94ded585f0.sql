
-- 1. stages.ai_criteria
ALTER TABLE public.stages ADD COLUMN IF NOT EXISTS ai_criteria text NULL;

-- 2. stage_moves: status + resolved_by/at
ALTER TABLE public.stage_moves
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS resolved_by uuid NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stage_moves_status_check'
  ) THEN
    ALTER TABLE public.stage_moves
      ADD CONSTRAINT stage_moves_status_check
      CHECK (status IN ('suggested','applied','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stage_moves_suggested
  ON public.stage_moves(tenant_id, created_at DESC)
  WHERE status = 'suggested';

-- 3. job_queue.idempotency_key UNIQUE (drop non-unique first, then unique)
DROP INDEX IF EXISTS public.idx_jobs_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency
  ON public.job_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. RLS: allow tenant admin/manager/attendant to UPDATE stage_moves (Aprovar/Ignorar/Desfazer)
DROP POLICY IF EXISTS "stage_moves_update_active_members" ON public.stage_moves;
CREATE POLICY "stage_moves_update_active_members"
  ON public.stage_moves
  FOR UPDATE
  TO authenticated
  USING (
    public.is_saas_admin() OR (
      public.is_member_of_tenant(tenant_id)
      AND public.get_user_role_in_tenant(tenant_id) IN ('admin','manager','attendant')
    )
  )
  WITH CHECK (
    public.is_saas_admin() OR (
      public.is_member_of_tenant(tenant_id)
      AND public.get_user_role_in_tenant(tenant_id) IN ('admin','manager','attendant')
    )
  );
