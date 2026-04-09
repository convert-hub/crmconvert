

## Plano: Convite de Membros via Plataforma

### 1. Nova Edge Function `supabase/functions/invite-member/index.ts`

- Recebe `{ email, full_name, role }` + header `x-tenant-id`
- Valida JWT do chamador via `supabase.auth.getUser(token)`
- Verifica que chamador é admin do tenant via service role client
- Fluxo:
  - Se usuário já existe no auth e já é membro ativo: retorna 409
  - Se existe mas inativo: reativa com novo role
  - Se existe mas não é membro: cria membership
  - Se não existe: `auth.admin.inviteUserByEmail` + cria profile + cria membership
- Usa `SUPABASE_SERVICE_ROLE_KEY` para operações admin
- CORS headers padrão

### 2. Alterar `src/pages/SettingsPage.tsx`

- Adicionar estados: `inviteDialogOpen`, `inviteEmail`, `inviteName`, `inviteRole`, `inviteLoading`
- Adicionar função `handleInviteMember` que chama `supabase.functions.invoke('invite-member', ...)`
- Linha 591: adicionar botão "Convidar Membro" no CardHeader (mesmo padrão do botão da aba IA)
- Linha 616: remover o `<p>` placeholder e substituir pelo Dialog de convite com campos nome, email, role e botão enviar

### Arquivos

| Arquivo | Alteração |
|---|---|
| `supabase/functions/invite-member/index.ts` | Nova edge function |
| `src/pages/SettingsPage.tsx` | Dialog de convite + handler |

### O que NÃO muda

- AuthContext, Onboarding, loadAll, updateMemberRole, removeMember
- Tabelas e RLS (já suportam o fluxo via service role)

