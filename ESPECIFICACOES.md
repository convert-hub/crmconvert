# Especificações do Sistema — CRM Convert

CRM SaaS multi-tenant focado em atendimento via WhatsApp, com pipeline de vendas, automações, IA generativa e campanhas em massa.

---

## 1. Stack Técnica

- **Frontend:** React 18 + Vite 5 + TypeScript 5 + Tailwind CSS v3 + shadcn/ui
- **Backend:** Supabase self-hosted (Postgres + RLS + Edge Functions Deno + Realtime + Storage + pg_cron)
- **Worker:** Node.js independente (jobs pesados/assíncronos — transcrição, sync histórico, campanhas, RAG)
- **IA:** OpenAI (gpt-4o-mini para geração/qualificação, Whisper-1 para transcrição, embeddings para RAG via pgvector HNSW)
- **Idioma:** Estritamente pt-BR (labels centralizadas em `src/lib/labels.ts`)

---

## 2. Arquitetura Multi-tenant

- Isolamento por `tenant_id` em todas as tabelas com **RLS obrigatório**.
- Roles armazenados em `user_roles` separado (nunca no profile) — função `has_role()` SECURITY DEFINER.
- Bypass administrativo via `is_saas_admin()` para SaaS Admins (rota `/admin`).
- **Impersonation** de tenant via `AuthContext` + `sessionStorage` para suporte.
- Membership com roles: `admin | manager | attendant | readonly`.
- Onboarding com aprovação manual em `/waiting-approval` (default: `attendant`).

---

## 3. Módulos Principais

### 3.1 Contatos
- Campos padrão + `custom_fields` JSONB + tags (hex colors, multi-seleção com `.contains()`).
- UTM capture, deduplicação por telefone, consent/DNC flags.
- Import/export CSV; sync histórico UAZAPI em lote.

### 3.2 Pipeline (Kanban)
- Múltiplos pipelines com stages ordenáveis (drag-and-drop).
- Oportunidades com prioridade, valor, status (open/won/lost), tags, campos customizados.
- Indicador de temperatura (inatividade) + badge de mensagens não lidas.
- Atribuição round-robin por carga de trabalho.

### 3.3 Inbox (WhatsApp)
- **ChatPanel** com UI otimista, estados: `open | waiting_customer | waiting_agent | closed`.
- **Multi-instância:** seletor aparece só quando tenant tem ≥2 instâncias ativas.
- Providers suportados: **Meta Cloud API** oficial + **UAZAPI**.
- Roteamento de envio via `src/lib/whatsappRouter.ts` (por `whatsapp_instance_id` da conversa).
- Realtime: debounce 700ms + polling 2s como fallback.
- Filtros com `conversation_id=eq.X` obrigatórios em subscriptions (previne vazamento cross-tenant).
- Áudio: gravação, player, transcrição Whisper no worker (idempotência por `message_id`).
- Templates Meta com mídia default de header, agendamento de mensagens.

### 3.4 Automações
- **Keywords:** captura de lead + ativação/desativação de IA (normalização estrita).
- **Regras/Sequências/Webhooks:** endpoints públicos com slug + secret.
- **Flow Builder:** xyflow drag-and-drop (Trigger, Message, Question, Menu, Condition, Delay, Action, AIAssistant, Subflow, Randomizer). Execução no worker.
- Compartilhamento de fluxos via `flow_shares` (instalação inativa para revisão).

### 3.5 Campanhas
- Envio em massa via templates Meta com throttle configurável.
- Segmentação por tags, status, pipeline/stage, UTM, inatividade.
- Métricas: sent/delivered/read/replied/failed com realtime.

### 3.6 IA
- **Copilot** e **Auto-reply** unificados em `ai-generate` Edge Function.
- **RAG:** knowledge base com pgvector HNSW, categorias, PDF processado no worker.
- **Prompt Studio:** versionamento de prompts com mapping para documentos RAG.
- **Takeover:** IA desliga quando keyword normalizada é enviada do número da clínica.
- Resolução de API key: 3-tier fallback (Tenant → DB global → ENV).

### 3.7 Atividades
- Tasks (call/task/note/email/meeting/follow_up) — agendamento neutraliza alertas de inatividade.

### 3.8 Relatórios
- Recharts: funil de conversão, SLA, performance por agente.

---

## 4. Regras Críticas

- **Jobs devem sempre bindar por `message_id`** — proibido buscar "última mensagem".
- **UAZAPI proxy:** falhas de mídia retornam `200 + ok:false` (evita crash do SDK).
- **Normalização de strings:** lowercase, sem acentos, sem espaços duplos para comparação.
- **Deleção:** cascata obrigatória via `CascadeDeleteDialog` (activities → conversation → opportunity → contact).
- **RLS:** toda tabela em `public` requer `GRANT` explícito para `authenticated`/`service_role`.
- **Realtime subscriptions:** sempre filtrar por `conversation_id`/`tenant_id` para evitar vazamento cross-tenant.
- **Worker:** alterações exigem rebuild da imagem Docker.

---

## 5. Identidade Visual

- **Fonte:** Plus Jakarta Sans
- **Paleta:** neutros e creme, estética minimalista/luxo, alta densidade
- **Branding customizável por tenant:** variáveis HSL CSS + logo em Supabase Storage (com cache-busting)
- **UI:** sem labels redundantes, componentes densos, dark mode via tokens semânticos em `index.css`

---

## 6. Estrutura de Dados (principais tabelas)

`tenants`, `tenant_memberships`, `user_roles`, `profiles`, `contacts`, `companies`, `pipelines`, `stages`, `opportunities`, `conversations`, `messages`, `activities`, `whatsapp_instances`, `whatsapp_message_templates`, `campaigns`, `campaign_recipients`, `webhook_endpoints`, `flows`, `flow_shares`, `knowledge_documents`, `prompts`, `jobs`.

---

## 7. Rotas Principais

- `/` `/login` `/onboarding` `/waiting-approval` `/update-password`
- `/inbox` `/pipeline` `/contacts` `/activities` `/campaigns` `/campaigns/:id`
- `/automations` `/flow-builder` `/flow/install/:token`
- `/reports` `/dashboard` `/settings` `/prompt-studio` `/ai-suggestions` `/jobs`
- `/admin` `/admin/tenants` `/admin/users` `/admin/apis`
