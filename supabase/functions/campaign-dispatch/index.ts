// Campaign Dispatch — processes pending recipients of a Meta-template campaign
// Called manually (start/resume) or via cron. Respects throttle_per_minute.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveTemplateVariable(template: string, contact: any): string {
  if (!template) return "";
  return template.replace(/\{\{\s*contact\.(\w+)\s*\}\}/g, (_, field) => {
    const v = contact?.[field];
    return v == null ? "" : String(v);
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonOk({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const action = body.action as string; // 'start' | 'tick' | 'pause' | 'cancel'
  const campaignId = body.campaign_id as string;

  if (!campaignId) return jsonOk({ ok: false, error: "campaign_id required" }, 400);

  // Auth: allow service role (cron/internal) or admin/manager of campaign tenant
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return jsonOk({ ok: false, error: "Unauthorized" }, 401);

  let isServiceRole = token === SERVICE_ROLE;
  let callerUserId: string | null = null;
  if (!isServiceRole) {
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return jsonOk({ ok: false, error: "Unauthorized" }, 401);
    callerUserId = claimsData.claims.sub;
  }

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("*, whatsapp_instance:whatsapp_instances!campaigns_whatsapp_instance_id_fkey(*), template:whatsapp_message_templates!campaigns_template_id_fkey(*)")
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr || !campaign) return jsonOk({ ok: false, error: "campaign_not_found" }, 404);

  // Tenant authorization: non-service callers must be admin/manager of the campaign's tenant
  if (!isServiceRole) {
    const { data: membership } = await supabase
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", callerUserId)
      .eq("tenant_id", (campaign as any).tenant_id)
      .eq("is_active", true)
      .maybeSingle();
    const role = (membership as any)?.role;
    if (!membership || !["admin", "manager"].includes(role)) {
      return jsonOk({ ok: false, error: "Forbidden" }, 403);
    }
  }

  if (action === "pause") {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return jsonOk({ ok: true, status: "paused" });
  }
  if (action === "cancel") {
    await supabase.from("campaigns").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", campaignId);
    return jsonOk({ ok: true, status: "cancelled" });
  }

  if (action === "start") {
    if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
      return jsonOk({ ok: false, error: `cannot_start_from_${campaign.status}` }, 400);
    }
    await supabase.from("campaigns").update({
      status: "running",
      started_at: campaign.started_at ?? new Date().toISOString(),
    }).eq("id", campaignId);
  }

  if (campaign.status === "paused" || campaign.status === "cancelled" || campaign.status === "completed") {
    return jsonOk({ ok: true, status: campaign.status, processed: 0 });
  }

  const instance = (campaign as any).whatsapp_instance;
  const template = (campaign as any).template;
  if (!instance || instance.provider !== "meta_cloud") {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return jsonOk({ ok: false, error: "instance must be meta_cloud" }, 400);
  }
  if (!template) {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return jsonOk({ ok: false, error: "template_missing" }, 400);
  }

  const throttle = Math.max(1, Math.min(campaign.throttle_per_minute ?? 60, 200));

  // Concurrency safety: multiple invocations (cron + manual click) are expected.
  // Protected by a row-level lease on campaigns.tick_lock_until + atomic claim
  // via claim_campaign_recipients (FOR UPDATE SKIP LOCKED). The lease auto-expires
  // in 90s so an edge-function timeout cannot permanently block the campaign.
  const { data: gotLease } = await supabase.rpc('acquire_campaign_tick_lease', { _campaign_id: campaignId });
  if (!gotLease) {
    return jsonOk({ ok: true, skipped: 'locked', processed: 0 });
  }

  try {
    // Only the lease holder reaps stuck 'sending' rows (>10min) back to 'pending'.
    await supabase.rpc('reap_stuck_sending', { _campaign_id: campaignId });

    // Atomic claim — guarantees no two invocations grab the same recipient.
    const { data: claimed } = await supabase.rpc('claim_campaign_recipients', {
      _campaign_id: campaignId,
      _limit: throttle,
    });

    const claimedIds = (claimed ?? []).map((r: any) => r.id);

    if (claimedIds.length === 0) {
      const { count } = await supabase
        .from("campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .in("status", ["pending", "sending"]);
      if ((count ?? 0) === 0) {
        await supabase.from("campaigns").update({
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", campaignId);
      }
      return jsonOk({ ok: true, processed: 0 });
    }

    // Hydrate contact data preserving FIFO order.
    const { data: pending } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id, variables_used, contact:contacts(id, name, phone, email, do_not_contact, consent_given)")
      .in("id", claimedIds)
      .order("created_at", { ascending: true });

    const bodyComp = (template.components as any[])?.find((c: any) => c.type === "BODY");
    const placeholders = bodyComp ? Array.from(new Set(((bodyComp.text as string) ?? "").match(/\{\{(\d+)\}\}/g) || []))
      .map((m: string) => m.replace(/[{}]/g, "")).sort((a, b) => Number(a) - Number(b)) : [];

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const rcp of (pending ?? [])) {
      const contact = (rcp as any).contact;
      if (!contact?.phone || contact.do_not_contact) {
        await supabase.from("campaign_recipients").update({
          status: "skipped",
          error: contact?.do_not_contact ? "contact_do_not_contact" : "no_phone",
        }).eq("id", rcp.id);
        processed++;
        continue;
      }

      const resolved: Record<string, string> = {};
      for (const p of placeholders) {
        const tplVar = (campaign.template_variables as any)?.[p] ?? "";
        resolved[p] = resolveTemplateVariable(tplVar, contact);
      }

      let { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("tenant_id", campaign.tenant_id)
        .eq("contact_id", contact.id)
        .eq("whatsapp_instance_id", instance.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conversation) {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({
            tenant_id: campaign.tenant_id,
            contact_id: contact.id,
            whatsapp_instance_id: instance.id,
            channel: "whatsapp",
            status: "open",
          })
          .select("id")
          .single();
        conversation = newConv;
      }

      // Link conversation + persist resolved vars. Status already 'sending' (from claim RPC).
      await supabase.from("campaign_recipients").update({
        conversation_id: conversation?.id ?? null,
        variables_used: resolved,
      }).eq("id", rcp.id);

      const components: any[] = [];
      if (placeholders.length > 0) {
        components.push({
          type: "body",
          parameters: placeholders.map(p => ({ type: "text", text: resolved[p] ?? "" })),
        });
      }

      try {
        const { data: sendRes, error: sendErr } = await supabase.functions.invoke("wa-meta-send", {
          body: {
            action: "send",
            conversation_id: conversation?.id,
            whatsapp_instance_id: instance.id,
            type: "template",
            template: {
              name: template.name,
              language: template.language,
              components,
            },
          },
        });

        if (sendErr || !sendRes?.ok) {
          const errMsg = sendErr?.message ?? sendRes?.error ?? "unknown_error";
          await supabase.from("campaign_recipients").update({
            status: "failed",
            error: String(errMsg).slice(0, 500),
          }).eq("id", rcp.id);
          failed++;
        } else {
          await supabase.from("campaign_recipients").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: sendRes?.provider_message_id ?? null,
            message_id: sendRes?.message_id ?? null,
          }).eq("id", rcp.id);
          sent++;
        }
      } catch (e: any) {
        await supabase.from("campaign_recipients").update({
          status: "failed",
          error: String(e?.message ?? e).slice(0, 500),
        }).eq("id", rcp.id);
        failed++;
      }

      processed++;
    }

    // Update aggregate counters on the campaign
    const { data: counts } = await supabase
      .from("campaign_recipients")
      .select("status")
      .eq("campaign_id", campaignId);
    const tally = (counts ?? []).reduce((acc: any, r: any) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    await supabase.from("campaigns").update({
      sent_count: (tally.sent ?? 0) + (tally.delivered ?? 0) + (tally.read ?? 0) + (tally.replied ?? 0),
      delivered_count: (tally.delivered ?? 0) + (tally.read ?? 0) + (tally.replied ?? 0),
      read_count: (tally.read ?? 0) + (tally.replied ?? 0),
      replied_count: tally.replied ?? 0,
      failed_count: tally.failed ?? 0,
    }).eq("id", campaignId);

    // Auto-complete if no pending/sending left
    const { count: stillPending } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "sending"]);
    if ((stillPending ?? 0) === 0) {
      await supabase.from("campaigns").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", campaignId);
    }

    return jsonOk({ ok: true, processed, sent, failed });
  } finally {
    // Best-effort release. If it throws, the lease auto-expires in 90s.
    try {
      await supabase.rpc('release_campaign_tick_lease', { _campaign_id: campaignId });
    } catch (releaseErr) {
      console.error('[campaign-dispatch] release_campaign_tick_lease failed', releaseErr);
    }
  }
});
