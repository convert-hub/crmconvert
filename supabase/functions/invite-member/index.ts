import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-tenant-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Extract caller from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Token não fornecido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
      error: userErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !caller) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = req.headers.get("x-tenant-id");
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Tenant não informado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate caller is admin
    const { data: callerMembership } = await supabaseAdmin
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", caller.id)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .single();

    if (callerMembership?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem convidar membros" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, full_name, role } = await req.json();

    if (!email || !full_name || !role) {
      return new Response(
        JSON.stringify({ error: "Email, nome e cargo são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validRoles = ["admin", "manager", "attendant", "readonly"];
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: "Cargo inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user already exists in auth
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      // Check if already a member of this tenant
      const { data: existingMembership } = await supabaseAdmin
        .from("tenant_memberships")
        .select("id, is_active")
        .eq("user_id", existingUser.id)
        .eq("tenant_id", tenantId)
        .single();

      if (existingMembership) {
        if (existingMembership.is_active) {
          return new Response(
            JSON.stringify({ error: "Este usuário já é membro ativo deste tenant" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Reactivate inactive member
        await supabaseAdmin
          .from("tenant_memberships")
          .update({
            is_active: true,
            role,
            invited_by: caller.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingMembership.id);

        return new Response(
          JSON.stringify({ success: true, message: "Membro reativado com sucesso" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // User exists but not a member — add membership
      await supabaseAdmin.from("tenant_memberships").insert({
        user_id: existingUser.id,
        tenant_id: tenantId,
        role,
        is_active: true,
        invited_by: caller.id,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Membro adicionado com sucesso" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User doesn't exist — invite via email
    const origin = req.headers.get("origin") || "https://crmconvert.lovable.app";
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name, tenant_id: tenantId },
        redirectTo: `${origin}/onboarding`,
      });

    if (inviteError) {
      throw inviteError;
    }

    // Create profile
    await supabaseAdmin.from("profiles").upsert(
      { user_id: inviteData.user.id, full_name },
      { onConflict: "user_id" }
    );

    // Create membership
    await supabaseAdmin.from("tenant_memberships").insert({
      user_id: inviteData.user.id,
      tenant_id: tenantId,
      role,
      is_active: true,
      invited_by: caller.id,
    });

    return new Response(
      JSON.stringify({ success: true, message: "Convite enviado por email" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[invite-member] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
