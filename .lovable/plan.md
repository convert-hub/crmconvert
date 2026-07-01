## Objetivo
Mover os dados pessoais do usuário (nome, telefone) de Configurações > Geral para um modal acessível pelo bloco do usuário na sidebar. Configurações fica só com dados da EMPRESA.

## Arquivos

**Novo:** `src/components/layout/ProfileDialog.tsx`
- Dialog do shadcn. Título: "Meus dados".
- Estado local + `useEffect` que lê `profiles.full_name, phone` do usuário logado (mesmo padrão do `ProfileSettingsCard`).
- Campos:
  - Nome completo — editável.
  - Telefone (WhatsApp) — editável, validado por `normalizeBrazilPhone` (`@/lib/phone`).
  - E-mail — somente leitura, vindo de `user.email` (via `useAuth`).
  - Função (role) — badge somente leitura.
- Botão "Salvar" faz `update` em `profiles where user_id = auth.uid()`, toast sonner, fecha o modal e chama um callback `onSaved` pra sidebar atualizar o nome exibido.
- Reaproveita integralmente a lógica de `ProfileSettingsCard` (mesma query, mesma validação, mesmo update) — não duplica regra.

**Editado:** `src/components/layout/AppSidebar.tsx`
- Adiciona `useState` para `profileOpen` e um `refreshKey` local pra forçar releitura do nome depois de salvar (ou usa `profile` do contexto se ele expuser refresh; se não, mantém um estado `displayName` sincronizado).
- Refatora o bloco `{/* User */}` em DOIS elementos irmãos dentro do mesmo container flex:
  1. `<button onClick={() => setProfileOpen(true)}>` envolvendo APENAS avatar + nome + role. Classes: `flex-1 flex items-center gap-3 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-accent transition-colors text-left`.
  2. `<button onClick={signOut}>` do LogOut permanece SEPARADO, fora do primeiro botão, como já é hoje.
- Renderiza `<ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />` no fim do aside.

**Conflito clique logout × modal:** resolvido estruturalmente porque os dois botões são irmãos, não aninhados. HTML nem permite `<button>` dentro de `<button>`, então o logout não pode disparar o modal, e vice-versa. Nenhum `stopPropagation` necessário.

**Editado:** `src/pages/SettingsPage.tsx`
- Remove o import e o uso de `<ProfileSettingsCard />` na aba `value="general"`.
- Mantém a aba Geral (com os demais cards da empresa).

**Deletado:** `src/components/settings/ProfileSettingsCard.tsx`
- Conteúdo migra pro `ProfileDialog`. Não há outros consumidores (grep já confirmado no contexto).

## Atualização do nome na sidebar após salvar
O `AuthContext` já expõe `profile`. Duas opções:
- (Preferida) `ProfileDialog` recebe `onSaved(newName)` e a sidebar mantém um `displayName` local que sobrescreve `profile?.full_name` até o próximo reload — evita mexer no AuthContext.
- Se `AuthContext` tiver um `refreshProfile()`, chamar ele. Vou checar em build; se não existir, uso a opção local.

## Não-alvo
- Notificações de lead: intocadas.
- Logout: comportamento idêntico.
- Aba Configurações > Geral: continua existindo, só sem o card pessoal.
- E-mail: somente leitura nesta versão (edição fica pra depois — envolve `supabase.auth.updateUser`).