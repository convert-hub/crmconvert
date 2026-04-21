

## Plano: WhatsApp Cloud API (Meta) como segundo provedor — sem afetar UAZAPI em produção

### Princípio central: aditivo, nunca substitutivo

Tudo que existe hoje — `uazapi-proxy`, `webhook-uazapi`, `whatsapp_instances` com UAZAPI, conversas, automações, worker, ChatPanel — continua **idêntico em comportamento**. A integração Meta é construída em paralelo, e só é ativada quando o admin do tenant cria explicitamente uma instância do tipo `meta_cloud`.

### Garantias de não-regressão

| Risco | Mitigação |
|---|---|
| Mudar schema quebra queries existentes | Todas as colunas novas são **nullable** ou têm **DEFAULT** que reproduz o estado atual (`provider='uazapi'`). Nenhuma coluna existente é removida ou renomeada. |
| Refatorar `uazapi-proxy` introduz bug | `uazapi-proxy` e `webhook-uazapi` **não são tocados**. Permanecem byte-a-byte iguais. |
| Frontend trocado para roteador novo quebra envio UAZAPI | O roteador `wa-send` é **opt-in**. ChatPanel e demais componentes continuam chamando `uazapi-proxy` diretamente como hoje. Só a UI nova de Meta usa `wa-send`/`wa-meta-send`. |
| Worker quebra fluxos automatizados | Worker **não é alterado** nesta entrega. Continua chamando `uazapi-proxy`. Migração do worker fica para fase posterior, opcional. |
| Webhook novo conflita com webhook existente | `webhook-meta` é endpoint **novo e separado**. `webhook-uazapi` continua intacto. |
| Conversas existentes ficam órfãs | Coluna `whatsapp_instance_id` em conversas é **nullable**. NULL = comportamento atual (UAZAPI da única instância ativa). Nenhum backfill obrigatório. |
| Tipos TypeScript regenerados quebram build | Apenas campos opcionais são adicionados. Código existente que não os referencia continua compilando. |

### Escopo desta entrega (fase 1 — aditiva pura)

**Banco** (migration aditiva):
- `whatsapp_instances`: adicionar colunas opcionais `provider TEXT DEFAULT 'uazapi'`, `display_name`, `meta_phone_number_id`, `meta_waba_id`, `meta_access_token_encrypted`, `meta_app_secret_encrypted`, `meta_verify_token`. Instâncias existentes recebem `provider='uazapi'` automaticamente.
- `conversations`: adicionar `whatsapp_instance_id UUID NULL`. Conversas existentes ficam NULL — nada quebra.
- Nova tabela `whatsapp_message_templates` (isolada, RLS no padrão do projeto).

**Edge Functions novas** (não tocam nas existentes):
- `wa-meta-send` — envio via Graph API v21.0 (texto, mídia, template, reaction, reply).
- `webhook-meta` — recebe da Meta, valida HMAC `X-Hub-Signature-256`, identifica instância pelo `phone_number_id`, cria contact/conversation/message com `whatsapp_instance_id` preenchido.
- `wa-meta-templates-sync` — sincroniza templates aprovados da Meta.

**Frontend** (componentes novos + UI estendida):
- `WhatsAppConnectionsSettings.tsx`: passa a listar todas as instâncias com badge de provider. Botão "Adicionar conexão" abre escolha UAZAPI (fluxo atual, sem mudança) ou Meta Cloud (form novo). Mostra URL do webhook e verify_token gerado para colar no painel da Meta.
- `SendTemplateDialog.tsx` (novo): aparece **apenas** em conversas de instâncias `meta_cloud` quando fora da janela 24h.
- `ChatPanel.tsx`: lê `conversation.whatsapp_instance_id`. Se NULL ou `provider='uazapi'` → chama `uazapi-proxy` exatamente como hoje. Se `provider='meta_cloud'` → chama `wa-meta-send`. Branch isolado, fluxo UAZAPI inalterado.
- `src/types/crm.ts`: adicionar campos opcionais (`whatsapp_instance_id?`, novo tipo `WhatsAppInstance` com `provider`).

### O que NÃO muda nesta entrega

- `uazapi-proxy/index.ts` — não tocado
- `webhook-uazapi/index.ts` — não tocado
- `worker/index.js` e `worker/automation-handler.js` — não tocados
- Fluxo de criar/conectar instância UAZAPI (QR code etc.) — não tocado
- Envio de mensagens em conversas UAZAPI existentes — não tocado
- Automações, flow builder, scheduled messages — não tocados
- Chamadas existentes do frontend a `uazapi-proxy` — preservadas; apenas adicionamos um branch para Meta

### Estratégia de segurança operacional

1. **Migration reversível**: todas as colunas adicionadas podem ser removidas sem perda de dados (nada migra valores existentes).
2. **Feature isolada por tenant**: enquanto nenhum tenant cadastrar credenciais Meta, todo o código novo fica dormente. Zero efeito colateral em produção.
3. **Roteamento por dado, não por flag global**: a decisão de qual provider usar é tomada por linha (`whatsapp_instances.provider`), não por configuração global. Impossível afetar outros tenants.
4. **Validação HMAC obrigatória** no `webhook-meta` (sem `meta_app_secret` válido, requisição é rejeitada). Protege contra webhooks forjados.
5. **Credenciais por instância**, criptografadas no mesmo padrão de `api_token_encrypted` (já usado para UAZAPI).

### Ordem de implementação (cada passo testável independentemente)

1. Migration de schema (aditiva, sem dados)
2. `wa-meta-send` + `webhook-meta` (Edge Functions novas, não afetam nada)
3. UI de cadastro Meta em `WhatsAppConnectionsSettings`
4. Branch condicional no `ChatPanel` (só para `meta_cloud`)
5. Templates: tabela + sync + `SendTemplateDialog` (só para `meta_cloud` fora da janela 24h)

### Fora de escopo (fases futuras, opcionais)

- Roteador unificado `wa-send` substituindo chamadas diretas a `uazapi-proxy`
- Migração do worker para usar roteador
- Backfill de `whatsapp_instance_id` em conversas antigas

Essas etapas só serão consideradas depois que a integração Meta estiver validada em produção, e mesmo assim apenas se trouxerem benefício claro — manter UAZAPI funcionando exatamente como hoje é prioridade absoluta.

