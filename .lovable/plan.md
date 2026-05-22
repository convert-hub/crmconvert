## Causa do erro

O usuário logado é **SaaS Admin** e está impersonando o tenant **SOS Tecnologia**. As edge functions `wa-meta-send` e `wa-meta-templates-sync` não conhecem esse contexto: elas pegam a **primeira** `tenant_membership` ativa do usuário (no caso, "paipe teste") e comparam com o `tenant_id` da instância Meta.

Como a instância da SOS pertence a outro tenant, a verificação `instance.tenant_id !== membership.tenant_id` retorna **403 Forbidden**, que no frontend aparece como o famoso "Edge Function returned a non-2XX status code" (o "erro na add function 2XX" que você descreveu). Isso explica os três sintomas: Testar, Sincronizar templates e Enviar template.

## Correção

Adicionar bypass de **SaaS admin** nas duas edge functions, espelhando o padrão `is_saas_admin()` já usado no resto do sistema.

### `supabase/functions/wa-meta-send/index.ts`

Depois de resolver `userId` via `getClaims`, antes de buscar a membership:

1. Consultar `saas_admins` (via `supabaseAdmin`) para o `user_id`.
2. Se for SaaS admin: pular a verificação de membership e derivar `membership = { id: null, tenant_id: instance.tenant_id }` **após** carregar a instância (mesma técnica já usada no caminho `isInternalCall`).
3. Caso contrário, manter a lógica atual (busca membership + checa `instance.tenant_id !== membership.tenant_id`).

Pontos a ajustar dentro do arquivo:
- Variável `membership` precisa permitir `id: null` (já permite).
- Onde `membership!.id` é usado para persistir mensagens (`sender_membership_id`), passar `null` quando for SaaS admin — a coluna já aceita null no caminho interno.

### `supabase/functions/wa-meta-templates-sync/index.ts`

Mesma alteração: aceitar SaaS admin. Hoje o código faz:

```ts
const { data: membership } = await supabaseAdmin
  .from("tenant_memberships")
  .select("tenant_id, role")
  .eq("user_id", userId)
  .eq("is_active", true)
  .limit(1)
  .single();
if (!membership) return 403;
...
if (instance.tenant_id !== membership.tenant_id) return 403;
```

Trocar por:
1. Checar `saas_admins` para `userId`.
2. Se for admin → pular checagem de membership e usar `instance.tenant_id` como tenant efetivo.
3. Caso contrário, lógica atual.

## Fora de escopo

- Não mudar frontend.
- Não alterar a forma como o `AuthContext` envia a sessão (já vai com o JWT correto).
- Não tocar em `uazapi-proxy` (problema é só nas funções Meta).

## Validação após implementar

1. Logado como SaaS admin impersonando SOS Tecnologia:
   - Clicar **Testar** na conexão Meta → deve mostrar `Conectado: <número>`.
   - Clicar **Sincronizar templates** → deve retornar contagem.
   - Enviar template via `SendTemplateDialog` → deve enviar sem erro 2xx.
2. Logado como admin normal de outro tenant tentando acessar instância alheia: ainda deve receber 403 (regressão controlada).