// WhatsApp Cloud API (Meta) — sync approved templates from WABA into local table
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
    const { data: claimsData } = await supabaseUser.auth.getClaims(token);
    if (!claimsData?.claims) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub;

    const { whatsapp_instance_id } = await req.json();
    if (!whatsapp_instance_id) return jsonResponse({ error: "whatsapp_instance_id required" }, 400);

    const { data: membership } = await supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id, role")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!membership) return jsonResponse({ error: "No tenant" }, 403);

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", whatsapp_instance_id)
      .single();
    if (!instance || instance.tenant_id !== membership.tenant_id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (instance.provider !== "meta_cloud" || !instance.meta_waba_id || !instance.meta_access_token_encrypted) {
      return jsonResponse({ error: "Instance not configured for Meta" }, 400);
    }

    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${instance.meta_waba_id}/message_templates?limit=200`,
      { headers: { Authorization: `Bearer ${instance.meta_access_token_encrypted}` } }
    );
    const data = await r.json();
    if (!r.ok) return jsonResponse({ ok: false, error: data?.error?.message ?? "Sync failed", details: data });

    const templates = data.data || [];
    let upserted = 0;
    for (const tpl of templates) {
      const row = {
        tenant_id: instance.tenant_id,
        whatsapp_instance_id: instance.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category ?? null,
        status: tpl.status ?? null,
        components: tpl.components ?? [],
        meta_template_id: tpl.id ?? null,
      };
      const { error } = await supabaseAdmin
        .from("whatsapp_message_templates")
        .upsert(row, { onConflict: "whatsapp_instance_id,name,language" });
      if (!error) upserted++;
    }

    return jsonResponse({ ok: true, count: upserted, total: templates.length });
  } catch (err: any) {
    console.error("wa-meta-templates-sync error:", err);
    return jsonResponse({ error: err.message ?? "Internal error" }, 500);
  }
});
