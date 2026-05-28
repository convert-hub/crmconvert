## Diagnóstico

- A tentativa para o contato Diego não falhou na chamada inicial: `wa-meta-send` respondeu `ok:true` e retornou `provider_message_id`.
- A falha veio alguns segundos depois pelo webhook de status da Meta, com `status: failed` e erro `131047`:
  - “mais de 24h desde a última resposta do cliente”
  - causa real: cliente fora da janela de 24h; precisa enviar template.
- Hoje o webhook grava isso em `messages.provider_metadata.last_status = 'failed'`, mas o `ChatPanel` só mostra ícones de entregue/lido e não transforma esse status em aviso visível. Por isso parece que “nada aconteceu”.

## Plano de correção

1. Atualizar a leitura visual das mensagens no `ChatPanel`
   - Detectar `provider_metadata.last_status === 'failed'`.
   - Extrair o primeiro erro em `provider_metadata.statuses[].raw.errors[0]`.
   - Quando o código for `131047`, mostrar abaixo da bolha:
     - “Cliente fora da janela de 24h. Envie um template.”
   - Incluir ação/botão pequeno “Enviar template” nessa mensagem, abrindo o modal já existente.

2. Corrigir o indicador da mensagem enviada
   - Para mensagens com `failed`, trocar o check por um indicador de erro discreto.
   - Manter `read` e `delivered` exatamente como estão.

3. Garantir atualização em tempo real
   - O webhook já faz `UPDATE` na tabela `messages`.
   - O `ChatPanel` já escuta `UPDATE` em Realtime, então a bolha deve mudar sozinha quando o status assíncrono chegar.
   - Não mexer no fluxo de envio bem-sucedido, templates, mídia, CRM ou persistência atual.

4. Aplicar o mesmo comportamento no chat do CRM
   - O chat do CRM reutiliza `ChatPanel`, então a correção entra nos dois lugares sem duplicar lógica.

## Arquivos previstos

- `src/components/inbox/ChatPanel.tsx`
  - Ajuste visual e extração da mensagem de erro Meta.

Sem mudança de banco, sem mudança de RLS e sem alterar a função de envio.