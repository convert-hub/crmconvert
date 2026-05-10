## Problema

Ao abrir "Adicionar conexão" em Configurações → WhatsApp Oficial (Meta Cloud API), basta o usuário clicar fora do diálogo (ou voltar de outra aba/janela onde foi copiar credenciais da Meta) para o diálogo fechar e perder o que estava digitado.

Causas:
1. O Radix `Dialog` fecha automaticamente em três eventos: clique fora (`pointerDownOutside`), interação fora (`interactOutside`) e tecla `Esc`. Ao alternar entre abas/janelas para copiar credenciais, o navegador frequentemente dispara um `pointerDown` no overlay quando o foco volta, fechando o diálogo.
2. Os campos `Phone Number ID`, `WABA ID`, `Access Token` e `App Secret` ficam apenas em estado local do componente; ao fechar o diálogo, esses valores são perdidos.

## Solução

Ajuste único e localizado no componente do diálogo de cadastro Meta. Sem mudanças de regra de negócio, sem mudanças no backend.

### 1. Travar o auto-fechamento do diálogo Meta

Em `src/components/settings/MetaCloudConnectionsCard.tsx`, no `<DialogContent>` do diálogo "Adicionar conexão Meta Cloud API":

- Adicionar `onPointerDownOutside={(e) => e.preventDefault()}`
- Adicionar `onInteractOutside={(e) => e.preventDefault()}`
- Adicionar `onEscapeKeyDown={(e) => e.preventDefault()}`

Resultado: o diálogo só fecha pelos botões "Cancelar" ou "Salvar" (ou pelo ícone de fechar nativo do Radix, se desejado, mas o usuário pode controlar via clique no X).

### 2. Preservar o que foi digitado mesmo se fechar

Persistir o rascunho do formulário em `sessionStorage` enquanto o diálogo está aberto:

- Ao montar o diálogo, hidratar os campos a partir de `sessionStorage` (chave `meta_connection_draft_<tenantId>`).
- A cada `onChange` dos inputs, gravar o objeto atualizado em `sessionStorage` (debounce simples de 200 ms).
- Ao salvar com sucesso ou ao clicar em "Cancelar", limpar a chave do `sessionStorage`.

Assim, mesmo numa eventual remontagem (refresh, troca de aba longa que descarta a aba pelo navegador, etc.), o usuário recupera os dados que digitou ao reabrir o diálogo.

### 3. Pequeno ajuste UX

- Manter o `<Input type="password">` para Access Token e App Secret (já está).
- Adicionar `autoComplete="off"` em todos os inputs do formulário Meta para evitar interferência do gerenciador de senhas do navegador.

## Arquivos afetados

- `src/components/settings/MetaCloudConnectionsCard.tsx` (apenas frontend)

Nada mais é tocado: nenhuma migration, nenhuma Edge Function, nenhum hook global, nenhuma mudança em `SettingsPage.tsx` ou `AuthContext.tsx`.

## Detalhes técnicos

- A causa raiz não é o polling/cron — `AuthContext` tem guarda `dataLoaded` que evita recarregar dados em `TOKEN_REFRESHED`, e `SettingsPage` só recarrega em mudança de `tenant`. O componente Meta não é desmontado por re-render normal.
- O culpado é o comportamento padrão do Radix `Dialog` que fecha em qualquer `pointerDownOutside`. Ao retornar de outra janela, o primeiro clique dentro do iframe (mesmo que para focar) é interpretado como "fora do conteúdo do diálogo".
- `preventDefault` em `onPointerDownOutside` é o padrão recomendado pela documentação do Radix para diálogos onde a perda acidental de dados é inaceitável (formulários longos, fluxos de credenciais).