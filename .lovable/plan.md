

## Plano: Card "Horário de funcionamento" em Settings

### Exploração necessária antes de aplicar

Preciso confirmar a estrutura do `SettingsPage.tsx` para inserir o card no local correto. Vou ler:
- `src/pages/SettingsPage.tsx` — onde adicionar a seção
- `src/contexts/AuthContext.tsx` — como obter `tenant_id` e checar role admin
- Um componente settings existente (ex: `BrandingSettings.tsx`) para seguir o padrão visual e estrutural

### Estrutura de arquivos

**Criado:**
- `src/components/settings/BusinessHoursSettings.tsx` — novo card completo

**Alterado:**
- `src/pages/SettingsPage.tsx` — importar e renderizar `<BusinessHoursSettings />` dentro da aba/seção apropriada (provavelmente junto com Branding/Tags), com guard de role admin já existente na página.

**Não alterado:**
- `src/types/crm.ts` — `Tenant.timezone` e `business_hours` já existem
- `src/integrations/supabase/types.ts` — já regenerado pela migration anterior

### Componente `BusinessHoursSettings.tsx`

**Estrutura:**
```
<Card>
  <CardHeader>
    <CardTitle>Horário de funcionamento</CardTitle>
    <CardDescription>Configure fuso e dias/horários de atendimento</CardDescription>
  </CardHeader>
  <CardContent>
    [Select Timezone]              ← combo Brasil
    [Status atual]                 ← "Agora: 14:32 — dentro do expediente" (refresh 30s)
    [Grid 7 linhas: Seg..Dom]
      Checkbox "Aberto" | Input time "Abre" | Input time "Fecha"
    [Botão Salvar]
  </CardContent>
</Card>
```

**Estado:**
- `timezone: string`
- `days: Record<DayKey, { open: boolean; start: string; end: string }>` para os 7 dias
- `loading`, `saving`

**Timezones (combo):**
```
America/Sao_Paulo  → "São Paulo (UTC-3)"
America/Manaus     → "Manaus (UTC-4)"
America/Cuiaba     → "Cuiabá (UTC-4)"
America/Belem      → "Belém (UTC-3)"
America/Fortaleza  → "Fortaleza (UTC-3)"
America/Recife     → "Recife (UTC-3)"
America/Noronha    → "Noronha (UTC-2)"
America/Rio_Branco → "Rio Branco (UTC-5)"
```

**Lógica chave:**
- **Carga**: `supabase.from('tenants').select('business_hours, timezone').eq('id', tenantId).maybeSingle()`. Hidrata o estado: se chave do dia existe → `open=true` + start/end; senão `open=false` + defaults `09:00`/`18:00`.
- **Salvar**: monta `businessHours` apenas com dias `open=true`. Valida `end > start` (comparação string HH:MM funciona). `update tenants set business_hours, timezone where id = tenantId`. Toast via sonner.
- **Status atual**: `useEffect` com `setInterval(30_000)`, usa `Intl.DateTimeFormat` com `timeZone` selecionado para extrair `dayKey` (mon/tue/...) e `HH:MM`. Compara com a entrada do dia → "dentro" ou "fora".
- **Validação**: bloqueia salvar se algum dia aberto tiver `end <= start`.

**Permissão:**
- Ler role via `useAuth()` (ou hook equivalente já existente). Se `role !== 'admin'`, retorna `null` (card oculto).

**Acessibilidade:**
- `<Label htmlFor>` em cada input
- `aria-label` no Select de timezone
- Inputs `type="time"` nativos (suportam HH:MM e teclado)

### Localização final na UI

Card aparece em **`/settings`** (página existente `SettingsPage`), na mesma aba/seção das outras configurações de tenant (junto a Branding, Tags, Quick Replies, Knowledge Base). Será o último card da seção "Empresa/Tenant", visível apenas para admins.

### Restrições respeitadas

- ✅ shadcn-ui (`Card`, `Select`, `Checkbox`, `Input`, `Button`, `Label`) + Tailwind
- ✅ Sem libs novas — `Intl.DateTimeFormat` nativo
- ✅ Tipagem preservada (campos já existem em `Tenant`)
- ✅ Toast via sonner (padrão do projeto)
- ✅ Guard de admin via role existente

