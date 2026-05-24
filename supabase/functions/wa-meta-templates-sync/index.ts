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

    const { data: isAdminRow } = await supabaseAdmin
      .from("saas_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const isSaasAdmin = !!isAdminRow;

    let membershipTenantId: string | null = null;
    if (!isSaasAdmin) {
      const { data: membership } = await supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id, role")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .single();
      if (!membership) return jsonResponse({ error: "No tenant" }, 403);
      membershipTenantId = membership.tenant_id;
    }

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", whatsapp_instance_id)
      .single();
    if (!instance) {
      console.warn("[wa-meta-templates-sync] precondition_failed", { code: "instance_not_found", instance_id: whatsapp_instance_id });
      return jsonResponse({
        ok: false,
        code: "instance_not_found",
        error: "Instância do WhatsApp não encontrada.",
        instance_id: whatsapp_instance_id,
      });
    }
    if (!isSaasAdmin && instance.tenant_id !== membershipTenantId) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (instance.provider !== "meta_cloud") {
      console.warn("[wa-meta-templates-sync] precondition_failed", { code: "instance_wrong_provider", instance_id: instance.id, actual_provider: instance.provider });
      return jsonResponse({
        ok: false,
        code: "instance_wrong_provider",
        error: `Esta instância usa o provedor "${instance.provider}", não Meta Cloud. Sincronização de templates disponível apenas para instâncias Meta Cloud.`,
        instance_id: instance.id,
        actual_provider: instance.provider,
      });
    }
    {
      const missing: string[] = [];
      if (!instance.meta_waba_id) missing.push("meta_waba_id");
      if (!instance.meta_access_token_encrypted) missing.push("meta_access_token_encrypted");
      if (missing.length > 0) {
        const code =
          missing.length > 1
            ? "meta_credentials_incomplete"
            : missing[0] === "meta_waba_id"
              ? "meta_missing_waba_id"
              : "meta_missing_access_token";
        const messages: Record<string, string> = {
          meta_missing_waba_id: "Configure o WABA ID (WhatsApp Business Account ID) da Meta nas configurações da instância.",
          meta_missing_access_token: "Configure o Access Token da Meta nas configurações da instância.",
          meta_credentials_incomplete: "Credenciais Meta incompletas. Configure WABA ID e Access Token nas configurações da instância.",
        };
        console.warn("[wa-meta-templates-sync] precondition_failed", { code, instance_id: instance.id, missing });
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

    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${instance.meta_waba_id}/message_templates?limit=200`,
      { headers: { Authorization: `Bearer ${instance.meta_access_token_encrypted}` } }
    );
    const data = await r.json();
    if (!r.ok) {
      const errCode = data?.error?.code;
      const isAuth = errCode === 190 || r.status === 401;
      if (isAuth) {
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({
            meta_token_status: "expired",
            meta_token_last_error_at: new Date().toISOString(),
            meta_token_last_error: data?.error?.message ?? "Token inválido",
          })
          .eq("id", instance.id);
        return jsonResponse({
          ok: false,
          code: "meta_token_expired",
          error: "Token Meta expirado ou inválido. Atualize o token nas configurações da instância.",
          details: data,
        });
      }
      return jsonResponse({ ok: false, error: data?.error?.message ?? "Sync failed", details: data });
    }

    // Sucesso: marca token como válido
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ meta_token_status: "valid", meta_token_last_error: null })
      .eq("id", instance.id);

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
