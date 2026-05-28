// WhatsApp Cloud API (Meta) — message sender
// Aditivo: não substitui uazapi-proxy. Roteado apenas quando a instância é provider='meta_cloud'.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API_VERSION = "v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Renderiza preview de texto a partir dos componentes do template + valores enviados.
// templateComponents: vindo de whatsapp_message_templates.components (Meta schema com placeholders)
// sentComponents: o que foi enviado para Meta no payload (header/body/buttons com parameters)
function renderTemplatePreview(
  templateComponents: any,
  sentComponents: any
): string {
  if (!Array.isArray(templateComponents)) return "";
  const sentByType = new Map<string, any>();
  if (Array.isArray(sentComponents)) {
    for (const c of sentComponents) {
      if (c?.type) sentByType.set(String(c.type).toLowerCase(), c);
    }
  }

  const substitute = (text: string, params: any[]): string => {
    if (!text) return "";
    let out = String(text);
    if (!Array.isArray(params)) return out;
    // posicional {{1}}..{{n}}
    params.forEach((p, idx) => {
      const val = p?.text ?? "";
      const re = new RegExp(`\\{\\{\\s*${idx + 1}\\s*\\}\\}`, "g");
      out = out.replace(re, val);
    });
    // nomeado {{nome}} via parameter_name
    for (const p of params) {
      if (p?.parameter_name) {
        const re = new RegExp(`\\{\\{\\s*${p.parameter_name}\\s*\\}\\}`, "g");
        out = out.replace(re, p?.text ?? "");
      }
    }
    return out;
  };

  const parts: string[] = [];
  for (const comp of templateComponents) {
    const ctype = String(comp?.type || "").toUpperCase();
    if (ctype === "HEADER" && comp?.format === "TEXT" && comp?.text) {
      const sent = sentByType.get("header");
      parts.push(substitute(comp.text, sent?.parameters ?? []));
    } else if (ctype === "BODY" && comp?.text) {
      const sent = sentByType.get("body");
      parts.push(substitute(comp.text, sent?.parameters ?? []));
    } else if (ctype === "FOOTER" && comp?.text) {
      parts.push(comp.text);
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

interface SendBody {
  action?: "send" | "test_connection" | "upload_media" | "send_media_base64" | "download_media";
  conversation_id?: string;
  whatsapp_instance_id?: string;
  to?: string; // E.164 sem +
  type?: "text" | "image" | "audio" | "video" | "document" | "template" | "reaction";
  text?: string;
  media_url?: string;
  media_id?: string;
  media_base64?: string; // base64 puro (sem data:...)
  media_mime?: string;
  filename?: string;
  caption?: string;
  reply_to_message_id?: string;
  emoji?: string;
  skip_persist?: boolean; // quando o caller já criou a row de messages (ChatPanel optimistic)
  template?: {
    name: string;
    language: string; // 'pt_BR'
    components?: Array<Record<string, unknown>>;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SERVICE_ROLE
    );

    const token = authHeader.replace("Bearer ", "");
    const isInternalCall = token === SERVICE_ROLE;

    let membership: { id: string | null; tenant_id: string } | null = null;

    let isSaasAdmin = false;

    if (!isInternalCall) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: claimsData, error: claimsErr } =
        await supabaseUser.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const userId = claimsData.claims.sub;

      const { data: adminRow } = await supabaseAdmin
        .from("saas_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      isSaasAdmin = !!adminRow;

      if (!isSaasAdmin) {
        const { data: m } = await supabaseAdmin
          .from("tenant_memberships")
          .select("id, tenant_id, role")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (!m) return jsonResponse({ error: "No tenant membership" }, 403);
        membership = { id: m.id, tenant_id: m.tenant_id };
      }
    }

    const body = (await req.json()) as SendBody;
    const action = body.action ?? "send";

    // Resolve instance
    let instanceId = body.whatsapp_instance_id;
    let conversation: any = null;

    if (body.conversation_id) {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("id, tenant_id, contact_id, whatsapp_instance_id, last_customer_message_at")
        .eq("id", body.conversation_id)
        .single();
      conversation = conv;
      if (!instanceId) instanceId = conv?.whatsapp_instance_id || undefined;
    }

    if (!instanceId) {
      return jsonResponse({ error: "whatsapp_instance_id required" }, 400);
    }

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (!instance) {
      console.warn("[wa-meta-send] precondition_failed", { code: "instance_not_found", instance_id: instanceId });
      return jsonResponse({
        ok: false,
        code: "instance_not_found",
        error: "Instância do WhatsApp não encontrada. Verifique se ela ainda existe nas configurações.",
        instance_id: instanceId,
      });
    }

    // Em chamadas internas ou de SaaS admin, derivamos o tenant da própria instance
    if (isInternalCall || isSaasAdmin) {
      membership = { id: null, tenant_id: instance.tenant_id };
    } else if (instance.tenant_id !== membership!.tenant_id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (instance.provider !== "meta_cloud") {
      console.warn("[wa-meta-send] precondition_failed", { code: "instance_wrong_provider", instance_id: instance.id, actual_provider: instance.provider });
      return jsonResponse({
        ok: false,
        code: "instance_wrong_provider",
        error: `Esta instância usa o provedor "${instance.provider}", não Meta Cloud. Selecione uma instância Meta Cloud.`,
        instance_id: instance.id,
        actual_provider: instance.provider,
      });
    }
    {
      const missing: string[] = [];
      if (!instance.meta_phone_number_id) missing.push("meta_phone_number_id");
      if (!instance.meta_access_token_encrypted) missing.push("meta_access_token_encrypted");
      if (missing.length > 0) {
        const code =
          missing.length > 1
            ? "meta_credentials_incomplete"
            : missing[0] === "meta_phone_number_id"
              ? "meta_missing_phone_number_id"
              : "meta_missing_access_token";
        const messages: Record<string, string> = {
          meta_missing_phone_number_id: "Configure o Phone Number ID da Meta nas configurações da instância.",
          meta_missing_access_token: "Configure o Access Token da Meta nas configurações da instância.",
          meta_credentials_incomplete: "Credenciais Meta incompletas. Configure Phone Number ID e Access Token nas configurações da instância.",
        };
        console.warn("[wa-meta-send] precondition_failed", { code, instance_id: instance.id, missing });
        return jsonResponse({
          ok: false,
          code,
          error: messages[code],
          missing,
          instance_id: instance.id,
          provider: instance.provider,
        });
      }
    }

    const accessToken = instance.meta_access_token_encrypted as string;
    const phoneNumberId = instance.meta_phone_number_id as string;
    const graphBase = `https://graph.facebook.com/${META_API_VERSION}`;

    // Helper: detecta token Meta inválido/expirado e marca status na instância
    async function handleGraphError(httpStatus: number, data: any) {
      const errCode = data?.error?.code;
      const isAuth = errCode === 190 || httpStatus === 401;
      if (isAuth) {
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({
            meta_token_status: "expired",
            meta_token_last_error_at: new Date().toISOString(),
            meta_token_last_error: data?.error?.message ?? "Token inválido",
          })
          .eq("id", instance.id);
        return {
          ok: false,
          code: "meta_token_expired",
          error: "Token Meta expirado ou inválido. Atualize o token nas configurações da instância.",
          details: data,
        };
      }
      return null;
    }

    async function markTokenValid() {
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({ meta_token_status: "valid", meta_token_last_error: null })
        .eq("id", instance.id);
    }

    // ── Test connection ───────────────────────────────────────
    if (action === "test_connection") {
      const r = await fetch(`${graphBase}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await r.json();
      if (!r.ok) {
        const authErr = await handleGraphError(r.status, data);
        if (authErr) return jsonResponse(authErr);
        return jsonResponse({ ok: false, error: data?.error?.message ?? "Test failed", details: data }, 200);
      }
      await markTokenValid();
      return jsonResponse({ ok: true, info: data });
    }

    // ── Upload media (URL → media_id) ─────────────────────────
    if (action === "upload_media") {
      if (!body.media_url) return jsonResponse({ error: "media_url required" }, 400);
      const fileResp = await fetch(body.media_url);
      if (!fileResp.ok) return jsonResponse({ error: "Failed to fetch media_url" }, 400);
      const fileBlob = await fileResp.blob();
      const mime = fileResp.headers.get("Content-Type") || "application/octet-stream";

      const fd = new FormData();
      fd.append("messaging_product", "whatsapp");
      fd.append("file", fileBlob, body.filename || "file");
      fd.append("type", mime);

      const upR = await fetch(`${graphBase}/${phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      const upData = await upR.json();
      if (!upR.ok) return jsonResponse({ ok: false, error: upData?.error?.message ?? "Upload failed", details: upData }, 200);
      return jsonResponse({ ok: true, media_id: upData.id });
    }

    // ── Download media (media_id → base64) ────────────────────
    if (action === "download_media") {
      if (!body.media_id) return jsonResponse({ ok: false, error: "media_id required" }, 200);
      try {
        const metaResp = await fetch(`${graphBase}/${body.media_id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const metaData = await metaResp.json();
        if (!metaResp.ok || !metaData?.url) {
          return jsonResponse({ ok: false, error: metaData?.error?.message ?? "Media metadata failed" }, 200);
        }
        const binResp = await fetch(metaData.url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!binResp.ok) return jsonResponse({ ok: false, error: "Media download failed" }, 200);
        const buf = new Uint8Array(await binResp.arrayBuffer());
        // base64 encode em chunks para evitar stack overflow
        let binStr = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binStr += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
        }
        const base64 = btoa(binStr);
        return jsonResponse({ ok: true, base64, mimetype: metaData.mime_type ?? binResp.headers.get("Content-Type") });
      } catch (e: any) {
        return jsonResponse({ ok: false, error: e?.message ?? "download error" }, 200);
      }
    }

    // ── Send media via base64 (upload + send) ─────────────────
    if (action === "send_media_base64") {
      if (!body.media_base64 || !body.type || !body.media_mime) {
        return jsonResponse({ error: "media_base64, type, media_mime required" }, 400);
      }
      // Meta Cloud API só aceita um conjunto restrito de MIME por tipo.
      // Áudio: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg (Opus em container ogg).
      // Bloqueamos audio/webm (formato nativo do MediaRecorder em browsers) que a Meta rejeita
      // silenciosamente — assim devolvemos erro claro ao caller em vez de falhar no Graph.
      if (body.type === "audio") {
        const allowedAudio = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];
        const mimeBase = String(body.media_mime).split(";")[0].trim().toLowerCase();
        if (!allowedAudio.includes(mimeBase)) {
          console.warn("[wa-meta-send] audio mime rejeitado", { received: body.media_mime, allowed: allowedAudio });
          return jsonResponse({
            ok: false,
            code: "audio_mime_unsupported",
            error: `Formato de áudio "${body.media_mime}" não é aceito pela WhatsApp Cloud API. Use audio/ogg (Opus), audio/aac, audio/mp4, audio/mpeg ou audio/amr.`,
            received_mime: body.media_mime,
            allowed: allowedAudio,
          });
        }
      }
      // decode base64 → blob
      const binStr = atob(body.media_base64);
      const buf = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) buf[i] = binStr.charCodeAt(i);
      const blob = new Blob([buf], { type: body.media_mime });

      const fd = new FormData();
      fd.append("messaging_product", "whatsapp");
      fd.append("file", blob, body.filename || "file");
      fd.append("type", body.media_mime);

      const upR = await fetch(`${graphBase}/${phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      const upData = await upR.json();
      if (!upR.ok) return jsonResponse({ ok: false, error: upData?.error?.message ?? "Upload failed" }, 200);

      // injeta media_id no body para reuso do fluxo de envio abaixo
      body.media_id = upData.id;
      // segue para o fluxo "Send message" abaixo
    }

    const to = body.to || (await resolveContactPhone(supabaseAdmin, conversation?.contact_id));
    if (!to) return jsonResponse({ error: "to (phone) required" }, 400);

    const normalizedTo = normalizePhone(to);
    if (body.to && normalizedTo !== String(body.to).replace(/[^0-9]/g, "")) {
      console.log("[wa-meta-send] phone normalized", { original: body.to, normalized: normalizedTo });
    }

    const messagePayload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
    };

    if (body.reply_to_message_id) {
      messagePayload.context = { message_id: body.reply_to_message_id };
    }

    const t = body.type || "text";
    if (t === "text") {
      messagePayload.type = "text";
      messagePayload.text = { body: body.text ?? "", preview_url: false };
    } else if (t === "reaction") {
      messagePayload.type = "reaction";
      messagePayload.reaction = {
        message_id: body.reply_to_message_id ?? "",
        emoji: body.emoji ?? "",
      };
    } else if (t === "template") {
      if (!body.template?.name) return jsonResponse({ error: "template.name required" }, 400);
      messagePayload.type = "template";
      messagePayload.template = {
        name: body.template.name,
        language: { code: body.template.language || "pt_BR" },
        ...(body.template.components ? { components: body.template.components } : {}),
      };
    } else if (t === "image" || t === "audio" || t === "video" || t === "document") {
      const mediaObj: Record<string, unknown> = {};
      if (body.media_id) mediaObj.id = body.media_id;
      else if (body.media_url) mediaObj.link = body.media_url;
      else return jsonResponse({ error: "media_id or media_url required" }, 400);
      if (body.caption && (t === "image" || t === "video" || t === "document")) {
        mediaObj.caption = body.caption;
      }
      if (body.filename && t === "document") {
        mediaObj.filename = body.filename;
      }
      messagePayload.type = t;
      (messagePayload as any)[t] = mediaObj;
    } else {
      return jsonResponse({ error: `Unsupported type: ${t}` }, 400);
    }

    const sendR = await fetch(`${graphBase}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messagePayload),
    });
    const sendData = await sendR.json();
    if (!sendR.ok) {
      const authErr = await handleGraphError(sendR.status, sendData);
      if (authErr) return jsonResponse(authErr);
      return jsonResponse({
        ok: false,
        error: sendData?.error?.message ?? "Send failed",
        details: sendData,
      }, 200);
    }
    await markTokenValid();

    const providerMessageId = sendData?.messages?.[0]?.id ?? null;

    // Persist outbound message + reset inactivity (best-effort)
    // skip_persist=true quando o caller (ex: ChatPanel) já criou a row de messages localmente
    if (conversation?.id && !body.skip_persist) {
      let persistContent: string | null = t === "text" ? (body.text ?? "") : (body.caption ?? null);
      let persistMediaType: string | null = t === "text" || t === "reaction" || t === "template" ? null : t;
      const persistMeta: Record<string, unknown> = { provider: "meta_cloud", raw: sendData };

      if (t === "template" && body.template) {
        persistMediaType = "TemplateMessage";
        persistMeta.template_name = body.template.name;
        persistMeta.template_language = body.template.language;
        try {
          const { data: tpl } = await supabaseAdmin
            .from("whatsapp_message_templates")
            .select("components")
            .eq("whatsapp_instance_id", instanceId)
            .eq("name", body.template.name)
            .eq("language", body.template.language)
            .maybeSingle();
          persistContent = renderTemplatePreview(tpl?.components, body.template.components) || `[Template: ${body.template.name}]`;
        } catch (_e) {
          persistContent = `[Template: ${body.template.name}]`;
        }
      }

      await supabaseAdmin.from("messages").insert({
        tenant_id: membership!.tenant_id,
        conversation_id: conversation.id,
        direction: "outbound",
        content: persistContent,
        media_type: persistMediaType,
        media_url: body.media_url ?? null,
        provider_message_id: providerMessageId,
        sender_membership_id: membership!.id,
        provider_metadata: persistMeta,
      });

      await supabaseAdmin
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_agent_message_at: new Date().toISOString(),
          status: "waiting_customer",
        })
        .eq("id", conversation.id);
    }

    return jsonResponse({ ok: true, provider_message_id: providerMessageId, raw: sendData });
  } catch (err: any) {
    console.error("wa-meta-send error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

async function resolveContactPhone(supabase: any, contactId?: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await supabase.from("contacts").select("phone").eq("id", contactId).single();
  return data?.phone ?? null;
}

import { normalizeBrazilPhone } from "../_shared/phone.ts";

function normalizePhone(p: string): string {
  return normalizeBrazilPhone(p);
}
