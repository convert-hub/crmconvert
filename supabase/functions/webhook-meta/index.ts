// WhatsApp Cloud API (Meta) — webhook receiver
// Endpoint NOVO. Não interfere com webhook-uazapi.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API_VERSION = "v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);

  // ── GET: subscription challenge (Meta) ───────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && verifyToken && challenge) {
      // Verify token must match an active meta_cloud instance
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("provider", "meta_cloud")
        .eq("meta_verify_token", verifyToken)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (inst) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: events ─────────────────────────────────────────
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256") || "";
    const payload = JSON.parse(rawBody);

    // Identify instance via phone_number_id in payload
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!phoneNumberId) {
      console.warn("webhook-meta: no phone_number_id in payload");
      return jsonOk({ ok: true, ignored: "no phone_number_id" });
    }

    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("provider", "meta_cloud")
      .eq("meta_phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!instance) {
      console.warn("webhook-meta: instance not found for phone_number_id", phoneNumberId);
      return jsonOk({ ok: true, ignored: "instance not found" });
    }

    // ── Validate HMAC signature ─────────────────────────────
    if (instance.meta_app_secret_encrypted) {
      const valid = await verifySignature(rawBody, signature, instance.meta_app_secret_encrypted);
      if (!valid) {
        console.error("webhook-meta: invalid signature for instance", instance.id);
        return new Response("Invalid signature", { status: 401 });
      }
    } else {
      console.warn("webhook-meta: no app_secret configured for instance", instance.id, "- accepting unsigned");
    }

    // Save raw event (best-effort)
    supabase
      .from("webhook_events")
      .insert({ tenant_id: instance.tenant_id, source: "meta_cloud", raw_payload: payload })
      .then(() => {});

    // ── Route by field ──────────────────────────────────────
    const field = change?.field; // 'messages' | 'message_template_status_update' | ...

    if (field === "messages") {
      // Inbound messages
      const messages = value?.messages || [];
      for (const msg of messages) {
        await handleInboundMessage(supabase, instance, value, msg);
      }
      // Status updates (sent/delivered/read/failed)
      const statuses = value?.statuses || [];
      for (const st of statuses) {
        await handleStatusUpdate(supabase, instance, st);
      }
    } else if (field === "message_template_status_update") {
      // Template approval changes — best-effort upsert
      await supabase
        .from("whatsapp_message_templates")
        .update({ status: value?.event ?? null })
        .eq("whatsapp_instance_id", instance.id)
        .eq("name", value?.message_template_name ?? "")
        .eq("language", value?.message_template_language ?? "pt_BR");
    }

    return jsonOk({ ok: true });
  } catch (err: any) {
    console.error("webhook-meta error:", err);
    return jsonOk({ ok: true, error: err.message }); // sempre 200 p/ Meta não suspender
  }
});

async function handleInboundMessage(
  supabase: any,
  instance: any,
  value: any,
  msg: any
) {
  const tenantId = instance.tenant_id;
  const fromPhone = msg.from as string; // E.164 sem +
  const profileName: string | undefined = value?.contacts?.[0]?.profile?.name;
  const msgType = msg.type as string;
  const providerMessageId = msg.id as string;
  const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

  // Extract referral data (Click-to-WhatsApp ad context)
  const referral = msg.referral || msg.context?.referred_product || null;
  const adContext = msg.referral as
    | { source_url?: string; headline?: string; body?: string; source_type?: string; source_id?: string; ctwa_clid?: string; media_type?: string }
    | undefined;

  // 1) Find or create contact (by phone within tenant)
  let { data: contact } = await supabase
    .from("contacts")
    .select("id, utm_source, utm_campaign, ad_id")
    .eq("tenant_id", tenantId)
    .eq("phone", fromPhone)
    .limit(1)
    .maybeSingle();

  if (!contact) {
    const insertData: any = {
      tenant_id: tenantId,
      name: profileName || fromPhone,
      phone: fromPhone,
      source: adContext ? "facebook_ads" : "whatsapp_meta",
      status: "lead",
    };
    if (adContext) {
      insertData.utm_source = "facebook_ads";
      insertData.utm_medium = adContext.source_type ?? "ctwa";
      insertData.utm_campaign = adContext.headline ?? null;
      insertData.utm_content = adContext.body ?? null;
      insertData.ad_id = adContext.ctwa_clid ?? adContext.source_id ?? null;
      insertData.campaign_id = adContext.source_id ?? null;
    }
    const { data: newContact } = await supabase
      .from("contacts")
      .insert(insertData)
      .select("id, utm_source, utm_campaign, ad_id")
      .single();
    contact = newContact;
  } else if (adContext && !contact.utm_source) {
    // Backfill UTMs on existing contact only when empty (don't overwrite better data)
    await supabase.from("contacts").update({
      utm_source: "facebook_ads",
      utm_medium: adContext.source_type ?? "ctwa",
      utm_campaign: adContext.headline ?? null,
      utm_content: adContext.body ?? null,
      ad_id: adContext.ctwa_clid ?? adContext.source_id ?? null,
      campaign_id: adContext.source_id ?? null,
    }).eq("id", contact.id);
  }
  if (!contact) return;

  // 2) Find or create conversation tied to this instance
  let { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contact.id)
    .eq("whatsapp_instance_id", instance.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv } = await supabase
      .from("conversations")
      .insert({
        tenant_id: tenantId,
        contact_id: contact.id,
        whatsapp_instance_id: instance.id,
        channel: "whatsapp",
        status: "waiting_agent",
      })
      .select("id")
      .single();
    conversation = newConv;
  }
  if (!conversation) return;

  // 3) Extract text/media
  let content: string | null = null;
  let mediaType: string | null = null;
  let mediaUrl: string | null = null;
  let mediaId: string | null = null;

  if (msgType === "text") {
    content = msg.text?.body ?? null;
  } else if (msgType === "image") {
    mediaType = "image";
    mediaId = msg.image?.id ?? null;
    content = msg.image?.caption ?? null;
  } else if (msgType === "audio") {
    mediaType = "audio";
    mediaId = msg.audio?.id ?? null;
  } else if (msgType === "video") {
    mediaType = "video";
    mediaId = msg.video?.id ?? null;
    content = msg.video?.caption ?? null;
  } else if (msgType === "document") {
    mediaType = "document";
    mediaId = msg.document?.id ?? null;
    content = msg.document?.filename ?? msg.document?.caption ?? null;
  } else if (msgType === "sticker") {
    mediaType = "sticker";
    mediaId = msg.sticker?.id ?? null;
  } else if (msgType === "location") {
    content = `📍 ${msg.location?.latitude},${msg.location?.longitude}${msg.location?.name ? ` (${msg.location.name})` : ""}`;
  } else if (msgType === "interactive") {
    const i = msg.interactive;
    if (i?.type === "button_reply") content = i.button_reply?.title ?? null;
    else if (i?.type === "list_reply") content = i.list_reply?.title ?? null;
  } else if (msgType === "button") {
    content = msg.button?.text ?? null;
  } else if (msgType === "reaction") {
    content = `${msg.reaction?.emoji ?? ""}`;
  }

  // 4) Resolve media to a public URL (best-effort, optional)
  if (mediaId && instance.meta_access_token_encrypted) {
    try {
      const r = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${instance.meta_access_token_encrypted}` },
      });
      const j = await r.json();
      if (r.ok && j?.url) {
        // Note: Meta media URLs require Bearer auth and have short TTL.
        // We store only metadata pointing to the media_id; downloads happen via a follow-up function.
        mediaUrl = j.url;
      }
    } catch (e) {
      console.warn("webhook-meta: media url resolve failed", e);
    }
  }

  // 5) Insert inbound message
  await supabase.from("messages").insert({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    direction: "inbound",
    content,
    media_type: mediaType,
    media_url: mediaUrl,
    provider_message_id: providerMessageId,
    provider_metadata: { provider: "meta_cloud", raw: msg, meta_media_id: mediaId },
    created_at: timestamp,
  });

  // 6) Update conversation timestamps
  await supabase
    .from("conversations")
    .update({
      last_message_at: timestamp,
      last_customer_message_at: timestamp,
      status: "waiting_agent",
      unread_count: (await getUnread(supabase, conversation.id)) + 1,
    })
    .eq("id", conversation.id);
}

async function getUnread(supabase: any, conversationId: string): Promise<number> {
  const { data } = await supabase
    .from("conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .single();
  return data?.unread_count ?? 0;
}

async function handleStatusUpdate(supabase: any, instance: any, st: any) {
  const providerMessageId = st.id as string;
  const status = st.status as string; // sent | delivered | read | failed
  if (!providerMessageId) return;
  const nowIso = new Date().toISOString();

  const { data: msg } = await supabase
    .from("messages")
    .select("id, provider_metadata")
    .eq("tenant_id", instance.tenant_id)
    .eq("provider_message_id", providerMessageId)
    .limit(1)
    .maybeSingle();

  if (msg) {
    const meta = (msg.provider_metadata as any) ?? {};
    const statuses = Array.isArray(meta.statuses) ? meta.statuses : [];
    statuses.push({ status, at: nowIso, raw: st });

    await supabase
      .from("messages")
      .update({ provider_metadata: { ...meta, statuses, last_status: status } })
      .eq("id", msg.id);
  }

  // Update campaign_recipients delivery tracking (matches by provider_message_id)
  const update: Record<string, any> = {};
  if (status === "delivered") {
    update.status = "delivered";
    update.delivered_at = nowIso;
  } else if (status === "read") {
    update.status = "read";
    update.read_at = nowIso;
  } else if (status === "failed") {
    update.status = "failed";
    update.error = st?.errors?.[0]?.title ?? st?.errors?.[0]?.message ?? "failed";
  }
  if (Object.keys(update).length > 0) {
    await supabase
      .from("campaign_recipients")
      .update(update)
      .eq("tenant_id", instance.tenant_id)
      .eq("provider_message_id", providerMessageId);
  }
}

// ── HMAC SHA-256 verification ────────────────────────────────
async function verifySignature(payload: string, signature: string, appSecret: string): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const expectedHex = signature.slice("sha256=".length);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const actualHex = bufferToHex(sig);
  return timingSafeEqual(actualHex, expectedHex);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
