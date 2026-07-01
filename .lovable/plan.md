## Objetivo
Rastreamento unificado de origem CTWA (Click-to-WhatsApp) para Meta Cloud + UAZAPI, com atribuição única, correção do bug atual do Meta e backfill do histórico.

---

## Verificação de path (confirmado)

`webhook-uazapi/index.ts` linha 162: `const msg = body.message || body;` — ou seja, `msg` já é o sub-objeto message. **Path correto**: `msg.content?.contextInfo` (não `msg.message.content.contextInfo`).

`webhook-meta/index.ts`: `referral = msg.referral` (msg vem de `value.messages[i]`) — path já correto.

---

## 1. Migration de schema

- `contacts.ctwa_clid text` (nullable) + índice `idx_contacts_ctwa_clid`.
- `conversations.ctwa_clid text` (nullable).
- `opportunities.ctwa_clid text` (nullable).
- Sem alteração de RLS.

## 2. Helper `_shared/ctwa.ts`

```ts
type CtwaInput = {
  provider: 'meta_cloud' | 'uazapi';
  ctwa_clid?: string | null;
  ad_id?: string | null;
  network?: string | null;
  source_url?: string | null;
  headline?: string | null;
  body?: string | null;
  image_url?: string | null;
  media_type?: string | null;
};

export function deriveNetworkFromUrl(sourceUrl?: string | null): string | null;
// instagram.com → 'instagram'; facebook.com|fb.me|fb.com → 'facebook'; senão null.

export function deriveNetworkFromApp(app?: string | null): string | null;
// só retorna 'instagram'/'facebook' quando exatamente esses valores; senão null.

export function buildCtwaPatch(existing, input): Record<string, unknown>;
```

Regras `buildCtwaPatch` (recebe contato existente com **custom_fields, ctwa_clid, ad_id, utm_***):
- `source = 'ctwa'`.
- `utm_source = network || existing.utm_source || 'meta'`.
- `utm_medium = 'ctwa'`.
- `utm_campaign = headline ?? existing.utm_campaign`.
- `ad_id`: só sobrescreve quando `input.ad_id` for não-nulo (Meta). UAZAPI nunca toca.
- `ctwa_clid`: **last-touch** — sempre atualiza quando `input.ctwa_clid` for não-nulo.
- `custom_fields.ctwa`: merge com `existing.custom_fields.ctwa`:
  - `first_seen_at`: preserva o existente; senão `now()`.
  - `last_seen_at`: sempre `now()`.
  - Demais campos (`provider`, `network`, `ctwa_clid`, `ad_id`, `headline`, `body`, `source_url`, `image_url`, `media_type`): `new ?? old` (não-destrutivo).
- Preserva todas as outras chaves de `custom_fields`.

## 3. `webhook-meta` — correção

- **SELECT do contato**: estender para `id, utm_source, utm_campaign, ad_id, ctwa_clid, custom_fields` (nos dois lookups — inicial e race-recovery).
- Substituir bloco `adContext`/`insertData`/backfill por:
  - Construir `input = { provider:'meta_cloud', ctwa_clid: referral.ctwa_clid, ad_id: referral.source_id, network: deriveNetworkFromUrl(referral.source_url), source_url, headline, body, image_url: referral.image_url, media_type: referral.media_type }`.
  - Aplicar `buildCtwaPatch` nos **três** ramos após contato resolvido: novo contato, contato pré-existente, contato race-recovered. Um único ponto após o `if (!contact) return`.
- Persistir `conversations.ctwa_clid` só no INSERT da conversa (não sobrescrever em conversas antigas).
- Bloco CTWA inteiro em try/catch interno; erro loga e segue (webhook segue retornando 200).

## 4. `webhook-uazapi` — adicionar CTWA

- **SELECT do contato**: estender para incluir `custom_fields, ctwa_clid, utm_source, utm_campaign, ad_id` (hoje é `select('*')` — verificar, mas estender explicitamente se necessário).
- Após `if (!contact) return` (contato resolvido nos ramos novo/existente/race), extrair:
  ```ts
  const ci = msg?.content?.contextInfo;
  if (ci?.entryPointConversionSource === 'ctwa_ad') {
    const ear = ci.externalAdReply ?? {};
    const input = {
      provider: 'uazapi' as const,
      ctwa_clid: null,
      ad_id: null,
      network: deriveNetworkFromApp(ci.entryPointConversionApp)
              ?? deriveNetworkFromUrl(ear.sourceURL),
      source_url: ear.sourceURL ?? null,
      headline: ear.title ?? null,
      body: ear.body ?? null,
      image_url: ear.thumbnailUrl ?? null,
      media_type: ear.mediaType ?? null,
    };
    const patch = buildCtwaPatch(contact, input);
    await supabase.from('contacts').update(patch).eq('id', contact.id);
  }
  ```
- Persistir `conversations.ctwa_clid` no INSERT quando o contato já tiver `ctwa_clid` (útil quando o clique original veio via Meta e a conversa foi criada via UAZAPI — raro, mas coerente).
- Try/catch interno; nunca derrubar o ack.

## 5. Migration de backfill (separada, reversível)

Passo 1 (auditoria manual antes de aplicar):
```sql
select count(*), min(length(ad_id)), max(length(ad_id))
  from public.contacts
 where ad_id ~ '^Af' and length(ad_id) > 40;
select id, ad_id, campaign_id from public.contacts
 where ad_id ~ '^Af' and length(ad_id) > 40 limit 20;
```

Passo 2 (UPDATE — em PG, SET usa valores antigos da linha, então swap em um único UPDATE é seguro):
```sql
update public.contacts
   set ctwa_clid = ad_id,
       ad_id     = campaign_id,
       custom_fields = coalesce(custom_fields,'{}'::jsonb)
                     || jsonb_build_object('ctwa',
                        coalesce(custom_fields->'ctwa','{}'::jsonb)
                        || jsonb_build_object(
                           'ctwa_clid', ad_id,
                           'ad_id', campaign_id,
                           'backfilled_at', now()))
 where ad_id ~ '^Af' and length(ad_id) > 40;
```
Reversível via `custom_fields.ctwa.backfilled_at` + valores antigos preservados no bloco.

## 6. Propagação para `opportunities.ctwa_clid`

- Onde oportunidades são criadas a partir de contato/conversa: `CreateOpportunityDialog.tsx`, `CreateOpportunityFromContactDialog.tsx`, `webhook-form-intake`, `webhook-uazapi` (se houver auto-criação), `worker` (keyword automations que criam opp). Em cada ponto, ao insertar a opportunity, copiar `ctwa_clid` e (se ainda vazio) `source` do contato.
- Escopo mínimo desta entrega: fazer nos dois dialogs de UI. Backend/worker fica para a fase de reports (registrado aqui para não esquecer).

## 7. UI — badge de origem

- `src/lib/ctwa.ts`: `getCtwaInfo(contact)` → `{ network, headline, sourceUrl } | null` quando `source==='ctwa'` + `custom_fields.ctwa` existir.
- `src/components/shared/CtwaBadge.tsx`: badge minimalista "Anúncio · {network}" com ícone `Megaphone`, tooltip com headline, `sourceUrl` como link externo. Sem label redundante ("Origem:" fica no tooltip).
- Inserir em:
  - `ChatPanel.tsx` (header, ao lado do nome).
  - `OpportunityDetail.tsx` (bloco de info).
  - `ContactsPage.tsx` (drawer/painel do contato).

---

## Riscos

1. **Path errado do contextInfo (UAZAPI)** — confirmado `msg.content?.contextInfo` (msg = body.message || body).
2. **Merge destrutivo de custom_fields** — mitigado ao incluir `custom_fields` no SELECT e fazer merge no app antes do UPDATE.
3. **Ramo de race sem patch** — patch aplicado num único ponto pós-resolução do contato, cobrindo os três caminhos.
4. **deriveNetwork errado no Meta** — usar domínio do `source_url`; `source_type` (`ad`/`post`) ignorado como rede.
5. **Backfill** — heurística `^Af` + len>40; risco de falso-positivo baixíssimo (IDs de anúncio são numéricos). SELECT de auditoria antes.
6. **UAZAPI sem ctwa_clid/ad_id** — reports precisam tolerar nulls; CAPI só para Meta.
7. **Webhook 200** — bloco CTWA em try/catch, sem throw.
8. **utm_source legado** — não reescrever histórico; padrão novo só em eventos novos.
9. **`conversations.ctwa_clid`** — só no INSERT (preserva atribuição original).
10. **Não tocar em `webhook-meta-leads`**.

---

## Ordem de execução

1. Migration de schema (colunas + índices).
2. Migration de backfill separada (com SELECT de auditoria).
3. `_shared/ctwa.ts`.
4. Ajuste `webhook-meta` (SELECT ampliado + 3 ramos + INSERT conversation).
5. Ajuste `webhook-uazapi` (SELECT ampliado + captura CTWA + INSERT conversation).
6. Propagação `opportunities.ctwa_clid` nos 2 dialogs.
7. `ctwa.ts` + `CtwaBadge` + 3 pontos de UI.
8. Verificação com mensagem-teste de cada provedor.
