

## Diagnosis

### Issue 1: Tenant resets on F5
The `impersonatedTenantId` is stored only in React state (`useState`). On page refresh, it resets to `null`, and `loadUserData` fetches the first active membership (Paipe), ignoring the previously impersonated tenant.

**Fix**: Persist `impersonatedTenantId` in `sessionStorage`. On init, read it back and restore the impersonated tenant.

### Issue 2: Cannot create pipeline stages in impersonated tenant
When impersonating "Esther Bertoldo", the SaaS admin has no real `tenant_membership` row for that tenant. The RLS policies on `stages` and `pipelines` use `is_admin_or_manager()` / `has_tenant_role()` which check `tenant_memberships`. There is no `is_saas_admin()` fallback policy on these tables.

**Fix**: Add `is_saas_admin()` RLS policies (ALL) on `pipelines` and `stages` tables.

---

## Plan

### 1. Persist impersonated tenant in sessionStorage
**File**: `src/contexts/AuthContext.tsx`
- Initialize `impersonatedTenantId` from `sessionStorage.getItem('impersonatedTenantId')`
- In `switchTenant()`, write/remove the value to `sessionStorage`
- In `loadUserData()`, after loading the user's own membership, check if there's a stored impersonated tenant ID and restore it (load that tenant instead)
- On `signOut`, clear `sessionStorage`

### 2. Add SaaS admin RLS policies
**Migration SQL**:
```sql
CREATE POLICY "SaaS admin manages pipelines"
ON public.pipelines FOR ALL
USING (is_saas_admin())
WITH CHECK (is_saas_admin());

CREATE POLICY "SaaS admin manages stages"
ON public.stages FOR ALL
USING (is_saas_admin())
WITH CHECK (is_saas_admin());
```

This will allow SaaS admins to create, update, and delete pipelines and stages in any tenant while impersonating.

