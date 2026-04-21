

## Plano: Templates Meta — disparos, automações e tráfego pago com 2 APIs

Resposta ao seu questionamento, organizada em 5 blocos: **como templates funcionam**, **como serão disparados**, **como integram nas automações/funil**, **estratégia de pipelines**, e **recepção dual de tráfego pago**.

---

### 1. Como funcionam os templates Meta (HSM) — o essencial

A Meta exige que toda mensagem **iniciada pela empresa fora da janela de 24h** seja um **template aprovado** previamente. Características:

- **Cadastro na Meta** (não no nosso sistema): nome, idioma, categoria (`MARKETING`, `UTILITY`, `AUTHENTICATION`), corpo com variáveis `{{1}} {{2}}`, opcional header/footer/botões.
- **Aprovação manual** pela Meta (minutos a 24h). Templates `MARKETING` exigem opt-in e podem ser bloqueados se denunciados.
- **Variáveis posicionais**: `{{1}}, {{2}}` — o sistema preenche no envio com valores reais (nome do contato, link, etc.).
- **Custo por categoria/país** (cobrado pela Meta direto na conta do cliente).

No nosso sistema, eles ficam em `whatsapp_message_templates`, sincronizados via `wa-meta-templates-sync` (puxa o catálogo do WABA). O admin **não cria** templates no CRM — apenas sincroniza e usa.

---

### 2. Como serão disparados — três modos

**A. Manual 1-a-1 (já implementado)**
`SendTemplateDialog` no ChatPanel. Aparece automaticamente quando a conversa é `meta_cloud` e está fora da janela 24h. Atendente escolhe template, preenche variáveis, envia.

**B. Automação 1-a-1 (gatilho do CRM)**
Nova ação no `AutomationsPage`: **"Enviar template WhatsApp"**. Diferente do `send_whatsapp` atual (texto livre — só funciona em janela aberta), essa ação:
- Permite escolher template aprovado da instância
- Mapeia variáveis para campos do contato/oportunidade (`{{1}} = contact.name`, `{{2}} = opportunity.title`, etc.)
- Funciona em qualquer momento (janela aberta ou fechada)
- Roteia automaticamente: se a conversa é UAZAPI → envia texto livre; se é Meta → envia template

**C. Disparo em massa (campanha) — o "envio para a base"**
Nova tela **Campanhas** (`/campaigns`) com:
- Seleção de público: filtro por tags, status, pipeline, última interação, origem UTM, etc.
- Seleção de instância Meta de origem (qual número dispara)
- Seleção de template + mapeamento de variáveis (estáticas ou dinâmicas por contato)
- Throttling configurável (ex: 60 msgs/min) para respeitar rate limits da Meta
- Agendamento (data/hora de início)
- Preview com 3 contatos de amostra mostrando como ficará a mensagem renderizada
- Após envio: relatório de delivered / read / failed / replied

Implementação: nova tabela `campaigns` + `campaign_recipients`, processada por job no worker (já existe `job_queue` + `acquire_next_job`). Cada envio gera uma `messages` outbound + atualiza `campaign_recipients.status` via webhook `delivered`/`read`.

---

### 3. Como integrar no Flow Builder

No `FlowBuilderPage` (xyflow), o nó **"Mensagem"** ganha uma opção:
- **Modo "Texto livre"** (atual): só dispara se conversa estiver em janela aberta
- **Modo "Template aprovado"**: escolhe template + mapeia variáveis. Funciona sempre que a conversa estiver em instância Meta. Em conversa UAZAPI, faz fallback para texto livre.

O roteamento é transparente: o flow não precisa saber qual provider — o executor lê `conversation.whatsapp_instance_id.provider` e escolhe.

---

### 4. Pipeline próprio para Meta Ads? — Recomendação: **NÃO**

**Motivo:** o pipeline representa **o estágio comercial do lead** (Novo → Qualificado → Proposta → Fechado), não o canal de origem. Misturar canal com etapa quebra relatórios e confunde atendentes.

**Solução melhor — separação por dimensão correta:**

| Dimensão | Onde fica |
|---|---|
| **Estágio comercial** | Pipeline + Stage (já existe) |
| **Canal de origem** | `contact.source` + UTM (já existe) + badge da instância na conversa |
| **Tipo de campanha** | `contact.utm_campaign` + tags (já existe) |
| **Provider de envio** | `whatsapp_instance_id` na conversa (novo) |

**Recurso novo recomendado: filtros e visões salvas no Pipeline**
- Filtro por instância de origem (UAZAPI / Meta / específico)
- Filtro por UTM (`utm_source=facebook_ads`, `utm_campaign=black_friday`)
- Visões salvas: "Pipeline Meta Ads", "Pipeline Orgânico WhatsApp" — mesma estrutura de etapas, recortes diferentes

Se mesmo assim você quiser **pipelines fisicamente separados**, isso já é suportado (`pipelines` é multi-registro). Você cria "Pipeline Meta Ads" com etapas próprias e direciona automações para colocar leads vindos de `utm_source=facebook_ads` lá.

---

### 5. Recepção de tráfego pago com as duas APIs

**Cenário:** anúncios "Click-to-WhatsApp" do Meta Ads podem cair em qualquer um dos números. Precisa funcionar dos dois lados.

**Como funciona hoje (UAZAPI):** o webhook recebe a mensagem, cria contato e conversa. UTMs vêm no payload do anúncio (referral) e são extraídos para `contact.utm_*`.

**Adição para Meta Cloud (já implementado parcialmente):** o `webhook-meta` recebe payloads que incluem `referral` quando origem é anúncio:
```json
{ "referral": { "source_url": "...", "headline": "...", 
  "ctwa_clid": "...", "source_type": "ad" } }
```
Vamos extrair: `utm_source=facebook_ads`, `utm_campaign=<headline>`, `ad_id=<ctwa_clid>` e gravar em `contacts` igual ao fluxo UAZAPI.

**Roteamento de anúncios para o número certo:**
- Cada anúncio no Gerenciador da Meta aponta para 1 número específico (configuração no Ads Manager, não no CRM)
- O CRM só recebe — identifica o número de destino pelo `phone_number_id` no webhook → casa com `whatsapp_instances.meta_phone_number_id` → cria conversa amarrada àquela instância
- Resultado: a mesma campanha pode rodar em paralelo apontando para UAZAPI e para Meta. Cada lead cai na conversa da instância correta, e o atendente vê o badge.

**Estratégia operacional sugerida (tira melhor proveito das duas APIs):**

```text
┌──────────────────────────────────────────────────────────┐
│ ENTRADA (recepção paralela)                              │
│  • Anúncios → vários números                             │
│    - Número UAZAPI → webhook-uazapi → conversa UAZAPI    │
│    - Número Meta   → webhook-meta   → conversa Meta      │
│  • Atendente responde no inbox unificado                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ SAÍDA (1-a-1 reativo)                                    │
│  • Janela 24h aberta → texto livre via provider da conv  │
│  • Janela fechada e Meta → template (SendTemplateDialog) │
│  • Janela fechada e UAZAPI → bloqueia (ou alerta)        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ DISPARO PARA A BASE (campanha)                           │
│  • SEMPRE via instância Meta (templates aprovados)       │
│  • UAZAPI fica para reativo / janela aberta              │
│  • Filtros: tags, UTM, último contato, pipeline, etc.    │
└──────────────────────────────────────────────────────────┘
```

Esse é o ponto-chave: **UAZAPI cobre o operacional 24/7 sem custo por mensagem**, e **Meta Cloud cobre o reaquecimento de base com templates aprovados**, evitando bloqueios. Cada conversa fica amarrada à instância de origem, sem mistura.

---

### Escopo proposto para a próxima entrega (ordem)

1. **Ação "Enviar template" no AutomationsPage** + roteamento por provider
2. **Modo "template" no nó Mensagem do Flow Builder**
3. **Tabela `campaigns` + `campaign_recipients`** + processamento via worker
4. **Tela `/campaigns`**: criar campanha, escolher público, template, agendar, ver relatório
5. **Extração de `referral` no `webhook-meta`** para popular UTMs de anúncios Meta
6. **Filtros por instância e UTM no Pipeline** + visões salvas (opcional)

Cada passo é independente e testável. O passo 5 deve vir cedo se você já está rodando anúncios.

### Garantias mantidas

- UAZAPI continua intacto em todos os fluxos
- Conversas existentes não são afetadas (funcionam por instância padrão quando `whatsapp_instance_id` é NULL)
- Campanhas em massa só rodam em instâncias Meta (templates aprovados); UAZAPI nunca é usado para disparo frio
- Relatórios separam claramente o que foi enviado por cada provider

