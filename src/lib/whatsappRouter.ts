// Centraliza o roteamento entre UAZAPI e Meta Cloud API.
// A escolha é baseada em conversations.whatsapp_instance_id -> whatsapp_instances.provider.
// Conversas sem instância vinculada usam UAZAPI por compat retroativa.
import { supabase } from '@/integrations/supabase/client';

export type WhatsAppProvider = 'meta_cloud' | 'uazapi';

export interface ProviderInfo {
  instance_id: string | null;
  provider: WhatsAppProvider; // resolvido (default uazapi)
}

const providerCache = new Map<string, ProviderInfo>();

export async function getConversationProvider(conversationId: string): Promise<ProviderInfo> {
  const cached = providerCache.get(conversationId);
  if (cached) return cached;

  const { data: conv } = await supabase
    .from('conversations')
    .select('whatsapp_instance_id')
    .eq('id', conversationId)
    .maybeSingle();

  let info: ProviderInfo = { instance_id: null, provider: 'uazapi' };
  const instanceId = (conv as any)?.whatsapp_instance_id ?? null;

  if (instanceId) {
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('id, provider')
      .eq('id', instanceId)
      .maybeSingle();
    const prov = ((inst as any)?.provider === 'meta_cloud' ? 'meta_cloud' : 'uazapi') as WhatsAppProvider;
    info = { instance_id: instanceId, provider: prov };
  }

  providerCache.set(conversationId, info);
  return info;
}

export function clearProviderCache(conversationId?: string) {
  if (conversationId) providerCache.delete(conversationId);
  else providerCache.clear();
}

export interface SendResult {
  ok: boolean;
  provider_message_id?: string | null;
  meta_media_id?: string | null;
  error?: string;
  code?: string;
}

export async function sendText(params: {
  conversationId: string;
  tenantId: string;
  phone: string;
  text: string;
  providerInfo?: ProviderInfo;
}): Promise<SendResult> {
  const info = params.providerInfo ?? (await getConversationProvider(params.conversationId));

  if (info.provider === 'meta_cloud' && info.instance_id) {
    const { data, error } = await supabase.functions.invoke('wa-meta-send', {
      body: {
        action: 'send',
        type: 'text',
        text: params.text,
        conversation_id: params.conversationId,
        whatsapp_instance_id: info.instance_id,
        skip_persist: true, // ChatPanel já cria a row da mensagem
      },
    });
    if (error || data?.error || data?.ok === false) {
      return { ok: false, error: data?.error || error?.message || 'Falha no envio Meta', code: data?.code };
    }
    return { ok: true, provider_message_id: data?.provider_message_id ?? null };
  }

  // Fallback: UAZAPI
  const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
    body: {
      action: 'send_message',
      tenant_id: params.tenantId,
      phone: params.phone,
      message: params.text,
      conversation_id: params.conversationId,
    },
  });
  // Note: uazapi-proxy now always returns 200 with { ok, error?, code? } for UAZAPI-level failures.
  // We check data.ok / data.error explicitly; `error` from invoke is only set for real HTTP failures.
  if (error || data?.error || data?.ok === false) {
    return { ok: false, error: data?.error || error?.message, code: data?.code };
  }
  return { ok: true, provider_message_id: data?.provider_message_id ?? null };
}

/**
 * Envia mídia para a conversa.
 * IMPORTANTE: o caller DEVE primeiro fazer upload do arquivo para o bucket
 * `whatsapp-media` e obter uma signed URL (TTL >= 1h) — passar essa URL em `mediaUrl`.
 * Nada de base64 trafegando pelo gateway.
 */
export async function sendMedia(params: {
  conversationId: string;
  tenantId: string;
  phone: string;
  mediaUrl: string; // signed URL temporária
  mimeType: string;
  mediaType: 'image' | 'audio' | 'video' | 'document';
  filename?: string;
  caption?: string;
  providerInfo?: ProviderInfo;
}): Promise<SendResult> {
  const info = params.providerInfo ?? (await getConversationProvider(params.conversationId));

  if (info.provider === 'meta_cloud' && info.instance_id) {
    const upRes = await supabase.functions.invoke('wa-meta-send', {
      body: {
        action: 'upload_media',
        type: params.mediaType,
        media_url: params.mediaUrl,
        media_mime: params.mimeType,
        filename: params.filename,
        whatsapp_instance_id: info.instance_id,
      },
    });
    if (upRes.error || upRes.data?.ok === false || upRes.data?.error) {
      return {
        ok: false,
        error: upRes.data?.error || upRes.error?.message || 'Falha ao subir mídia para Meta',
        code: upRes.data?.code,
      };
    }
    const metaMediaId = upRes.data?.meta_media_id ?? upRes.data?.media_id ?? null;
    if (!metaMediaId) return { ok: false, error: 'Meta não retornou media_id', code: 'no_media_id' };

    const sendRes = await supabase.functions.invoke('wa-meta-send', {
      body: {
        action: 'send',
        type: params.mediaType,
        media_id: metaMediaId,
        filename: params.filename,
        caption: params.caption,
        conversation_id: params.conversationId,
        whatsapp_instance_id: info.instance_id,
        skip_persist: true,
      },
    });
    if (sendRes.error || sendRes.data?.error || sendRes.data?.ok === false) {
      return {
        ok: false,
        error: sendRes.data?.error || sendRes.error?.message || 'Falha no envio Meta',
        code: sendRes.data?.code,
        meta_media_id: metaMediaId,
      };
    }
    return {
      ok: true,
      provider_message_id: sendRes.data?.provider_message_id ?? null,
      meta_media_id: metaMediaId,
    };
  }

  const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
    body: {
      action: 'send_media',
      tenant_id: params.tenantId,
      phone: params.phone,
      media_url: params.mediaUrl,
      media_type: params.mediaType,
      caption: params.caption ?? '',
      conversation_id: params.conversationId,
    },
  });
  // uazapi-proxy now returns 200 with { ok, error?, code? } for UAZAPI failures.
  if (error || data?.error || data?.ok === false) {
    return { ok: false, error: data?.error || error?.message, code: data?.code };
  }
  return { ok: true, provider_message_id: data?.provider_message_id ?? null };
}


export interface DownloadResult {
  ok: boolean;
  base64?: string;
  url?: string;
  mimetype?: string;
}

export async function downloadMedia(params: {
  conversationId: string;
  tenantId: string;
  providerMessageId: string;
  metaMediaId?: string | null;
  providerInfo?: ProviderInfo;
}): Promise<DownloadResult> {
  const info = params.providerInfo ?? (await getConversationProvider(params.conversationId));

  if (info.provider === 'meta_cloud' && info.instance_id) {
    if (!params.metaMediaId) return { ok: false };
    const { data, error } = await supabase.functions.invoke('wa-meta-send', {
      body: {
        action: 'download_media',
        media_id: params.metaMediaId,
        whatsapp_instance_id: info.instance_id,
      },
    });
    if (error || data?.ok === false || data?.error) return { ok: false };
    return { ok: true, base64: data?.base64, mimetype: data?.mimetype };
  }

  const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
    body: {
      action: 'download_media',
      tenant_id: params.tenantId,
      message_id: params.providerMessageId,
    },
  });
  if (error || data?.ok === false || data?.error) return { ok: false };
  return {
    ok: true,
    base64: data?.base64 ?? data?.data?.base64,
    url: data?.url ?? data?.data?.fileURL,
    mimetype: data?.mimetype ?? data?.data?.mimetype,
  };
}
// sync-touch: sendMedia uses signed mediaUrl (no base64), upload_media -> send

