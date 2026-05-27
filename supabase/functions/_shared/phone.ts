// Normalização de telefones brasileiros — espelho de src/lib/phone.ts.
// Deno não importa de src/, então mantemos cópia. Lógica deve permanecer idêntica.

const VALID_BR_DDDS = new Set<string>([
  '11','12','13','14','15','16','17','18','19',
  '21','22','24','27','28',
  '31','32','33','34','35','37','38',
  '41','42','43','44','45','46','47','48','49',
  '51','53','54','55',
  '61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79',
  '81','82','83','84','85','86','87','88','89',
  '91','92','93','94','95','96','97','98','99',
]);

export function phoneDigitsOnly(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\D/g, '');
}

export function normalizeBrazilPhone(input: unknown): string {
  let d = phoneDigitsOnly(input);
  if (!d) return '';
  d = d.replace(/^0+/, '');
  if (d.length < 8) return '';

  if (d.length === 12 && d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const firstLocal = d[4];
    if (VALID_BR_DDDS.has(ddd) && /[6789]/.test(firstLocal)) {
      return '55' + ddd + '9' + d.slice(4);
    }
    return d;
  }

  if (d.length === 13 && d.startsWith('55')) return d;

  if (d.length === 11) {
    const ddd = d.slice(0, 2);
    if (VALID_BR_DDDS.has(ddd) && d[2] === '9') return '55' + d;
  }

  if (d.length === 10) {
    const ddd = d.slice(0, 2);
    const firstLocal = d[2];
    if (VALID_BR_DDDS.has(ddd) && /[6789]/.test(firstLocal)) {
      return '55' + ddd + '9' + d.slice(2);
    }
  }

  return d;
}

// Helper race-safe: faz lookup e, em caso de conflito unique (23505), refaz o select e devolve o existente.
export async function upsertContactByPhone(
  supabase: any,
  tenantId: string,
  phoneRaw: string,
  extra: Record<string, unknown> = {},
  selectCols = 'id'
): Promise<{ id: string } | null> {
  const phone = normalizeBrazilPhone(phoneRaw);
  if (!phone) return null;

  const { data: existing } = await supabase
    .from('contacts')
    .select(selectCols)
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();
  if (existing) return existing as { id: string };

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({ tenant_id: tenantId, phone, ...extra })
    .select(selectCols)
    .single();

  if (!error) return created as { id: string };

  // Race condition: dois webhooks simultâneos criaram o mesmo contato.
  if ((error as any).code === '23505') {
    const { data: race } = await supabase
      .from('contacts')
      .select(selectCols)
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .single();
    return (race as { id: string }) ?? null;
  }

  console.error('[upsertContactByPhone] insert failed', error);
  return null;
}
