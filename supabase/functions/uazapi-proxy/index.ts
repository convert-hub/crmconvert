import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Registra/atualiza o webhook do CRM de forma ADITIVA.
// A UAZAPI v2 suporta múltiplos webhooks por instância (GET /webhook retorna array).
// Um POST simples SOBRESCREVE o primeiro webhook da lista — o que apagaria o webhook
// de outro sistema (ex: Orbra) compartilhando a mesma instância. Por isso:
//   - se o webhook do CRM já existe → action:'update' com o id dele
//   - se a lista está vazia → POST simples (primeiro webhook)
//   - se há webhooks de outros sistemas → action:'add' (nunca sobrescrever)
// Obs: NÃO excluímos 'wasSentByApi' — mensagens enviadas por outro sistema na mesma
// instância chegam como eco e aparecem na timeline; o handler já deduplica por
// provider_message_id os envios do próprio CRM.
async function ensureWebhook(apiBase: string, instToken: string, webhookUrl: string) {
  const events = ['messages', 'messages_update', 'connection'];
  const excludeMessages = ['isGroupYes'];

  let existing: any[] = [];
  try {
    const listRes = await fetch(`${apiBase}/webhook`, { headers: { 'token': instToken } });
    if (listRes.ok) {
      const parsed = await listRes.json();
      existing = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    }
  } catch (e) {
    console.error('ensureWebhook: failed to list webhooks:', e);
  }

  const isMine = (w: any) => typeof w?.url === 'string' && w.url.includes('/functions/v1/webhook-uazapi');
  const mine = existing.find(isMine);

  let whBodyPayload: Record<string, unknown>;
  if (mine?.id) {
    whBodyPayload = { action: 'update', id: mine.id, enabled: true, url: webhookUrl, events, excludeMessages };
  } else if (existing.length === 0) {
    whBodyPayload = { enabled: true, url: webhookUrl, events, excludeMessages };
  } else {
    whBodyPayload = { action: 'add', enabled: true, url: webhookUrl, events, excludeMessages };
  }

  const whRes = await fetch(`${apiBase}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': instToken },
    body: JSON.stringify(whBodyPayload),
  });
  const whBody = await whRes.text();
  console.log(`ensureWebhook: mode=${whBodyPayload.action || 'create'}, existing=${existing.length}, status=${whRes.status}`, whBody);
  return { status: whRes.status, response: whBody };
}

// Gera variantes do número BR para matching contra o campo "owner" das instâncias
// UAZAPI (que pode vir com ou sem o 9º dígito). Retorna dígitos com DDI 55.
function phoneCandidates(input: string): string[] {
  let d = (input || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return [];
  if (!d.startsWith('55')) d = `55${d}`;
  const candidates = new Set<string>([d]);
  const ddd = d.slice(2, 4);
  const rest = d.slice(4);
  if (rest.length === 9 && rest.startsWith('9')) candidates.add(`55${ddd}${rest.slice(1)}`);
  if (rest.length === 8) candidates.add(`55${ddd}9${rest}`);
  return [...candidates];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const userId = claimsData.claims.sub;

    const body = await req.json();
    const { action, tenant_id, instance_name } = body;

    // Check if caller is SaaS admin (allowed to act on any tenant)
    const { data: saasAdmin } = await supabaseAdmin.from('saas_admins')
      .select('user_id').eq('user_id', userId).maybeSingle();
    const isSaasAdmin = !!saasAdmin;

    // Resolve effective tenant: prefer the one the caller explicitly asked for.
    // Fallback to ANY active membership only when no tenant_id is provided.
    let effectiveTenantId: string | undefined = tenant_id;
    if (!effectiveTenantId) {
      const { data: anyMembership } = await supabaseAdmin.from('tenant_memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      effectiveTenantId = anyMembership?.tenant_id;
    }
    if (!effectiveTenantId) {
      return jsonResponse({ error: 'No tenant found' }, 400);
    }

    // Validate membership against the EFFECTIVE tenant (not "any" membership).
    // Users can belong to multiple tenants, so we must scope the lookup.
    const { data: membership } = await supabaseAdmin.from('tenant_memberships')
      .select('id, role, tenant_id')
      .eq('user_id', userId)
      .eq('tenant_id', effectiveTenantId)
      .eq('is_active', true)
      .maybeSingle();

    if (!isSaasAdmin && !membership) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // Get UAZAPI global key (admin token + base_url)
    const { data: uazapiKey } = await supabaseAdmin.from('global_api_keys')
      .select('*')
      .eq('provider', 'uazapi')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!uazapiKey) {
      return jsonResponse({ error: 'UAZAPI não configurado. Adicione a chave global do provider "uazapi" no painel admin.' }, 400);
    }

    const adminToken = uazapiKey.api_key_encrypted;
    const baseUrl = (uazapiKey as any).metadata?.base_url;
    if (!baseUrl) {
      return jsonResponse({ error: 'URL base do UAZAPI não configurada na chave global.' }, 400);
    }

    const apiBase = baseUrl.replace(/\/+$/, '');

    switch (action) {
      // ── CONNECT NUMBER (adota instância existente no servidor ou cria nova) ──
      // O usuário digita o número; o servidor UAZAPI é o registro central: se já
      // existe instância com esse número (ex: criada pelo Orbra), adotamos ela em
      // vez de criar outra — o WhatsApp só permite 1 conexão por número.
      case 'connect_number': {
        const { phone: requestedPhone } = body;
        const candidates = phoneCandidates(requestedPhone || '');
        if (candidates.length === 0) {
          return jsonResponse({ error: 'Número inválido. Digite com DDD, apenas números.' }, 400);
        }

        // Busca o número entre as instâncias do servidor (admintoken)
        let serverInstances: any[] = [];
        try {
          const listRes = await fetch(`${apiBase}/instance/all`, { headers: { 'admintoken': adminToken } });
          if (listRes.ok) {
            const parsed = await listRes.json();
            serverInstances = Array.isArray(parsed) ? parsed : [];
          } else {
            console.error('connect_number: /instance/all failed:', listRes.status, await listRes.text());
          }
        } catch (e) {
          console.error('connect_number: /instance/all error:', e);
        }

        // Pode haver VÁRIAS instâncias com o mesmo owner (instâncias mortas antigas
        // mantêm o número no campo owner). Adotar a errada faz o QR migrar a sessão
        // para a instância morta e derrubar o sistema que estava conectado. Regra:
        // preferir a CONECTADA; entre desconectadas, a atualizada mais recentemente.
        const matches = serverInstances.filter((inst) => {
          const owner = String(inst?.owner || '').replace(/\D/g, '');
          return owner && candidates.includes(owner);
        });
        const match = matches.find((inst) => String(inst?.status || '').toLowerCase() === 'connected')
          || matches.sort((a, b) => new Date(b?.updated || 0).getTime() - new Date(a?.updated || 0).getTime())[0];
        if (matches.length > 1) {
          console.log(`connect_number: ${matches.length} instâncias com esse número — escolhida "${match?.name}" (status=${match?.status})`);
        }

        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi?tenant_id=${effectiveTenantId}`;

        if (match?.token) {
          // ── ADOTAR instância existente ──
          const adoptedToken = match.token as string;
          const adoptedName = match.name || `adotada_${effectiveTenantId.slice(0, 8)}`;
          const adoptedPhone = String(match.owner || '').replace(/\D/g, '');
          const isConnected = String(match.status || '').toLowerCase() === 'connected';

          // Desativa instâncias UAZAPI ativas anteriores do tenant (nunca toca Meta)
          await supabaseAdmin.from('whatsapp_instances')
            .update({ is_active: false })
            .eq('tenant_id', effectiveTenantId)
            .eq('provider', 'uazapi')
            .eq('is_active', true);

          await supabaseAdmin.from('whatsapp_instances').insert({
            tenant_id: effectiveTenantId,
            provider: 'uazapi',
            instance_name: adoptedName,
            api_url: apiBase,
            api_token_encrypted: adoptedToken,
            is_active: true,
            phone_number: adoptedPhone ? `+${adoptedPhone}` : null,
          });

          // Adiciona o webhook do CRM SEM tocar no webhook do outro sistema
          const wh = await ensureWebhook(apiBase, adoptedToken, webhookUrl);

          if (isConnected) {
            return jsonResponse({
              ok: true,
              adopted: true,
              status: 'connected',
              phone: adoptedPhone ? `+${adoptedPhone}` : null,
              instance_name: adoptedName,
              webhook_status: wh.status,
            });
          }

          // Existe mas está desconectada: reconecta a MESMA instância (QR)
          let qrcode = null;
          try {
            const connectRes = await fetch(`${apiBase}/instance/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': adoptedToken },
              body: JSON.stringify({}),
            });
            if (connectRes.ok) {
              const connectData = await connectRes.json();
              qrcode = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
              if (qrcode === '') qrcode = null;
            }
          } catch (e) {
            console.error('connect_number: reconnect failed:', e);
          }

          return jsonResponse({
            ok: true,
            adopted: true,
            status: 'connecting',
            phone: adoptedPhone ? `+${adoptedPhone}` : null,
            instance_name: adoptedName,
            qrcode,
            webhook_status: wh.status,
          });
        }

        // ── NÃO EXISTE: cria instância nova (fluxo tradicional com QR) ──
        const instName = `tenant_${effectiveTenantId.slice(0, 8)}`;
        const createRes = await fetch(`${apiBase}/instance/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'admintoken': adminToken },
          body: JSON.stringify({ name: instName }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('connect_number: create error:', createRes.status, errText);
          return jsonResponse({ error: `Falha ao criar instância: ${createRes.status} ${errText}` }, 500);
        }

        const createData = await createRes.json();
        const newToken = createData.token || createData.apikey || createData.instance?.token || '';

        try {
          await ensureWebhook(apiBase, newToken, webhookUrl);
        } catch (whErr) {
          console.error('connect_number: webhook setup failed (non-critical):', whErr);
        }

        await supabaseAdmin.from('whatsapp_instances')
          .update({ is_active: false })
          .eq('tenant_id', effectiveTenantId)
          .eq('provider', 'uazapi')
          .eq('is_active', true);

        await supabaseAdmin.from('whatsapp_instances').insert({
          tenant_id: effectiveTenantId,
          provider: 'uazapi',
          instance_name: instName,
          api_url: apiBase,
          api_token_encrypted: newToken,
          is_active: true,
        });

        let qrcode = null;
        try {
          const connectRes = await fetch(`${apiBase}/instance/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': newToken },
            body: JSON.stringify({}),
          });
          if (connectRes.ok) {
            const connectData = await connectRes.json();
            qrcode = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
            if (qrcode === '') qrcode = null;
          }
        } catch (e) {
          console.error('connect_number: connect failed:', e);
        }

        return jsonResponse({ ok: true, adopted: false, status: 'connecting', instance_name: instName, qrcode });
      }

      // ── CREATE INSTANCE ──
      case 'create_instance': {
        const instName = instance_name || `tenant_${effectiveTenantId.slice(0, 8)}`;

        // 1. Create instance via POST /instance/init (admintoken header)
        const createRes = await fetch(`${apiBase}/instance/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'admintoken': adminToken },
          body: JSON.stringify({ name: instName }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('UAZAPI create error:', createRes.status, errText);
          return jsonResponse({ error: `Falha ao criar instância: ${createRes.status} ${errText}` }, 500);
        }

        const createData = await createRes.json();
        console.log('UAZAPI create response:', JSON.stringify(createData));
        const instanceToken = createData.token || createData.apikey || createData.instance?.token || '';

        // 2. Set webhook with tenant_id in URL (uses instance token header)
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi?tenant_id=${effectiveTenantId}`;
        try {
          await ensureWebhook(apiBase, instanceToken, webhookUrl);
        } catch (whErr) {
          console.error('Webhook setup failed (non-critical):', whErr);
        }

        // 3. Save instance to DB.
        // First, deactivate any previous ACTIVE UAZAPI instance of this tenant so we never
        // accumulate múltiplas linhas UAZAPI ativas. Escopado a provider='uazapi' para
        // jamais tocar em instâncias de outro provider (ex: Meta Cloud).
        await supabaseAdmin.from('whatsapp_instances')
          .update({ is_active: false })
          .eq('tenant_id', effectiveTenantId)
          .eq('provider', 'uazapi')
          .eq('is_active', true);

        await supabaseAdmin.from('whatsapp_instances').insert({
          tenant_id: effectiveTenantId,
          provider: 'uazapi',
          instance_name: instName,
          api_url: apiBase,
          api_token_encrypted: instanceToken,
          is_active: true,
        });

        // 4. Connect (POST /instance/connect with token header, empty body = QR code)
        let qrcode = null;
        try {
          const connectRes = await fetch(`${apiBase}/instance/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            body: JSON.stringify({}),
          });
          if (connectRes.ok) {
            const connectData = await connectRes.json();
            console.log('UAZAPI connect response:', JSON.stringify(connectData));
            qrcode = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
            if (qrcode === '') qrcode = null;
          } else {
            const errText = await connectRes.text();
            console.error('UAZAPI connect error:', connectRes.status, errText);
          }
        } catch (qrErr) {
          console.error('Connect after create failed:', qrErr);
        }

        return jsonResponse({ ok: true, instance_name: instName, token: instanceToken, qrcode });
      }

      // ── GET QR / GET STATUS ──
      case 'get_qr':
      case 'get_status': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          if (action === 'get_status') {
            return jsonResponse({ status: 'no_instance' });
          }
          return jsonResponse({ error: 'Nenhuma instância encontrada. Crie uma primeiro.' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';

        // GET /instance/status with token header
        const statusRes = await fetch(`${apiBase}/instance/status`, {
          method: 'GET',
          headers: { 'token': instToken },
        });

        console.log(`UAZAPI /instance/status: ${statusRes.status}`);

        if (!statusRes.ok) {
          const errText = await statusRes.text();
          console.error('UAZAPI status error:', statusRes.status, errText);
          return jsonResponse({ error: `Falha ao obter status: ${statusRes.status} ${errText}` }, 500);
        }

        const statusData = await statusRes.json();
        console.log('UAZAPI status response:', JSON.stringify(statusData));

        let qrcode = statusData.instance?.qrcode || statusData.qrcode || statusData.base64 || null;
        if (qrcode === '') qrcode = null; // UAZAPI returns empty string when no QR
        let paircode = statusData.instance?.paircode || statusData.paircode || null;
        if (paircode === '') paircode = null;
        let state = statusData.instance?.status || statusData.state || statusData.status || 'disconnected';
        const phoneNumber = statusData.instance?.phone || statusData.phone || instance.phone_number;

        // If disconnected and no QR, call POST /instance/connect to initiate connection and get QR
        if ((state === 'disconnected' || (!qrcode && state !== 'connected'))) {
          console.log(`Instance state=${state}, triggering POST /instance/connect to generate QR...`);
          try {
            const connectRes = await fetch(`${apiBase}/instance/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instToken },
              body: JSON.stringify({}),
            });
            if (connectRes.ok) {
              const connectData = await connectRes.json();
              console.log('UAZAPI connect response:', JSON.stringify(connectData));
              const newQr = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
              if (newQr && newQr !== '') {
                qrcode = newQr;
                state = 'connecting';
              }
            } else {
              const errText = await connectRes.text();
              console.error('UAZAPI connect error:', connectRes.status, errText);
            }
          } catch (e) {
            console.error('Connect call failed:', e);
          }
        }

        if (state === 'connected' && phoneNumber) {
          await supabaseAdmin.from('whatsapp_instances').update({ phone_number: phoneNumber }).eq('id', instance.id);
        }

        return jsonResponse({
          status: state,
          phone: phoneNumber || null,
          instance_name: instance.instance_name,
          qrcode,
        });
      }

      // ── DISCONNECT ──
      case 'disconnect': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (instance) {
          try {
            await fetch(`${apiBase}/instance/disconnect`, {
              method: 'POST',
              headers: { 'token': instance.api_token_encrypted || '' },
            });
          } catch (e) {
            console.error('Disconnect request failed:', e);
          }
          await supabaseAdmin.from('whatsapp_instances').update({ is_active: false }).eq('id', instance.id);
        }

        return jsonResponse({ ok: true });
      }

      // ── SEND MESSAGE ──
      case 'send_message': {
        const { phone, message, conversation_id } = body;
        if (!phone || !message) {
          return jsonResponse({ error: 'phone and message required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        
        // Format phone: remove + and non-digits, ensure no @s.whatsapp.net
        const cleanPhone = phone.replace(/\D/g, '');

        if (!cleanPhone || cleanPhone.length < 10) {
          return jsonResponse({ error: 'Número de telefone inválido' }, 400);
        }

        const sendRes = await fetch(`${apiBase}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify({
            number: cleanPhone,
            text: message,
            delay: 0,
            readchat: true,
            readmessages: true,
          }),
        });

        const sendData = await sendRes.json();
        console.log('UAZAPI send response:', sendRes.status, JSON.stringify(sendData));

        if (!sendRes.ok) {
          const rawErr = sendData.error || sendData.message || `Falha ao enviar: ${sendRes.status}`;
          const errMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
          // Always return 200 with ok:false so SDK does not throw generic "non-2xx" toast.
          // Frontend checks data.error / data.ok to decide UX.
          return jsonResponse({ ok: false, error: errMsg, details: sendData, upstream_status: sendRes.status });
        }

        // Reset inactivity: update opportunities linked to this contact
        if (conversation_id) {
          try {
            const { data: conv } = await supabaseAdmin.from('conversations')
              .select('contact_id')
              .eq('id', conversation_id)
              .single();
            if (conv?.contact_id) {
              await supabaseAdmin.from('opportunities')
                .update({ updated_at: new Date().toISOString(), position: 0 })
                .eq('contact_id', conv.contact_id)
                .eq('tenant_id', effectiveTenantId)
                .eq('status', 'open');
              console.log(`uazapi-proxy: reset inactivity and bumped opportunities for contact ${conv.contact_id}`);
            }
          } catch (e) {
            console.error('uazapi-proxy: failed to reset inactivity:', e);
          }
        }

        return jsonResponse({ ok: true, provider_message_id: sendData.key?.id || sendData.messageid || sendData.id || null });
      }

      // ── SETUP WEBHOOK (re-configure) ──
      case 'setup_webhook': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância encontrada' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi?tenant_id=${effectiveTenantId}`;

        const wh = await ensureWebhook(apiBase, instToken, webhookUrl);

        return jsonResponse({ ok: true, status: wh.status, response: wh.response });
      }

      // ── SET PRESENCE ──
      case 'set_presence': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância encontrada' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const presence = body.presence || 'available';

        try {
          const presRes = await fetch(`${apiBase}/instance/setpresence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instToken },
            body: JSON.stringify({ presence }),
          });
          const presBody = await presRes.text();
          console.log('Set presence:', presRes.status, presBody);
          return jsonResponse({ ok: true, status: presRes.status, response: presBody });
        } catch (e) {
          console.error('Set presence failed:', e);
          return jsonResponse({ error: 'Failed to set presence' }, 500);
        }
      }

      // ── DOWNLOAD MEDIA ──
      case 'download_media': {
        const { message_id } = body;
        if (!message_id) {
          return jsonResponse({ error: 'message_id required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const instancePhone = (instance.phone_number || '').replace(/\D/g, '');

        // UAZAPI v2: POST /message/download with { id: "owner:messageId" }
        // Try full format first (owner:messageId), then short format
        const fullId = instancePhone ? `${instancePhone}:${message_id}` : message_id;
        console.log(`download_media: trying ID: ${fullId}, apiBase: ${apiBase}`);
        
        let dlRes = await fetch(`${apiBase}/message/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify({ id: fullId }),
        });

        console.log(`download_media: response status=${dlRes.status}, content-type=${dlRes.headers.get('content-type')}`);

        // Fallback: try short ID if full ID failed
        if (!dlRes.ok && instancePhone) {
          console.log(`download_media: full ID failed (${dlRes.status}), trying short ID: ${message_id}`);
          dlRes = await fetch(`${apiBase}/message/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instToken },
            body: JSON.stringify({ id: message_id }),
          });
          console.log(`download_media: fallback status=${dlRes.status}`);
        }

        if (!dlRes.ok) {
          const errText = await dlRes.text();
          console.error('UAZAPI download media error:', dlRes.status, errText);
          // Return 200 with ok:false so Supabase SDK doesn't throw global error; frontend checks data.ok
          const isExpired = dlRes.status === 404 || dlRes.status === 500 || errText.includes('download failed') || errText.includes('not found') || errText.includes('Message not found');
          return jsonResponse({ 
            ok: false,
            error: isExpired ? 'Mídia expirada ou indisponível no WhatsApp' : `Falha ao baixar mídia: ${dlRes.status}`,
            expired: isExpired,
          });
        }

        // Check if response is JSON (URL/link) or binary (file data)
        const contentType = dlRes.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          const dlData = await dlRes.json();
          console.log(`download_media: JSON response keys: ${Object.keys(dlData).join(',')}`);
          
          // UAZAPI returns { fileURL: "...", mimetype: "..." } or { base64: "...", mimetype: "..." }
          if (dlData.base64) {
            return jsonResponse({ ok: true, base64: dlData.base64, mimetype: dlData.mimetype || 'application/octet-stream' });
          }
          if (dlData.fileURL || dlData.url || dlData.link) {
            return jsonResponse({ ok: true, url: dlData.fileURL || dlData.url || dlData.link, mimetype: dlData.mimetype });
          }
          // Return full data for inspection
          return jsonResponse({ ok: true, data: dlData });
        }

        // Binary response - convert to base64
        const arrayBuffer = await dlRes.arrayBuffer();
        console.log(`download_media: binary response size=${arrayBuffer.byteLength}, type=${contentType}`);
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        return jsonResponse({ ok: true, base64: b64, mimetype: contentType });
      }

      // ── SEND MEDIA ──
      case 'send_media': {
        const { phone, media_base64, media_url: sendMediaUrl, media_type: sendMediaType, caption, conversation_id: convId } = body;
        if (!phone || (!media_base64 && !sendMediaUrl)) {
          return jsonResponse({ error: 'phone and media_base64 or media_url required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .eq('provider', 'uazapi')
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const cleanPhone = phone.replace(/\D/g, '');

        // UAZAPI v2: POST /send/media with { number, type, file, caption? }
        const type = (sendMediaType || 'image').toLowerCase();
        let uazapiType = 'image';
        if (type.includes('audio') || type.includes('ptt') || type.includes('ogg')) uazapiType = 'audio';
        else if (type.includes('video')) uazapiType = 'video';
        else if (type.includes('document') || type.includes('pdf')) uazapiType = 'document';

        const sendBody: any = {
          number: cleanPhone,
          type: uazapiType,
          file: media_base64 || sendMediaUrl,
        };
        if (caption) sendBody.caption = caption;

        const sendRes = await fetch(`${apiBase}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify(sendBody),
        });

        const sendData = await sendRes.json();
        console.log('UAZAPI send media response:', sendRes.status, JSON.stringify(sendData));

        if (!sendRes.ok) {
          // Always return 200 with ok:false so SDK does not throw generic "non-2xx" toast.
          return jsonResponse({ ok: false, error: sendData.error || sendData.message || `Falha ao enviar mídia: ${sendRes.status}`, details: sendData, upstream_status: sendRes.status });
        }

        if (convId) {
          try {
            const { data: conv } = await supabaseAdmin.from('conversations')
              .select('contact_id')
              .eq('id', convId)
              .single();

            if (conv?.contact_id) {
              await supabaseAdmin.from('opportunities')
                .update({ updated_at: new Date().toISOString(), position: 0 })
                .eq('contact_id', conv.contact_id)
                .eq('tenant_id', effectiveTenantId)
                .eq('status', 'open');
              console.log(`uazapi-proxy: reset inactivity and bumped opportunities for contact ${conv.contact_id} (media)`);
            }
          } catch (e) {
            console.error('uazapi-proxy: failed to reset inactivity on media send:', e);
          }
        }

        return jsonResponse({ ok: true, provider_message_id: sendData.key?.id || sendData.messageid || sendData.id || null });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error('uazapi-proxy error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
