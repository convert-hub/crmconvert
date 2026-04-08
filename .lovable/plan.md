

## Plano: Desativar task types não funcionais e melhorar UX de keywords para leads

### Parte 1 — Ocultar `qa_review` e `stage_classifier` da UI

**3 arquivos editados, sem alteração no banco:**

| Arquivo | Alteração |
|---|---|
| `src/pages/PromptStudioPage.tsx` | Remover `qa_review` e `stage_classifier` do array `TASK_TYPES` (linhas 18, 20). Adicionar comentário TODO |
| `src/pages/SettingsPage.tsx` | Remover `qa_review` e `stage_classifier` de `AI_TASK_LABELS` (linha 31). Adicionar comentário TODO |
| `src/pages/admin/AdminApis.tsx` | Remover `qa_review` e `stage_classifier` de `taskTypeLabels` (linhas 224, 226) e dos `<SelectItem>` (linhas 407, 409). Adicionar comentário TODO |

### Parte 2 — Melhorar UX de palavras-chave para leads

**Arquivo: `src/pages/SettingsPage.tsx`**

1. **Atualizar textos** (linhas 384-386, 406):
   - CardTitle: "Palavras-chave e Frases para Leads"
   - CardDescription: explicitar que aceita frases completas (ex: "quero comprar", "qual o preço")
   - Placeholder do input: `Ex: preço, quero comprar, qual o valor, tenho interesse...`

2. **Adicionar campo "Testar frase"** abaixo do input de adicionar keyword:
   - Input com placeholder "Digite uma frase para testar..."
   - Botão "Testar"
   - Lógica client-side: normaliza a frase (lowercase, remove acentos via `normalize('NFD').replace(...)`) e verifica `includes` contra cada keyword cadastrada
   - Exibe resultado: "Faria match com: [keyword]" em verde, ou "Nenhum match" em vermelho
   - Usa a mesma lógica de normalização do worker para consistência

3. **Função auxiliar `removeAccents`** inline no componente:
   ```typescript
   const removeAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
   ```

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `src/pages/PromptStudioPage.tsx` | Ocultar 2 task types |
| `src/pages/SettingsPage.tsx` | Ocultar 2 task types + melhorar UX keywords + campo testar frase |
| `src/pages/admin/AdminApis.tsx` | Ocultar 2 task types |

