import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Options {
  tenantId: string | null;
  campaignId?: string | null;
  onCampaignChange?: (row: any) => void;
  onRecipientChange?: (rows: any[]) => void;
}

/**
 * Realtime subscription for campaign tracking.
 * - Listens to `campaigns` UPDATEs for the tenant.
 * - Optionally listens to `campaign_recipients` INSERT/UPDATE for a campaign, batched at 250ms.
 * Uses the authenticated supabase client (JWT) so RLS SELECT policies apply.
 */
export function useCampaignRealtime({ tenantId, campaignId, onCampaignChange, onRecipientChange }: Options) {
  const [connected, setConnected] = useState(false);
  const bufferRef = useRef<any[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbCampaignRef = useRef(onCampaignChange);
  const cbRecipientRef = useRef(onRecipientChange);

  useEffect(() => { cbCampaignRef.current = onCampaignChange; }, [onCampaignChange]);
  useEffect(() => { cbRecipientRef.current = onRecipientChange; }, [onRecipientChange]);

  useEffect(() => {
    if (!tenantId) return;

    const flush = () => {
      timerRef.current = null;
      if (bufferRef.current.length === 0) return;
      const rows = bufferRef.current;
      bufferRef.current = [];
      cbRecipientRef.current?.(rows);
    };

    const scheduleFlush = () => {
      if (timerRef.current) return;
      timerRef.current = setTimeout(flush, 250);
    };

    let recipientsChannel: ReturnType<typeof supabase.channel> | null = null;
    let subscribedCount = 0;
    const expected = campaignId ? 2 : 1;

    const onSubscribed = (status: string) => {
      if (status === 'SUBSCRIBED') {
        subscribedCount += 1;
        if (subscribedCount >= expected) setConnected(true);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnected(false);
      }
    };

    const campaignsChannel = supabase
      .channel(`campaigns:${tenantId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `tenant_id=eq.${tenantId}` },
        (payload) => { cbCampaignRef.current?.(payload.new); },
      )
      .subscribe(onSubscribed);

    if (campaignId) {
      recipientsChannel = supabase
        .channel(`recipients:${campaignId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'campaign_recipients', filter: `campaign_id=eq.${campaignId}` },
          (payload) => { bufferRef.current.push(payload.new); scheduleFlush(); },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'campaign_recipients', filter: `campaign_id=eq.${campaignId}` },
          (payload) => { bufferRef.current.push(payload.new); scheduleFlush(); },
        )
        .subscribe(onSubscribed);
    }

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      bufferRef.current = [];
      setConnected(false);
      supabase.removeChannel(campaignsChannel);
      if (recipientsChannel) supabase.removeChannel(recipientsChannel);
    };
  }, [tenantId, campaignId]);

  return { connected };
}
