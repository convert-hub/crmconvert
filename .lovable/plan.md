# Ajustes no SendTemplateDialog e no picker de variáveis

Dois problemas pequenos no envio de template:

1. Quando um campo personalizado tem os dois escopos marcados (Contato + Oportunidade), ele aparece duas vezes no picker com o mesmo rótulo (`data_de_agendamento` × 2), sem como o usuário distinguir qual é qual.
2. Não há aviso visível quando o usuário escolhe uma variável que está vazia para aquele contato/oportunidade — só aparece `(x vazio)` discreto na pré-visualização.

## Mudanças

### 1. Diferenciar rótulo de campos personalizados — `src/lib/systemVariables.ts`
Em `customFieldVars`, mudar o `label` para incluir o escopo de origem:
- `contact.custom.data_de_agendamento` → label `data_de_agendamento (contato)`
- `opportunity.custom.data_de_agendamento` → label `data_de_agendamento (oportunidade)`

O `token` continua o mesmo, então nada quebra na resolução. Só o que o usuário vê no picker muda.

### 2. Aviso de "campo vazio" — `src/components/inbox/SendTemplateDialog.tsx`
Para cada slot do template cujo valor digitado é um token puro `{{x}}`:
- Reusar `resolveToken` (já existe) para checar se o valor resolvido é `null`.
- Quando vazio, mostrar abaixo do `VariableInput` um texto pequeno em `text-destructive`:  
  `⚠ Este campo está vazio para {contact.name ?? "este contato"}. A Meta vai rejeitar o envio.`
- Bloquear o botão **Enviar** quando houver qualquer slot com token vazio (somando ao `missingCount` atual), e mostrar toast explicativo se o usuário tentar.

## Fora de escopo
- Não muda o storage dos campos (continuam dois sets em `tenants.settings`).
- Não muda outros lugares que usam o picker (flow, campanha) — o sufixo `(contato)`/`(oportunidade)` é útil em todos, então o ajuste em `systemVariables.ts` se aplica naturalmente.
- Não tenta auto-preencher o valor: o slot continua mostrando o token escolhido, só ganha o aviso.

## Validação
- Criar campo `data_de_agendamento` com ambos toggles → picker mostra duas entradas distintas com sufixo.
- Selecionar variável de contato sem valor naquele contato → aviso vermelho aparece, botão Enviar desabilita.
- Preencher manualmente o slot → aviso some, Enviar reabilita.
