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
  error?: string;
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
      return { ok: false, error: data?.error || error?.message || 'Falha no envio Meta' };
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
  if (error || data?.error) {
    return { ok: false, error: data?.error || error?.message };
  }
  return { ok: true, provider_message_id: data?.provider_message_id ?? null };
}

export async function sendMedia(params: {
  conversationId: string;
  tenantId: string;
  phone: string;
  fileBase64: string; // sem prefixo data:
  mimeType: string;
  mediaType: 'image' | 'audio' | 'video' | 'document';
  filename?: string;
  caption?: string;
  providerInfo?: ProviderInfo;
}): Promise<SendResult> {
  const info = params.providerInfo ?? (await getConversationProvider(params.conversationId));

  if (info.provider === 'meta_cloud' && info.instance_id) {
    const { data, error } = await supabase.functions.invoke('wa-meta-send', {
      body: {
        action: 'send_media_base64',
        type: params.mediaType,
        media_base64: params.fileBase64,
        media_mime: params.mimeType,
        filename: params.filename,
        caption: params.caption,
        conversation_id: params.conversationId,
        whatsapp_instance_id: info.instance_id,
        skip_persist: true,
      },
    });
    if (error || data?.error || data?.ok === false) {
      return { ok: false, error: data?.error || error?.message || 'Falha no envio Meta' };
    }
    return { ok: true, provider_message_id: data?.provider_message_id ?? null };
  }

  const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
    body: {
      action: 'send_media',
      tenant_id: params.tenantId,
      phone: params.phone,
      media_base64: `data:${params.mimeType};base64,${params.fileBase64}`,
      media_type: params.mediaType,
      caption: params.caption ?? '',
      conversation_id: params.conversationId,
    },
  });
  if (error || data?.error) {
    return { ok: false, error: data?.error || error?.message };
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
