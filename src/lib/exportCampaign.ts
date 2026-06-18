import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

const STATUS_PT: Record<string, string> = {
  pending: 'Pendente',
  sending: 'Em envio',
  skipped: 'Pulada',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  replied: 'Respondeu',
  failed: 'Falhou',
};

const fmt = (v: string | null | undefined) => (v ? format(new Date(v), 'dd/MM/yyyy HH:mm:ss') : '');

const esc = (v: any): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",;\n\r]/.test(s) ? `"${s}"` : s;
};

const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campanha';

export async function exportCampaignCsv(
  campaign: { id: string; name: string; tenant_id: string }
): Promise<void> {
  const CHUNK = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('campaign_recipients')
      .select('status, sent_at, delivered_at, read_at, replied_at, error, contact_id')
      .eq('tenant_id', campaign.tenant_id)
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < CHUNK) break;
    from += CHUNK;
  }

  const contactIds = Array.from(new Set(all.map((r: any) => r.contact_id).filter(Boolean)));
  const contactsMap: Record<string, { name: string | null; phone: string | null; email: string | null }> = {};
  for (let i = 0; i < contactIds.length; i += 500) {
    const slice = contactIds.slice(i, i + 500);
    const { data } = await supabase
      .from('contacts')
      .select('id, name, phone, email')
      .in('id', slice);
    (data ?? []).forEach((c: any) => { contactsMap[c.id] = { name: c.name, phone: c.phone, email: c.email }; });
  }

  const header = ['Campanha', 'Nome', 'Telefone', 'Email', 'Status', 'Enviada em', 'Entregue em', 'Lida em', 'Respondeu em', 'Erro'];
  const lines: string[] = [header.join(';')];
  for (const r of all) {
    const c = contactsMap[r.contact_id] ?? { name: '', phone: '', email: '' };
    lines.push([
      esc(campaign.name),
      esc(c.name ?? ''),
      esc(c.phone ?? ''),
      esc(c.email ?? ''),
      esc(STATUS_PT[r.status] ?? r.status),
      esc(fmt(r.sent_at)),
      esc(fmt(r.delivered_at)),
      esc(fmt(r.read_at)),
      esc(fmt(r.replied_at)),
      esc(r.error ?? ''),
    ].join(';'));
  }

  // BOM for Excel to detect UTF-8
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campanha-${slug(campaign.name)}-${format(new Date(), 'yyyyMMdd')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
