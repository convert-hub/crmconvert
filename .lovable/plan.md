## Problema

A tela ainda mostra `tem etapas diferentes em N linhas`, mas o código atual que está no arquivo já não deveria mais gerar essa mensagem. Isso indica uma destas causas:

1. o preview/tenant ainda está rodando bundle antigo em cache; ou
2. ainda existe lógica residual no mesmo componente que precisa ser removida/neutralizada; ou
3. o estado anterior do modal/importação está sendo mantido após a atualização.

## Plano

1. **Remover a possibilidade do erro antigo aparecer**
   - Procurar qualquer geração restante de `tem etapas diferentes` no importador.
   - Se existir, remover.
   - Se não existir, adicionar uma normalização final antes de exibir o resultado para filtrar esse motivo antigo da lista de erros.

2. **Endurecer a regra de seleção de etapa**
   - Para contatos repetidos no arquivo, manter a escolha automática da última etapa válida da planilha.
   - Etapas sem match no pipeline continuam sendo ignoradas silenciosamente.
   - Contatos com várias etapas válidas diferentes não geram mais erro.

3. **Evitar estado velho no modal**
   - Ao abrir/fechar ou iniciar nova importação, limpar `importResult`, `conflicts`, progresso e estado anterior que possa estar reaparecendo.

4. **Validar a origem do problema**
   - Confirmar por busca no código que a frase antiga não existe mais em nenhum caminho ativo.
   - Validar que os únicos erros restantes são dados realmente inválidos, como telefone curto/lixo.

## Resultado esperado

Na mesma planilha da captura, os erros de `tem etapas diferentes` deixam de aparecer. Devem permanecer apenas falhas reais como `Telefone com menos de 8 dígitos`.