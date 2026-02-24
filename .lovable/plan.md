

## Remover o Modulo de Empresas

### Objetivo
Eliminar completamente a pagina de Empresas e seu item no menu lateral, simplificando a interface do CRM.

### Alteracoes

**1. Remover rota do App (`src/App.tsx`)**
- Remover o import de `CompaniesPage`
- Remover a linha `<Route path="companies" element={<CompaniesPage />} />`

**2. Remover item do menu lateral (`src/components/layout/AppSidebar.tsx`)**
- Remover o import do icone `Building2` (se nao usado em outro lugar)
- Remover o item `{ icon: Building2, label: 'Empresas', path: '/companies' }` do array `navItems`

**3. Excluir o arquivo da pagina**
- Deletar `src/pages/CompaniesPage.tsx`

### Resultado
O menu lateral nao exibira mais o link "Empresas" e a rota `/companies` deixara de existir. Se futuramente precisar de empresas, o campo personalizado nos contatos sera suficiente.
