# Diferenciar instâncias WhatsApp na Inbox

Alterar **apenas** `src/pages/InboxPage.tsx`. Regra chave: UI só muda se o tenant tiver ≥2 instâncias ativas.

## 1. Carregamento de instâncias

- Novo state: `instances: WhatsAppInstance[]` e `instancesById: Record<string, WhatsAppInstance>` (memo).
- No `useEffect` inicial (dependente de `tenant.id`), buscar:
  ```ts
  supabase.from('whatsapp_instances')
    .select('id, provider, phone_number, display_name, instance_name, is_active')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
  ```
- Derivar `showInstanceUI = instances.length >= 2`.

## 2. Filtro selecionado

- State `selectedInstanceId: string | null` (null = todas).
- Persistência em `localStorage['inbox:instanceFilter']`.
- Ao hidratar: se o id salvo não estiver mais em `instances`, resetar para `null` e limpar chave.

## 3. UI do filtro (pills)

- Renderizar segunda linha **abaixo** dos pills existentes (Todas / Não lidas / Sem resposta), somente se `showInstanceUI`.
- Reutilizar exatamente as mesmas classes/tamanho dos pills atuais.
- Pills:
  - "Todos os canais" → `selectedInstanceId = null` (default).
  - Um por instância com label:
    ```
    (provider === 'meta_cloud' ? 'API Oficial' : 'UAZAPI') + ' (' + last4(phone_number) + ')'
    ```
    Helper `last4`: strip não-dígitos e pega os últimos 4; se vazio, cai para `display_name` ou primeiros 4 do `id`.

## 4. Filtragem de dados

- Em `baseQuery()` e na query de busca por texto: se `selectedInstanceId` não for null, adicionar `.eq('whatsapp_instance_id', selectedInstanceId)`.
- Incluir `selectedInstanceId` nas dependências dos effects/queries que já dependem de outros filtros para forçar refetch.
- Confirmar que canais Realtime (se existirem) refazem fetch quando o filtro muda — reaproveitando as deps existentes.

## 5. Badge na lista de conversas

- Somente se `showInstanceUI`.
- Ao lado do channel label existente, badge pequeno:
  - `meta_cloud` → texto "Oficial", classes `bg-emerald-500/10 text-emerald-600 border-emerald-500/20`.
  - `uazapi` → texto "UAZAPI", classes `bg-orange-500/10 text-orange-600 border-orange-500/20`.
  - Sem `whatsapp_instance_id` ou instância não encontrada → "Sem canal", classes cinza (`bg-muted text-muted-foreground border-border`).
- Estilo consistente com badges existentes (rounded, `text-[10px]`/`text-xs`, `px-1.5 py-0.5 border`).

## 6. ChatHeader

- Se `showInstanceUI`, acrescentar após `contact.phone · channel` um separador `·` e o mesmo label do pill ("API Oficial (9817)" / "UAZAPI (0724)"), com cor sutil (`text-muted-foreground`). Se conversa sem instância, mostrar "Sem canal".

## Fora de escopo

- `whatsappRouter.ts`, `ChatPanel`, envio de mensagens: não tocar.
- Nenhum outro arquivo.

## Riscos

1. **Coluna `whatsapp_instance_id` no baseQuery**: se o `select` atual não a inclui, o badge fica sem dado. Ação: adicionar o campo ao `select` (já é da mesma tabela `conversations`, custo zero).
2. **Persistência stale**: id em localStorage pertencente a instância desativada. Mitigado com o reset ao hidratar.
3. **Realtime**: filtros são aplicados client-side no refetch; se houver subscription por `postgres_changes` filtrada por tenant, novos eventos de outra instância ainda chegam e são filtrados na próxima leitura — sem regressão, apenas refetch a mais.
4. **Layout mobile**: segunda linha de pills pode quebrar em telas estreitas. Usar `flex flex-wrap gap-2` como a linha de cima já faz.
5. **`phone_number` nulo** (ex: Meta Cloud sem número salvo): fallback para `display_name` evita label vazio tipo "API Oficial ()".
6. **Contagem de instâncias muda em runtime** (admin ativa/desativa outra instância): só relemos ao montar. Aceitável — usuário recarrega. Documentar como limitação.
