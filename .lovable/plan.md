A logo padrão exibida para novos tenants (quando nenhuma branding customizada está configurada) é o arquivo `src/assets/logo.png`, usado como fallback em `AppSidebar.tsx`. A tela de login já utiliza a logo correta hospedada no Supabase Storage.

### O que será alterado

- **Arquivo:** `src/components/layout/AppSidebar.tsx`
- **Mudança:** Remover a importação de `defaultLogo` de `@/assets/logo.png` e substituir o fallback `branding.logo_url || defaultLogo` pela URL da logo da tela de login:
  ```
  https://zhywwrhzaqfcjcwywkwf.supabase.co/storage/v1/object/public/tenant-logos/logo-crm.png
  ```
- **Resultado:** Novos tenants (ou tenants sem branding configurada) passarão a exibir a mesma logo usada na tela de login, em vez da logo antiga empacotada no build.

Nenhuma outra alteração é necessária — a logo do login já está no local correto e demais partes do sistema usam `branding.logo_url` dinamicamente.