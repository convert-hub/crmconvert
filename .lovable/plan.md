## Diagnóstico

O erro voltou em outro tenant porque a correção anterior só ignora nomes de etapa sem match **se eles não coincidirem com uma etapa real do pipeline selecionado**.

Neste tenant, termos da planilha como `PERDIDO` e possivelmente `NOVO LEAD` parecem existir como etapas reais no pipeline. Por isso o importador entende que o mesmo contato tem múltiplas etapas válidas, por exemplo:

- `IMPLANTE- CONTATO LEADS` + `PERDIDO`
- `NOVO LEAD` + `PERDIDO`
- `NOVO LEAD` + `IMPLANTE- CONTATO LEADS`

Então não é mais apenas “etapa inválida”; é conflito real entre etapas que o sistema reconhece.

## Plano de correção

1. **Tratar contatos duplicados com múltiplas etapas válidas sem gerar erro**
   - Para cada contato deduplicado por telefone/email, manter todas as linhas, mas escolher automaticamente uma única etapa válida.
   - Usar a etapa válida da **última linha da planilha** como vencedora, porque normalmente a planilha exportada já traz a informação mais recente por último.

2. **Continuar ignorando etapas que não existem no pipeline**
   - Se um contato tiver etapas inválidas misturadas com uma etapa válida, criar a oportunidade na etapa válida.
   - Se todas as etapas forem inválidas, criar/atualizar apenas o contato e não criar oportunidade.

3. **Não registrar erro para conflito de etapas dentro da própria planilha**
   - Remover o erro `tem etapas diferentes em N linhas` para duplicidades internas do CSV.
   - Manter erros reais de dados, como telefone inválido (`+`, `8`, `1`, `162536`, etc.), porque esses dados não identificam um contato importável por telefone.

4. **Preservar conflitos contra oportunidades já existentes no CRM**
   - Se já existir oportunidade aberta para o contato em outra etapa, manter o fluxo atual de conflito/atualização, pois isso é uma decisão operacional diferente de duplicidade na planilha.

## Resultado esperado

- `REPETIDOS`, `NÃO VAMOS PERSEGUIR` e etapas inexistentes: ignoradas silenciosamente.
- Duplicados com `NOVO LEAD`, `PERDIDO`, `IMPLANTE- CONTATO LEADS`, etc.: não entram mais como erro; o importador escolhe uma etapa automaticamente.
- Os erros restantes devem cair para casos realmente inválidos, principalmente telefones curtos ou lixo na coluna de telefone.