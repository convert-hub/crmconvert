

## Plano: Delete Contextual com Confirmação de Cascade

### Diagnóstico

A FK `conversations.contact_id` atual é `ON DELETE CASCADE` (não SET NULL como desejado). Isso significa que deletar um contato já deleta todas as conversas automaticamente, mas sem aviso ao usuário. Vamos mudar para SET NULL para dar controle ao usuário.

### 1. Migration: Alterar FK `conversations.contact_id`

Trocar `ON DELETE CASCADE` por `ON DELETE SET NULL`:

```sql
ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_contact_id_fkey 
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
```

### 2. Novo componente `src/components/shared/CascadeDeleteDialog.tsx`

Dialog reutilizável com checkboxes para entidades vinculadas. Recebe lista de `linkedEntities` com type, label, count, icon, checked. Entidades com count 0 não aparecem. Marcar "Contato" auto-marca todos os outros.

### 3. Novo hook `src/hooks/useCascadeDelete.ts`

Funções:
- `getConversationLinked(id)` — conta atividades, oportunidades, outras conversas do contato
- `getContactLinked(id)` — conta conversas, oportunidades, atividades
- `getOpportunityLinked(id)` — conta atividades, conversas do contato
- `deleteConversationCascade(id, contactId, toDelete[])` — delete ordenado
- `deleteContactCascade(id, toDelete[])` — delete ordenado
- `deleteOpportunityCascade(id, contactId, toDelete[])` — delete ordenado

Ordem segura: activities → conversations → opportunities → contact

### 4. Alterar `src/pages/InboxPage.tsx`

- Remover `confirmDeleteConversation` e o AlertDialog simples
- `handleDeleteConversation` vira async: busca vínculos antes de abrir o dialog
- Usar `CascadeDeleteDialog` com entidades do contato vinculado

### 5. Alterar `src/pages/PipelinePage.tsx`

- Remover `confirmDeleteOpportunity` e o AlertDialog simples
- `handleDeleteOpportunity` vira async: busca vínculos antes de abrir o dialog
- Usar `CascadeDeleteDialog`

### 6. Alterar `src/pages/ContactsPage.tsx`

- Substituir `handleDelete` (que usa `confirm()`) por `CascadeDeleteDialog`
- Adicionar estados para o dialog e dados de cascade
- Somente admin/manager pode deletar (já controlado por RLS)

### Arquivos

| Arquivo | Alteração |
|---|---|
| Nova migration SQL | Alterar FK para SET NULL |
| `src/components/shared/CascadeDeleteDialog.tsx` | Novo componente |
| `src/hooks/useCascadeDelete.ts` | Novo hook |
| `src/pages/InboxPage.tsx` | Substituir AlertDialog |
| `src/pages/PipelinePage.tsx` | Substituir AlertDialog |
| `src/pages/ContactsPage.tsx` | Substituir `confirm()` por CascadeDeleteDialog |

### O que NÃO muda

- RLS policies, permissões de role
- Fluxo de criação de entidades
- Messages cascade (já automático via FK)

