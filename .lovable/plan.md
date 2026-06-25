# Plano — Fluxo de redefinição de senha (revisado)

Implementar o fluxo ponta-a-ponta: link "Esqueci minha senha" na tela de login + página pública `/update-password` para definir a nova senha após clicar no link do e-mail enviado pelo Supabase.

## Arquivos alterados

### 1. `src/pages/Login.tsx` (alterar)
- Adicionar estado local: `forgotOpen`, `forgotEmail`, `forgotLoading`.
- Adicionar link discreto **"Esqueci minha senha"** logo abaixo do botão "Entrar" (apenas na aba de login), estilo `text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline`, alinhado ao centro.
- Ao clicar, abrir `<Dialog>` (shadcn) com:
  - Título: "Redefinir senha"; descrição: "Informe seu e-mail para receber o link de redefinição."
  - `Input` de e-mail + `Label`.
  - Botão "Enviar link" chama:
    ```ts
    await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    ```
  - **Sempre** mostrar o mesmo toast genérico ("Se o e-mail existir, enviaremos um link de redefinição."), independente de erro/sucesso, para evitar enumeração de usuários. Erro vai só para `console.error`.
  - Fechar dialog e limpar campo após envio.

### 2. `src/pages/UpdatePassword.tsx` (criar)
- Layout idêntico ao `Login.tsx` (mesmo `Card`, logo, `max-w-sm`).
- Estado: `password`, `confirmPassword`, `loading`, `canUpdate` (bool|null — `null` = ainda verificando), `hasRecoveryHash` (bool).

**Detecção de recovery (revisada):**
- No mount (`useEffect`):
  1. Ler `window.location.hash` — se contiver `type=recovery`, setar `hasRecoveryHash=true`. Esse é o sinal forte de que o usuário chegou por link legítimo; a partir daqui aguardamos a sessão sem timer agressivo.
  2. Registrar listener `supabase.auth.onAuthStateChange((event, session) => { if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) setCanUpdate(true); })`.
  3. Chamar `supabase.auth.getSession()` como confirmação inicial — se já houver sessão, setar `canUpdate=true` imediatamente.
  4. Decisão de "link inválido":
     - Se **não há** `type=recovery` no hash **E** `getSession()` retornou `null` → setar `canUpdate=false` imediatamente (acesso direto sem token).
     - Se **há** `type=recovery` no hash → manter `canUpdate=null` (estado de carregamento) e esperar o listener. Fallback opcional de **3s** apenas para mostrar mensagem amigável caso o Supabase falhe silenciosamente; sem o fallback, o usuário ficaria no spinner indefinidamente.
  5. Cleanup: `subscription.unsubscribe()` e limpar o timer.

**Renderização condicional:**
- `canUpdate === null` → spinner centralizado ("Validando link…").
- `canUpdate === false` → mensagem "Link inválido ou expirado" + botão "Voltar ao login" (`navigate('/login')`).
- `canUpdate === true` → formulário:
  - `Input type="password"` "Nova senha" (`minLength={6}`, required).
  - `Input type="password"` "Confirmar senha" (required).
  - Validação no submit: ambos preenchidos, mínimo 6 caracteres, iguais; caso contrário, toast de erro e abortar.
  - Submit: `await supabase.auth.updateUser({ password })`.
  - Sucesso → toast "Senha atualizada com sucesso" + `supabase.auth.signOut()` + `navigate('/login')`.
  - Erro → toast com `error.message`.

### 3. `src/App.tsx` (alterar)
- Importar `UpdatePassword`.
- Adicionar rota **pública** (fora de `ProtectedRoute`), próxima a `/login` e `/flow/install/:token`:
  ```tsx
  <Route path="/update-password" element={<UpdatePassword />} />
  ```

## Detalhes técnicos importantes

- O Supabase envia o link com hash `#access_token=...&type=recovery`. Com `persistSession: true` (já configurado em `client.ts`), o cliente processa o hash automaticamente e dispara `PASSWORD_RECOVERY`. A rota **precisa ser pública** — `ProtectedRoute` poderia redirecionar antes do hash ser processado.
- O critério primário de "link válido" é o **próprio hash da URL**, não um timer. Conexões lentas não causam mais falso negativo.
- `signOut()` após atualização força login limpo com a nova senha e evita estado ambíguo de sessão de recovery.
- Toast genérico no "esqueci minha senha" previne enumeração de usuários.

## Fora do escopo

- `ProtectedRoute.tsx`, `AuthContext.tsx`, lógica de WhatsApp/UAZAPI/leads, edge functions, templates de e-mail do Supabase.

## Validação após implementação

1. `/login` → "Esqueci minha senha" → e-mail → toast → e-mail chega.
2. Clicar no link → `/update-password` mostra formulário (não "link inválido"), mesmo em conexão lenta.
3. Definir nova senha → toast sucesso → `/login` → login com nova senha funciona.
4. Abrir `/update-password` diretamente sem hash → "Link inválido ou expirado" imediato.

## Resumo de arquivos

- **Criados:** `src/pages/UpdatePassword.tsx`
- **Alterados:** `src/pages/Login.tsx`, `src/App.tsx`
