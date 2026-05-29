## Problema

O bloco de Ação **"Atribuir atendente"** hoje sempre faz round-robin automático (rota para o membro com menor workload), sem dar ao usuário a opção de escolher um atendente específico. A imagem confirma: o campo só mostra o tipo da ação, sem picker.

## Solução

Adicionar configuração ao tipo `assign_agent` com dois modos:

1. **Automático (carga de trabalho)** — comportamento atual (round-robin via `get_member_workload`). Mantido como padrão para não quebrar fluxos existentes.
2. **Atendente específico** — usuário escolhe um membro do tenant (admin/manager/attendant ativo). O worker grava `assigned_to = membership_id` direto.

## Alterações

**Frontend — `src/components/flow-builder/ActionConfigFields.tsx`**
- Quando `type === 'assign_agent'`, renderizar:
  - `Select` "Modo": Automático / Atendente específico
  - Se "específico": `Select` carregando membros ativos do tenant (`memberships` join `profiles`, filtrando pelo `tenantId` recebido por prop)
- Persistir em `config`: `{ mode: 'auto' | 'specific', membership_id?: string }`

**Worker — `worker/index.js` (case `assign_agent`, ~linha 1071)**
- Se `config.mode === 'specific'` e `config.membership_id`: validar que pertence ao `tenant_id` do fluxo e está ativo; se válido, `update assigned_to = config.membership_id`.
- Caso contrário (auto ou inválido): manter fluxo round-robin atual como fallback.

**Compatibilidade**
- Configs antigas sem `mode` são tratadas como `auto` → zero regressão.
- Worker exige rebuild/redeploy para a opção "específico" entrar em produção (regra documentada em `mem://tech/restricoes`). UI funciona imediatamente.

## Fora de escopo

- Não alterar outros tipos de ação.
- Não mexer em `ActionNode` (label já reflete o tipo).
