## Diagnóstico forense

O envio do template funcionou, mas a resposta não chegou ao app porque a instância Meta usada no envio não está gerando eventos de webhook para o nosso endpoint.

Evidências encontradas:

- O template foi salvo e enviado pela instância **PAIPE WABA**:
  - `whatsapp_instance_id`: `bf86edc0-8f29-4974-a790-b865aaa5bd9b`
  - `meta_phone_number_id`: `1083594648176809`
  - conversa: `efae385a-6457-4b7d-b48d-6ea3ee4f5929`
  - contato: Bruno Almeida
- Essa conversa tem **1 outbound** e **0 inbound** depois do template.
- Na tabela `webhook_events`, a instância **Comercial SOS** recebe eventos normalmente:
  - `meta_phone_number_id`: `1115147951682906`
  - 66 eventos nas últimas 24h
- A instância **PAIPE WABA** não tem nenhum evento registrado:
  - `meta_phone_number_id`: `1083594648176809`
  - 0 eventos nas últimas 24h
  - nenhum último evento encontrado

Conclusão: o problema não é a tela do Inbox nem o salvamento da mensagem. O app simplesmente não recebeu o POST da Meta para essa instância PAIPE. Isso normalmente acontece quando o webhook do App Meta/WABA não está configurado ou inscrito para esse número/WABA, ou quando está apontando para outro endpoint/app.

## Plano de correção

1. **Adicionar diagnóstico visível na configuração Meta**
   - Mostrar, por conexão Meta, a URL do webhook e o token de verificação já usados pelo app.
   - Mostrar o último evento recebido para aquele `Phone Number ID`.
   - Mostrar um alerta quando uma conexão Meta válida para envio nunca recebeu webhook.

2. **Melhorar logs do `webhook-meta`**
   - Registrar de forma explícita quando chega evento para um `phone_number_id` sem instância correspondente.
   - Registrar quando o evento é recebido, mas não tem `messages`.
   - Registrar falhas de insert em `messages`, `contacts` ou `conversations`, hoje algumas operações são best-effort/silenciosas.

3. **Hardening do recebimento Meta**
   - Tornar o insert da mensagem inbound idempotente por `provider_message_id`, para evitar duplicidade se a Meta reenviar eventos.
   - Garantir que, ao receber resposta de um contato que já tem conversa antiga, a conversa correta vinculada à instância Meta seja atualizada.

4. **Orientação operacional pós-ajuste**
   - Revalidar no painel da Meta se o webhook está configurado para:
     - URL: `https://zhywwrhzaqfcjcwywkwf.supabase.co/functions/v1/webhook-meta`
     - Token de verificação da conexão PAIPE WABA
     - Campo/evento `messages` inscrito
   - Depois disso, enviar uma nova resposta do WhatsApp e confirmar se aparece em `webhook_events` e no Inbox.

## Arquivos a alterar

- `supabase/functions/webhook-meta/index.ts`
- `src/components/settings/MetaCloudConnectionsCard.tsx`

## Sem impacto esperado

- Não muda o envio de templates.
- Não muda UAZAPI.
- Não altera a estrutura principal do CRM.
- A correção é isolada ao diagnóstico e robustez do recebimento pela API oficial da Meta.