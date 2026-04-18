

## Plano: Variáveis de business hours no template do `ai-generate`

Adicionar 3 variáveis ao prompt template: `{{business_hours_status}}`, `{{business_hours_human}}`, `{{current_datetime_local}}`.

### Arquivo único: `supabase/functions/ai-generate/index.ts`

**1. Após `// 4. Fetch contact info`** (logo depois de derivar `contactContext`), inserir:

```ts
// 4b. Fetch tenant business hours + timezone
const { data: tenant } = await supabase
  .from('tenants')
  .select('business_hours, timezone')
  .eq('id', tenant_id)
  .maybeSingle();

const timezone = tenant?.timezone || 'America/Sao_Paulo';
const businessHours = (tenant?.business_hours as Record<string, { start?: string; end?: string }>) || {};

let businessHoursStatus = 'fora';
let businessHoursHuman = 'horário não configurado';
let currentDatetimeLocal = '';
let dayKey = '';
let currentTime = '';

try {
  const now = new Date();
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
  const dateFmtPt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, weekday: 'long', day: '2-digit', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  dayKey = dayFmt.format(now).toLowerCase().slice(0, 3);
  currentTime = timeFmt.format(now);
  currentDatetimeLocal = dateFmtPt.format(now);

  const todayEntry = businessHours[dayKey];
  if (todayEntry?.start && todayEntry?.end && currentTime >= todayEntry.start && currentTime < todayEntry.end) {
    businessHoursStatus = 'dentro';
  }

  const dayLabels: Record<string, string> = {
    mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom',
  };
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hasAny = order.some(k => businessHours[k]?.start && businessHours[k]?.end);
  if (hasAny) {
    businessHoursHuman = order.map(k => {
      const e = businessHours[k];
      return e?.start && e?.end ? `${dayLabels[k]} ${e.start}-${e.end}` : `${dayLabels[k]} fechado`;
    }).join(', ');
  }
} catch (e) {
  console.error('[ai-generate] business_hours computation failed:', e);
}

console.log(`[ai-generate] business_hours: status=${businessHoursStatus} day=${dayKey} time=${currentTime} tz=${timezone}`);
```

**2. No bloco `// 9. Build system prompt`**, encadear 3 `.replace()` adicionais junto com os existentes:

```ts
.replace(/\{\{business_hours_status\}\}/gi, businessHoursStatus)
.replace(/\{\{business_hours_human\}\}/gi, businessHoursHuman)
.replace(/\{\{current_datetime_local\}\}/gi, currentDatetimeLocal)
```

### Garantias

- **Não-invasivo**: as 3 variáveis só afetam o prompt via `.replace()`. Templates antigos sem esses placeholders ficam idênticos.
- **Defaults seguros**: tenant ausente → `"fora"`, `"horário não configurado"`, datetime calculado com timezone padrão `America/Sao_Paulo`.
- **Sem libs externas**: `Intl.DateTimeFormat` é nativo no Deno.
- **Try/catch**: qualquer falha de timezone inválido cai nos defaults sem quebrar a edge function.
- **Escopo preservado**: nada muda nas variáveis existentes (`contact_name`, `channel`, etc.) nem no fluxo de RAG, name extraction ou logging.

