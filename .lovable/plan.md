## Diagnóstico forense

A planilha do print evidencia **3 falhas combinadas**:

### 1. Encoding errado (raiz dos "nomes de coluna estranhos")
O arquivo está salvo em **Windows-1252 / Latin-1**, não UTF-8. Aparecem `ComentÃ¡rios`, `Ãšltima Atividade`, `AraÃºjo`, `NÃ£o`, `MunicÃ­pio`. O importador atual força `reader.readAsText(file, 'UTF-8')` em `ImportContactsDialog.tsx`, então todos os acentos viram mojibake — inclusive dentro dos valores de etapa (`MunicÃ­pio` em vez de `Município`), o que faz **0% das etapas baterem** com o pipeline.

### 2. Coluna "Status (Etapa)" mapeada como pipeline, sem tolerância
O auto-mapeamento (`guessMapping`) testa `^status` antes de `^etapa`, então `Status (Etapa)` cai em `status` (errado). Quando o usuário corrige para `pipeline_stage`, a comparação é exata por `normKey` — qualquer divergência (acento mojibake, espaço, parêntese) gera o erro *"Etapa X não corresponde a nenhuma etapa do pipeline"* para **todas as 2000 linhas**.

### 3. Arquivo é CSV salvo com extensão `.xlsx`
O print mostra "uma célula por linha" (tudo concentrado na coluna A) — o Excel abriu CSV bruto. O importador hoje só lê CSV via `FileReader.readAsText`; se o usuário enviar um `.xlsx` real (binário), o parser quebra silenciosamente.

---

## Plano de correção

### A. Detecção automática de encoding (`ImportContactsDialog.tsx`)
- Substituir `readAsText(file, 'UTF-8')` por `readAsArrayBuffer` + tentativa em UTF-8 e fallback para **Windows-1252** (heurística: se aparecer `Ã`/`Â` em headers ou primeiras 50 linhas, redecodificar).
- Aplica a headers **e** valores — corrige `MunicÃ­pio` → `Município` antes do match de etapa.

### B. Suporte a `.xlsx` real
- Adicionar `xlsx` (SheetJS) como dependência.
- Detectar por extensão / magic bytes: `.xlsx` → `XLSX.read(buffer)`; CSV continua no parser atual.

### C. Auto-mapeamento mais tolerante
- Reordenar regex em `guessMapping`: `etapa|pipeline|fase|funil|status.?\(etapa\)|status.?etapa` **antes** de `^status`.
- Normalizar header removendo parênteses/pontuação antes de comparar.

### D. Etapa "Status (Etapa)" — não falhar a linha inteira
Hoje, etapa inválida → erro na linha, contato **não é importado**. Mudar para:
- **Importar o contato sempre** (criar/atualizar).
- Falha de etapa vira aviso separado, não bloqueia o contato.
- Na tela de mapping, mostrar **preview das etapas únicas da coluna** com badge ✓/✗ contra o pipeline selecionado, e botão **"Criar etapas faltantes"** (insere `ENVIAR PROPOSTA`, `PROPOSTA ENVIADA`, `LEAD RECEBIDO` no pipeline alvo).

### E. Diagnóstico do erro (memória do usuário: root-cause antes de fix)
- Mensagem de erro passa a incluir: header bruto detectado, encoding usado, e — em caso de etapa não-bate — listar as etapas únicas que falharam vs. as etapas existentes no pipeline.

### F. Relatório de erros exportável
Botão "Baixar relatório" na tela final → CSV com linha, motivo e dados originais. Facilita reenvio só do que falhou.

---

## Arquivos afetados

- `src/components/contacts/ImportContactsDialog.tsx` — encoding, XLSX, mapping, preview de etapas, relatório.
- `package.json` — adiciona `xlsx`.
- Nenhuma mudança em banco/edge function.

## O que NÃO muda

- Estrutura de `contacts`, `opportunities`, `stages`.
- Lógica de deduplicação por telefone/email.
- RLS / permissões.
