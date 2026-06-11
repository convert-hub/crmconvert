# Corrigir importação de contatos (CSV)

## Diagnóstico
A planilha da Patrícia (51 linhas) gerou apenas 19 contatos com as tags esperadas. A investigação no banco e no código de `ImportContactsDialog.tsx` apontou três falhas concorrentes:

1. **Tags sobrescritas no dedup.** Quando o telefone já existe (incluindo telefones repetidos *dentro do mesmo CSV*), o `update` substitui o array `tags` inteiro. Contatos que apareciam em mais de uma aba/seção da planilha perderam todas as tags exceto a última processada — exatamente o padrão observado (`NUNCA RESPONDEU = 0`, `VNFM = 4` em vez de 12, `NV = 12` em vez de 36).
2. **Parser CSV ingênuo.** `lines[i].split(delimiter)` não respeita aspas. Campos como `"Silva, Jr."` deslocam colunas, telefone vira lixo, `normalizeBrazilPhone` devolve `''`, e a linha vira um contato sem telefone (sem dedup) ou falha silenciosamente.
3. **Erros invisíveis.** O `catch { errors++ }` engole o motivo. A usuária nunca soube que houve falhas — o toast só mostra "X criados, Y atualizados".

## Correções

### 1. Mesclar tags em vez de sobrescrever
No bloco de `update` do `handleImport`, buscar o contato existente com `tags` (não só `id`) e fazer união dos arrays antes do update. Mesmo tratamento para *segunda ocorrência do mesmo telefone dentro do próprio CSV* — manter um `Map<phone, accumulatedTags>` em memória durante o batch para que duplicatas internas também acumulem.

Regra de merge:
- `tags = unique([...existing.tags, ...row.tags])` (case-insensitive na comparação, mantendo a grafia original já cadastrada)
- Demais campos (`name`, `email`, `city`, etc.) continuam com comportamento atual: só sobrescreve se a linha trouxer valor; nunca apaga com vazio.

### 2. Parser CSV que respeita aspas
Substituir `split(delimiter)` por um parser linha-a-linha que entenda:
- Campos entre aspas duplas (`"..."`), com aspas escapadas (`""`)
- Delimitador dentro de aspas (`"Silva, Jr."`)
- Quebras de linha CRLF/LF
- Detecção automática de `,` vs `;` mantida (heurística atual)

Mantém-se a abordagem 100% client-side, sem dependência nova.

### 3. Auto-criar tags novas no cadastro do tenant
Hoje as tags vão direto para `contacts.tags` (string[]) sem registrar em `tenants.settings.tags`. Confirmado com a usuária que tags inéditas devem aparecer automaticamente em **Configurações → Tags** com cor padrão.

Ao final do import:
- Coletar todas as tags únicas usadas (case-insensitive, comparando com as já cadastradas)
- Para cada tag nova, anexar em `tenants.settings.tags` com uma cor sorteada da paleta existente (`PRESET_COLORS` de `TagsSettings.tsx`)
- Um único `update` em `tenants` ao fim, evitando race.

### 4. Relatório de erros visível
- Trocar `catch { errors++ }` por `catch (e) { errors.push({ row: i, reason: e.message }) }`
- Tela final do dialog passa a listar até 20 linhas com falha (linha do CSV + motivo curto) e oferece botão "Baixar relatório completo (CSV)"
- Console.error de cada falha para facilitar suporte futuro

### 5. Normalização defensiva
- Se `normalizeBrazilPhone` devolver `''` e a linha trouxer telefone original não vazio, marcar a linha como erro ("telefone inválido: <valor>") em vez de inserir contato sem telefone silenciosamente.
- Linha sem telefone *e* sem email continua aceita (cria contato só com nome), mas é contabilizada separadamente no relatório.

## Arquivos afetados
- `src/components/contacts/ImportContactsDialog.tsx` — parser, merge de tags, relatório de erros, criação automática de tags
- Nenhuma migração de banco (índices e constraints atuais já são adequados)
- Nenhuma mudança em edge functions ou worker

## Validação manual sugerida após implementação
1. Reimportar a mesma planilha da Patrícia (sem apagar os 19 atuais — a lógica de merge vai completar tags faltantes nos existentes e criar os que faltam).
2. Conferir contagens: `NV - 11/06/2026 = 36`, `VNFM - 11/06/2026 = 12`, `NUNCA RESPONDEU = 3`.
3. Verificar em **Configurações → Tags** se as 3 tags continuam listadas (não duplicadas) e com a cor original.
4. Conferir a tela de "Importação concluída" mostrando 0 erros (ou listando os motivos, caso a planilha original tenha linhas inválidas reais).
