import { supabase } from '@/integrations/supabase/client';
import { normalizeBrazilPhone } from '@/lib/phone';

export type HistorySyncResult = {
  contacts_processed: number;
  chats_found: number;
  messages_inserted: number;
  messages_skipped: number;
  errors: { phone: string; error: string }[];
  winner_variant?: string | null;
  fallback_scan?: boolean;
};

const BATCH_SIZE = 100;

/**
 * Dispara backfill de histórico WhatsApp (30 dias) para a lista de telefones.
 * Quebra em lotes de 100, agrega o resultado e chama `onProgress` após cada lote.
 */
export async function syncWhatsappHistoryForPhones(
  tenantId: string,
  instanceId: string,
  phones: string[],
  onProgress?: (done: number, total: number, partial: HistorySyncResult) => void,
): Promise<HistorySyncResult> {
  const normSet = new Set<string>();
  for (const p of phones) {
    const n = normalizeBrazilPhone(p);
    if (n) normSet.add(n);
  }
  const list = Array.from(normSet);

  const agg: HistorySyncResult = {
    contacts_processed: 0,
    chats_found: 0,
    messages_inserted: 0,
    messages_skipped: 0,
    errors: [],
  };

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.functions.invoke('uazapi-history-sync-contacts', {
      body: { tenant_id: tenantId, instance_id: instanceId, phones: batch },
    });
    if (error || !data?.ok) {
      agg.errors.push({ phone: '', error: error?.message || data?.error || 'unknown' });
    } else {
      agg.contacts_processed += data.contacts_processed ?? 0;
      agg.chats_found += data.chats_found ?? 0;
      agg.messages_inserted += data.messages_inserted ?? 0;
      agg.messages_skipped += data.messages_skipped ?? 0;
      if (Array.isArray(data.errors)) agg.errors.push(...data.errors);
    }
    onProgress?.(Math.min(i + batch.length, list.length), list.length, agg);
  }

  return agg;
}

export async function listUazapiInstances(tenantId: string) {
  const { data } = await supabase
    .from('whatsapp_instances')
    .select('id, display_name, instance_name')
    .eq('tenant_id', tenantId)
    .eq('provider', 'uazapi')
    .eq('is_active', true)
    .order('display_name');
  return (data ?? []) as Array<{ id: string; display_name: string | null; instance_name: string | null }>;
}
