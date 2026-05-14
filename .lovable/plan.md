Refatorar a navegação da página de Configurações (`src/pages/SettingsPage.tsx`) de tabs horizontais flex-wrap para uma sidebar vertical com agrupamento por seção, mais responsividade mobile.

## Alterações no arquivo `src/pages/SettingsPage.tsx`

### 1. Imports

- Adicionar ícones novos do lucide-react: `Settings2`, `Palette`, `GitBranch`, `SlidersHorizontal`, `Users`, `Tag`, `Zap`, `FileText`, `Brain`, `BookOpen`, `Plug`.
- Remover os que deixarem de ser usados se necessário (preservar os demais).

### 2. Estado

- Introduzir `const [activeTab, setActiveTab] = useState("general")`.
- Trocar `<Tabs defaultValue="general">` por `<Tabs value={activeTab} onValueChange={setActiveTab}>`.

### 3. Layout desktop (md+)

- Aumentar container de `max-w-5xl` para `max-w-6xl`.
- Substituir o `<TabsList>` horizontal atual (linhas 456-468) por uma sidebar vertical dentro de `<div className="hidden md:block w-48 shrink-0">`.
- Agrupar itens em 5 seções com rótulos em `text-xs uppercase text-muted-foreground`:
  - **Geral**: Geral, Marca, Pipeline, Campos
  - **Equipe**: Membros
  - **Comunicação**: Tags, Respostas Rápidas, Templates Meta
  - **Inteligência**: IA, Base de Conhecimento
  - **Sistema**: Integrações
- Cada `TabsTrigger` deve ser `flex flex-row justify-start rounded-lg px-3 py-2 h-auto` com ícone à esquerda e texto, e `data-[state=active]:bg-muted`.

### 4. Layout mobile (< md)

- Acima do conteúdo, renderizar um `<Select value={activeTab} onValueChange={setActiveTab}>` visível apenas em `block md:hidden`.
- O Select conterá os mesmos 11 valores com rótulos legíveis (ex: "Campos" ou "Campos Personalizados").

### 5. Estrutura de conteúdo

- Envelopar a sidebar + conteúdo em `<div className="flex gap-6">`.
- Os `<TabsContent>` existentes permanecem intactos dentro de `<div className="flex-1 min-w-0">`.
- Nenhuma lógica interna dos painéis (estados, funções, permissões) será modificada.

### 6. Semântica preservada

- Manter os `value` dos `TabsTrigger` exatamente como estão (`general`, `branding`, `pipeline`, `custom_fields`, `team`, `ai`, `tags`, `quick_replies`, `knowledge`, `integrations`, `meta_templates`).
- Manter o controle de permissões (`isAdmin`) que condicionalmente desabilita ações dentro dos painéis.  
  
**Adendo importante:**
  1. **Não colocar** `<span>` **de rótulo de seção dentro do** `<TabsList>` — O Radix Tabs espera apenas `TabsTrigger` como filhos do `TabsList`, e elementos extras quebram a navegação por teclado (arrow keys). Em vez disso, usar a sidebar como uma `<nav>` com botões comuns estilizados que chamam `setActiveTab(value)`, e manter o `<TabsList>` oculto (`className="hidden"`) apenas para preservar a semântica do componente `<Tabs>`. Os rótulos de seção ficam como `<p>` ou `<span>` fora do `TabsList`.
  2. **Aumentar a largura da sidebar de** `w-48` **para** `w-56` — Nomes como "Base de Conhecimento" e "Respostas Rápidas" truncam em 192px com padding + ícone. 224px (`w-56`) garante que todos os labels caibam sem quebrar linha.