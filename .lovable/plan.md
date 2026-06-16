# Diagnóstico forense

**Mensagem afetada:** `b678739e-67e6-4589-8d54-d49484dbedbc` (conversa `9a9bdf01...`, contato Regiane, tenant Instituto Bignoto, instância UAZAPI ativa `tenant_fdeec040` conectada em `converthub.uazapi.com`).

**O que a UI mostra:** "Falha no envio pela Meta."

**O que está salvo em `provider_metadata`:**
```json
{ "status": "failed", "error_message": "Edge Function returned a non-2xx status code" }
```

Essa string é o `error.message` genérico do `supabase.functions.invoke` — significa que `uazapi-proxy` respondeu com status HTTP 4xx/5xx, e o SDK não expôs o corpo JSON, então o roteador caiu no fallback `error?.message`.

## Por que o uazapi-proxy retorna 4xx para a Clara

A usuária Clara (`mktbignoto@gmail.com`, user `482aa42d-...`) tem **duas memberships ativas**:

- `24f0883f-0580-4bc0-92f1-9990cb8f089d` (outro tenant)
- `fdeec040-7dba-4fa5-b786-0b5a19ce5b07` (Instituto Bignoto)

Em `supabase/functions/uazapi-proxy/index.ts` (linhas 45–63) a checagem de autorização faz:

```ts
const { data: membership } = await supabaseAdmin.from('tenant_memberships')
  .select('id, role, tenant_id')
  .eq('user_id', userId)
  .eq('is_active', true)
  .limit(1)
  .single();                           // pega UMA membership "qualquer"

const effectiveTenantId = tenant_id || membership?.tenant_id;
if (!isSaasAdmin && effectiveTenantId !== membership?.tenant_id) {
  return jsonResponse({ error: 'Forbidden' }, 403);
}
```

Sem `order by`, o Postgres devolve as duas linhas em ordem indeterminada. Quando a primeira linha é a do outro tenant, `membership.tenant_id` vira `24f0883f...`, `effectiveTenantId` é Bignoto (vindo do body) e a comparação falha — a função devolve **403 Forbidden** para uma usuária que de fato é admin do tenant alvo.

Isso explica por que o erro só acontece em conversas "Novo Lead": são conversas criadas com `whatsapp_instance_id = NULL` (confirmado nessa conversa), então o `whatsappRouter` cai no caminho UAZAPI e chama exatamente esse endpoint. Conversas que já têm instância vinculada também usariam UAZAPI, mas o gatilho prático foi a Clara abrir um lead novo.

## Por que aparece "pela Meta"

`src/components/inbox/ChatPanel.tsx` linha 616:

```ts
: (failedErr?.error_data?.details || failedErr?.message || failedErr?.title || 'Falha no envio pela Meta.');
```

O texto é **hardcoded** para todo `direction='outbound'` com `provider_metadata.status='failed'`, sem checar `providerInfo.provider`. Em tenants UAZAPI o rótulo fica enganoso.

# Correção

## 1. Backend — `supabase/functions/uazapi-proxy/index.ts`

Trocar a busca de membership "qualquer" pela busca da membership do **tenant alvo**:

```ts
const effectiveTenantId = tenant_id || /* fallback */ (
  await supabaseAdmin.from('tenant_memberships')
    .select('tenant_id').eq('user_id', userId).eq('is_active', true)
    .limit(1).maybeSingle()
).data?.tenant_id;

if (!effectiveTenantId) return jsonResponse({ error: 'No tenant found' }, 400);

const { data: membership } = await supabaseAdmin.from('tenant_memberships')
  .select('id, role, tenant_id')
  .eq('user_id', userId)
  .eq('tenant_id', effectiveTenantId)   // <-- chave da correção
  .eq('is_active', true)
  .maybeSingle();

if (!isSaasAdmin && !membership) {
  return jsonResponse({ error: 'Forbidden' }, 403);
}
```

Assim qualquer usuário multi-tenant é validado contra o tenant que ele está realmente operando.

## 2. Mesma auditoria nas demais edge functions

Rodar o mesmo padrão de correção em `wa-meta-send`, `webhook-uazapi` (parte autenticada), `ai-generate`, `invite-member`, `campaign-dispatch` e qualquer outra que use `.from('tenant_memberships').eq('user_id', userId).limit(1).single()`. Vou listar e corrigir só as que tiverem o anti-padrão.

## 3. Frontend — rótulo do balão de falha

`src/components/inbox/ChatPanel.tsx` (linha 616): trocar o texto fixo "Falha no envio pela Meta." por algo neutro e contextual:

```ts
const providerLabel = providerInfo?.provider === 'meta_cloud' ? 'WhatsApp Oficial' : 'WhatsApp';
const failedMsg = isOutsideWindow
  ? 'Cliente fora da janela de 24h. Envie um template para reativar a conversa.'
  : (failedErr?.error_data?.details || failedErr?.message || failedErr?.title
     || (msg as any)?.provider_metadata?.error_message
     || `Falha no envio via ${providerLabel}.`);
```

Bônus: agora o `error_message` salvo em `provider_metadata` (ex.: "Forbidden", "Nenhuma instância WhatsApp ativa") aparece no balão, em vez de ficar invisível.

## 4. Limpeza da mensagem travada

Não vou apagar a mensagem `b678739e...` do banco — ela continua marcada como falha. Após o deploy, a Clara pode reenviar normalmente. Se preferir, posso marcar essa única linha como excluída/oculta.

# Fora de escopo

- Não vou mexer no `whatsappRouter` nem na lógica de seleção de provider — está correta.
- Não vou alterar a tabela `whatsapp_instances` nem a instância UAZAPI já conectada.
- Sem migração SQL: a correção é puramente de código (edge function + componente React).
