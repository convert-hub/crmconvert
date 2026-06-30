## Causa-raiz (confirmada)

- RLS de SELECT em `whatsapp_instances` = `is_saas_admin() OR is_admin_or_manager(tenant_id)` → attendant recebe `null`.
- `getConversationProvider` (src/lib/whatsappRouter.ts) lê `conversations` (ok) + `whatsapp_instances` (bloqueado p/ attendant) → `provider` cai no default `'uazapi'` → roteia p/ `uazapi-proxy` → 404 em tenant `meta_cloud`.

## Plano

### 1. Migration — função SECURITY DEFINER

Criar `public.get_conversation_provider(p_conversation_id uuid)`:

- Lê `conversations.tenant_id` e `conversations.whatsapp_instance_id` da conversa.
- Autorização: `is_saas_admin() OR is_member_of_tenant(c.tenant_id)` — preserva o acesso do SaaS admin (inclusive impersonando tenants onde ele não é membro) e estende para qualquer role do tenant (admin, manager, attendant, readonly). Sem permissão → 0 linhas.
- JOIN com `whatsapp_instances` filtrando por `id = c.whatsapp_instance_id` **e** `tenant_id = c.tenant_id` (defesa em profundidade contra cross-tenant).
- `RETURNS TABLE(instance_id uuid, provider text)` — **somente** essas duas colunas. Nada de `meta_access_token_encrypted`, `api_url`, `meta_phone_number_id`, etc.
- `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.
- `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`.
- Conversa sem instância vinculada → 0 linhas (caller mantém fallback `'uazapi'` retrocompat).

### 2. `src/lib/whatsappRouter.ts`

- Trocar os dois `supabase.from(...).select(...)` por uma única chamada:
  ```ts
  const { data, error } = await supabase.rpc('get_conversation_provider', { p_conversation_id: conversationId });
  ```
- Preservar `WhatsAppProvider`, `ProviderInfo`, e o `providerCache`.
- Mapeamento:
  - Linha com `provider='meta_cloud'` → `{ instance_id, provider: 'meta_cloud' }`.
  - Linha com `provider='uazapi'` → `{ instance_id, provider: 'uazapi' }`.
  - Sem linhas (sem instância OU sem permissão) → `{ instance_id: null, provider: 'uazapi' }` (igual ao default atual).
  - Erro de RPC → retorna default e **não** grava no cache (permite retry transitório).
- `sendText`, `sendMedia`, `downloadMedia`, `clearProviderCache` intocados.

### 3. Não tocar

- RLS de `whatsapp_instances` (segue `is_saas_admin() OR is_admin_or_manager`) — token Meta protegido.
- `wa-meta-send`, `uazapi-proxy`, AudioRecorder, ChatPanel.
- Comportamento de admin/manager (mesmo path, mesmo resultado).

## Riscos

1. **Vazamento de coluna sensível** — função retorna estritamente `(instance_id, provider)`; review da migration confirma colunas.
2. **Cross-tenant via conversation_id forjado** — `is_saas_admin() OR is_member_of_tenant(c.tenant_id)` dentro da função + filtro `whatsapp_instances.tenant_id = c.tenant_id`.
3. **Regressão para SaaS admin impersonando tenant onde não é membro** — coberto pelo ramo `is_saas_admin()` na autorização.
4. **Cache envenenado em erro transitório** — em erro, retorna default e **não** cacheia; próxima chamada retenta.
5. **Conversas legadas sem `whatsapp_instance_id`** — 0 linhas → default `'uazapi'`, idêntico ao comportamento atual.
6. **`search_path`** — `SET search_path = public` para evitar shadowing.

## Arquivos

- Nova migration (função + grants).
- `src/lib/whatsappRouter.ts` (apenas `getConversationProvider`).
