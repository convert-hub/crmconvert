# Coexistência UAZAPI + Meta Cloud API

Hoje cada `conversation` já carrega `whatsapp_instance_id`, e o `whatsappRouter` decide o provedor pela instância. Mas a UI/automatizações ainda assumem "1 contato = 1 canal". O plano abaixo destrava o uso paralelo das duas APIs para o **mesmo número**, com gestão clara.

## 1. Falar com o mesmo número pelas duas APIs

**Conceito:** uma conversa pertence a um **par (contato, instância WhatsApp)**, não só ao contato.

- Quando uma mensagem chega (webhook UAZAPI ou Meta), o sistema já procura/crea a conversation pelo `whatsapp_instance_id` correto. Vamos garantir esse comportamento e **não** reaproveitar uma conversa de outra instância.
- Na **Inbox**, agrupar conversas pelo contato mas exibir cada thread com um **badge do canal** ("Oficial - Meta" / "UAZAPI - Número X"). O usuário pode alternar entre as threads abertas do mesmo contato.
- No **detalhe do contato** e no **card da Oportunidade**, listar todas as conversas vinculadas (com badge do provedor) em vez de assumir uma única.
- No "Iniciar conversa" (`StartConversationDialog`), exigir escolha de **instância** quando o tenant tem mais de uma; isso já está parcialmente feito, vamos reforçar.

## 2. Enviar template Meta a partir da Inbox e do Card

- **Inbox**: o `SendTemplateDialog` já existe. Adicionar o botão "Enviar template" sempre disponível quando a conversa estiver vinculada a uma instância `meta_cloud` (não só quando expira a janela 24h). Para conversas em UAZAPI, o botão fica oculto.
- **Card da Oportunidade** (`OpportunityDetail`): novo botão "Enviar template Meta" que:
  - Se o contato já tem conversa Meta aberta → reusa.
  - Se não tem → pergunta qual instância Meta usar, cria a conversa e envia.
- Aproveita o mesmo `SendTemplateDialog` (já lê `whatsapp_message_templates` filtrando por `status = 'APPROVED'`).

## 3. Automações cientes do canal (mudança de coluna do Kanban etc.)

A `AutomationsPage` já tem a action **`send_template`** (Meta) com seletor de instância. Falta cobrir UAZAPI e dar clareza:

- Renomear/duplicar action `send_whatsapp` para deixar explícito:
  - **`send_whatsapp_text`** (UAZAPI ou Meta texto livre — só funciona se houver janela 24h aberta no Meta)
  - **`send_whatsapp_template`** (somente Meta, exige instância + template)
- Em ambas, adicionar campo opcional **"Instância WhatsApp"**:
  - Se vazio → usa a instância da conversa atual do contato (se existir) ou a instância padrão do tenant.
  - Se preenchido → força aquela instância (ex.: "todo card que cair em 'Aguardando confirmação' dispara template Meta na instância oficial").
- No `worker/automation-handler.js`, o handler de `send_whatsapp` passa a:
  1. Resolver provider via instância escolhida.
  2. Se for `meta_cloud` e ação for template → invocar `wa-meta-send` com `type: 'template'`.
  3. Se for `meta_cloud` e janela 24h expirou → cair em fallback configurável (template default ou erro registrado).
  4. Se for UAZAPI → caminho atual.
- Nas condições do trigger `opportunity_stage_changed`, manter o que já existe (from/to stage). Sem mudança de schema.

## 4. Sugestões adicionais de gestão

a) **Instância padrão por pipeline / por tag**: configurar no pipeline qual instância (e qual provedor) é a "preferida" para novos leads daquele funil. Reduz a chance do operador escolher errado.

b) **Política de fallback 24h Meta**: campo no tenant settings: "Quando a janela 24h expirar, usar template X automaticamente" — usado pelo router e por automações de envio livre.

c) **Indicador visual no Kanban**: ícone pequeno no card mostrando o canal da última conversa (Meta oficial vs UAZAPI), para o gestor bater o olho e entender.

d) **Página única "Canais WhatsApp"** em Configurações reunindo:
   - Conexões UAZAPI + Meta Cloud (cards atuais).
   - Templates Meta (aba já criada).
   - Política de fallback 24h.
   - Mapeamento "instância padrão por pipeline".

e) **Logs de envio unificados**: já temos `messages` com `provider_metadata`. Adicionar uma view simples em Configurações > Diagnóstico mostrando últimos envios por instância com status (entregue/lido/erro), útil para depurar quando algo "não chega".

f) **Bloqueio de duplicidade**: ao iniciar conversa manualmente, se já existir conversa aberta com o mesmo contato em **outra** instância, mostrar aviso "já existe conversa ativa em [Instância X] — deseja abrir paralela?" para evitar atendimentos cruzados sem querer.

## Arquivos que devem ser tocados (resumo)

- `src/components/inbox/ChatPanel.tsx` — botão "Enviar template" sempre visível em conv Meta + badge do canal.
- `src/components/inbox/ConversationsList` (onde lista threads) — agrupar/exibir múltiplas conversas por contato.
- `src/components/crm/OpportunityDetail.tsx` — botão "Enviar template Meta" + lista de conversas por instância.
- `src/components/crm/StartConversationDialog.tsx` — reforçar seletor de instância e aviso de duplicidade.
- `src/pages/AutomationsPage.tsx` — separar actions `send_whatsapp_text` vs `send_whatsapp_template`, seletor de instância.
- `worker/automation-handler.js` — roteamento por instância + suporte a template + fallback 24h.
- `src/pages/SettingsPage.tsx` (+ novos componentes pequenos) — política de fallback e mapeamento por pipeline.
- `src/lib/whatsappRouter.ts` — helper `resolveInstanceForContact(contactId, preferred)` reutilizável.

## Sem mudanças destrutivas

- Sem migrations obrigatórias agora. Configurações novas (fallback, instância por pipeline) podem morar em `tenants.settings` (jsonb) ou em colunas opcionais — decidimos na hora de implementar conforme você priorizar.

## Fora do escopo deste plano

- Criar/submeter templates Meta direto pelo app.
- Migração automática de histórico de uma instância pra outra.

---

**Pergunta antes de implementar:** quer que eu ataque tudo isso em uma leva só, ou prefere fatiar? Sugiro a ordem:
1. Botão de template no Inbox e no Card (ganho imediato).
2. Automações com seletor de instância + template.
3. Múltiplas conversas por contato (UI) + aviso de duplicidade.
4. Política de fallback 24h e instância padrão por pipeline.
5. Diagnóstico de envios.
