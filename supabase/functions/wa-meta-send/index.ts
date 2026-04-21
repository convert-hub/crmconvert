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

interface SendBody {
  action?: "send" | "test_connection" | "upload_media";
  conversation_id?: string;
  whatsapp_instance_id?: string;
  to?: string; // E.164 sem +
  type?: "text" | "image" | "audio" | "video" | "document" | "template" | "reaction";
  text?: string;
  media_url?: string;
  media_id?: string;
  filename?: string;
  caption?: string;
  reply_to_message_id?: string;
  emoji?: string;
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await supabaseUser.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub;

    const body = (await req.json()) as SendBody;
    const action = body.action ?? "send";

    // Resolve membership / tenant
    const { data: membership } = await supabaseAdmin
      .from("tenant_memberships")
      .select("id, tenant_id, role")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!membership) {
      return jsonResponse({ error: "No tenant membership" }, 403);
    }

    // Resolve instance
    let instanceId = body.whatsapp_instance_id;
    let conversation: any = null;

    if (!instanceId && body.conversation_id) {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("id, tenant_id, contact_id, whatsapp_instance_id, last_customer_message_at")
        .eq("id", body.conversation_id)
        .single();
      conversation = conv;
      instanceId = conv?.whatsapp_instance_id || undefined;
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
      return jsonResponse({ error: "Instance not found" }, 404);
    }
    if (instance.tenant_id !== membership.tenant_id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (instance.provider !== "meta_cloud") {
      return jsonResponse({ error: "Instance is not Meta Cloud" }, 400);
    }
    if (!instance.meta_phone_number_id || !instance.meta_access_token_encrypted) {
      return jsonResponse({ error: "Meta credentials incomplete" }, 400);
    }

    const accessToken = instance.meta_access_token_encrypted as string;
    const phoneNumberId = instance.meta_phone_number_id as string;
    const graphBase = `https://graph.facebook.com/${META_API_VERSION}`;

    // ── Test connection ───────────────────────────────────────
    if (action === "test_connection") {
      const r = await fetch(`${graphBase}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await r.json();
      if (!r.ok) return jsonResponse({ ok: false, error: data?.error?.message ?? "Test failed", details: data }, 200);
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

    // ── Send message ──────────────────────────────────────────
    const to = body.to || (await resolveContactPhone(supabaseAdmin, conversation?.contact_id));
    if (!to) return jsonResponse({ error: "to (phone) required" }, 400);

    const messagePayload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(to),
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
      return jsonResponse({
        ok: false,
        error: sendData?.error?.message ?? "Send failed",
        details: sendData,
      }, 200);
    }

    const providerMessageId = sendData?.messages?.[0]?.id ?? null;

    // Persist outbound message + reset inactivity (best-effort)
    if (conversation?.id) {
      await supabaseAdmin.from("messages").insert({
        tenant_id: membership.tenant_id,
        conversation_id: conversation.id,
        direction: "outbound",
        content: t === "text" ? (body.text ?? "") : (body.caption ?? null),
        media_type: t === "text" || t === "reaction" || t === "template" ? null : t,
        media_url: body.media_url ?? null,
        provider_message_id: providerMessageId,
        sender_membership_id: membership.id,
        provider_metadata: { provider: "meta_cloud", raw: sendData },
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

function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}
