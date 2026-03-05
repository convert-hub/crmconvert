

## Como acionar as Respostas Rápidas

As respostas rápidas já estão implementadas no ChatPanel e podem ser acionadas de **duas formas**:

### 1. Digitando `/` no campo de mensagem
Ao digitar `/` no campo de texto do chat, um dropdown aparece automaticamente com todas as respostas rápidas cadastradas. Conforme você continua digitando (ex: `/saud`), a lista é filtrada em tempo real pelo atalho ou título. Clique na opção desejada e o conteúdo será inserido no campo com as variáveis (`{{nome}}`, `{{telefone}}`, `{{email}}`) já substituídas pelos dados do contato.

### 2. Botão de raio (⚡) na barra de mensagem
Ao lado do campo de texto, há um botão com ícone de raio (Zap). Ao clicar, o mesmo dropdown de respostas rápidas abre para seleção.

### Pré-requisito
Para que as opções apareçam, é necessário primeiro cadastrar respostas rápidas em **Configurações > Respostas Rápidas** (disponível para admin/manager). Sem templates cadastrados, o botão de raio não aparece e o `/` não abre nenhum dropdown.

### Resumo do fluxo
```text
Configurações > Respostas Rápidas > [+ Nova]
  → Atalho: saudacao
  → Conteúdo: "Olá {{nome}}, tudo bem?"

Inbox > Chat > digita "/saudacao" ou clica ⚡
  → Seleciona template
  → Campo preenchido: "Olá João, tudo bem?"
  → Envia normalmente
```

