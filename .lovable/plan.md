# Nova aba "Templates Meta" em Configurações

Adicionar uma aba dedicada na página de Configurações para listar, filtrar e re-sincronizar os templates baixados da WABA (Meta Cloud API).

## O que o usuário vai ver

- Nova aba **"Templates Meta"** na página `/settings`, ao lado das outras (Conexões, Branding, etc).
- Seletor de **instância Meta** no topo (caso o tenant tenha mais de uma conexão Meta Cloud).
- Botão **"Sincronizar agora"** que dispara `wa-meta-templates-sync` para a instância selecionada e recarrega a lista.
- **Filtros**: busca por nome + filtro por status (Todos / Aprovado / Pendente / Rejeitado / Pausado / Desabilitado) + filtro por idioma.
- **Tabela** com colunas:
  - Nome do template
  - Idioma (badge)
  - Categoria (MARKETING / UTILITY / AUTHENTICATION)
  - Status (badge colorido: verde=APPROVED, amarelo=PENDING, vermelho=REJECTED, cinza=PAUSED/DISABLED)
  - Última atualização
  - Ação: botão "Ver" que abre um modal com a pré-visualização do corpo, header, footer, botões e variáveis `{{n}}`.
- Estado vazio amigável quando não houver instância Meta configurada (com link para a aba Conexões) ou nenhum template sincronizado ainda.

## Como funciona por trás

- Lê direto da tabela existente `whatsapp_message_templates` filtrando por `tenant_id` + `whatsapp_instance_id`. RLS já cobre o acesso.
- Reaproveita a edge function existente `wa-meta-templates-sync` (sem mudanças).
- Componente novo `src/components/settings/MetaTemplatesCard.tsx` + modal `TemplatePreviewDialog.tsx`.
- Adicionar a aba/seção em `src/pages/SettingsPage.tsx` mantendo o padrão visual atual.
- Sem migrations, sem mudanças de schema, sem mudanças no backend.

## Fora do escopo (pode virar próximo passo)

- Criar / editar / submeter novos templates para aprovação Meta direto pelo app.
- Excluir templates da Meta a partir do app.
- Link "Abrir no Gerenciador da Meta" (pode ser adicionado depois se você quiser).
