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

// Token resolver — supports contact.{name,email,phone}, contact.custom.<key>,
// opportunity.{title,value}, opportunity.custom.<key>. Returns { text, unresolved }
// where `unresolved` is the first token that had no value (literal kept in text).
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
function resolveTemplateVariable(
  template: string,
  contact: any,
  opportunity: any,
): { text: string; unresolved: string | null } {
  if (!template) return { text: "", unresolved: null };
  let firstUnresolved: string | null = null;
  const cc = (contact?.custom_fields && typeof contact.custom_fields === "object") ? contact.custom_fields : {};
  const oc = (opportunity?.custom_fields && typeof opportunity.custom_fields === "object") ? opportunity.custom_fields : {};
  const text = template.replace(TOKEN_RE, (raw, path: string) => {
    let v: unknown = undefined;
    if (path === "contact.name") v = contact?.name;
    else if (path === "contact.email") v = contact?.email;
    else if (path === "contact.phone") v = contact?.phone;
    else if (path.startsWith("contact.custom.")) v = cc[path.slice("contact.custom.".length)];
    else if (path === "opportunity.title") v = opportunity?.title;
    else if (path === "opportunity.value") v = opportunity?.value;
    else if (path.startsWith("opportunity.custom.")) v = oc[path.slice("opportunity.custom.".length)];
    if (v === undefined || v === null || v === "") {
      if (!firstUnresolved) firstUnresolved = path;
      return raw; // keep literal so failure is visible in variables_used
    }
    return String(v);
  });
  return { text, unresolved: firstUnresolved };
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

  // Auth: three accepted callers
  //   1) service role token (internal/admin invocations)
  //   2) pg_cron via anon token (only allowed for non-destructive actions: 'tick', 'start')
  //   3) authenticated user that is admin/manager of the campaign's tenant
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return jsonOk({ ok: false, error: "Unauthorized" }, 401);

  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  let isServiceRole = token === SERVICE_ROLE;
  let isCronAnon = !isServiceRole && token === ANON_KEY;
  let callerUserId: string | null = null;
  if (!isServiceRole && !isCronAnon) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return jsonOk({ ok: false, error: "Unauthorized" }, 401);
    callerUserId = claimsData.claims.sub;
  }

  // Cron caller may only kick the dispatcher; never pause/cancel.
  if (isCronAnon && !["tick", "start"].includes(action)) {
    return jsonOk({ ok: false, error: "Forbidden" }, 403);
  }

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("*, whatsapp_instance:whatsapp_instances!campaigns_whatsapp_instance_id_fkey(*), template:whatsapp_message_templates!campaigns_template_id_fkey(*)")
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr || !campaign) return jsonOk({ ok: false, error: "campaign_not_found" }, 404);

  // Tenant authorization: end-user callers must be admin/manager of the campaign's tenant
  if (!isServiceRole && !isCronAnon) {
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
  if (!instance) {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return jsonOk({ ok: false, error: "instance_missing" }, 400);
  }
  if (!["meta_cloud", "uazapi"].includes(instance.provider)) {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return jsonOk({ ok: false, error: `unsupported_provider:${instance.provider}` }, 400);
  }
  if (!template) {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return jsonOk({ ok: false, error: "template_missing" }, 400);
  }

  const throttle = Math.max(1, Math.min(campaign.throttle_per_minute ?? 60, 200));
  const intervalMs = Math.max(50, Math.round(60_000 / throttle));
  // Reserve ~55s per tick so we finish before the next cron call (cron runs every minute).
  const TICK_BUDGET_MS = 55_000;
  const perTickLimit = Math.max(1, Math.min(throttle, Math.floor(TICK_BUDGET_MS / intervalMs) || 1));
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
      _limit: perTickLimit,
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
      .select("id, contact_id, variables_used, contact:contacts(id, name, phone, email, do_not_contact, consent_given, custom_fields)")
      .in("id", claimedIds)
      .order("created_at", { ascending: true });

    const bodyComp = (template.components as any[])?.find((c: any) => c.type === "BODY");
    const placeholders = bodyComp ? Array.from(new Set(((bodyComp.text as string) ?? "").match(/\{\{(\d+)\}\}/g) || []))
      .map((m: string) => m.replace(/[{}]/g, "")).sort((a, b) => Number(a) - Number(b)) : [];

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const rcp of (pending ?? [])) {
      // Re-check campaign status before each send so a click on "Pausar" / "Cancelar"
      // stops the loop within seconds instead of waiting for the full throttle batch.
      const { data: liveStatus } = await supabase
        .from("campaigns")
        .select("status")
        .eq("id", campaignId)
        .maybeSingle();
      if (liveStatus && ["paused", "cancelled", "completed"].includes(liveStatus.status)) {
        // Release this recipient (still 'sending' from the atomic claim) back to 'pending'
        // so the next run picks it up. The reaper would do this in 10min — we do it now.
        await supabase.from("campaign_recipients")
          .update({ status: "pending" })
          .eq("id", rcp.id)
          .eq("status", "sending");
        break;
      }

      const contact = (rcp as any).contact;
      if (!contact?.phone || contact.do_not_contact) {
        await supabase.from("campaign_recipients").update({
          status: "skipped",
          error: contact?.do_not_contact ? "contact_do_not_contact" : "no_phone",
        }).eq("id", rcp.id);
        processed++;
        continue;
      }

      // Hydrate latest open opportunity for richer variable resolution
      let opportunity: any = null;
      const { data: oppRow } = await supabase
        .from("opportunities")
        .select("title, value, custom_fields")
        .eq("contact_id", contact.id)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      opportunity = oppRow ?? null;

      const resolved: Record<string, string> = {};
      let unresolvedToken: string | null = null;
      for (const p of placeholders) {
        const tplVar = (campaign.template_variables as any)?.[p] ?? "";
        const r = resolveTemplateVariable(tplVar, contact, opportunity);
        resolved[p] = r.text;
        if (r.unresolved && !unresolvedToken) unresolvedToken = r.unresolved;
      }

      if (unresolvedToken) {
        // Do NOT ship a literal {{...}} to the customer. Mark recipient failed.
        await supabase.from("campaign_recipients").update({
          status: "failed",
          variables_used: resolved,
          error: `unresolved_variable:${unresolvedToken}`,
        }).eq("id", rcp.id);
        failed++;
        processed++;
        continue;
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

      try {
        let sendOk = false;
        let providerMessageId: string | null = null;
        let messageRowId: string | null = null;
        let errMsg: string | null = null;

        if (instance.provider === "meta_cloud") {
          const components: any[] = [];
          if (placeholders.length > 0) {
            components.push({
              type: "body",
              parameters: placeholders.map(p => ({ type: "text", text: resolved[p] ?? "" })),
            });
          }
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
            errMsg = sendErr?.message ?? sendRes?.error ?? "unknown_error";
          } else {
            sendOk = true;
            providerMessageId = sendRes?.provider_message_id ?? null;
            messageRowId = sendRes?.message_id ?? null;
          }
        } else {
          // UAZAPI: render the template body locally and send as plain text.
          const bodyText = (bodyComp?.text as string) ?? "";
          const rendered = bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => resolved[n] ?? "");
          const { data: sendRes, error: sendErr } = await supabase.functions.invoke("uazapi-proxy", {
            body: {
              action: "send_message",
              tenant_id: campaign.tenant_id,
              phone: contact.phone,
              message: rendered,
              conversation_id: conversation?.id,
            },
          });
          if (sendErr || sendRes?.ok === false || sendRes?.error) {
            errMsg = sendRes?.error ?? sendErr?.message ?? "unknown_error";
          } else {
            sendOk = true;
            providerMessageId = sendRes?.provider_message_id ?? null;
            // Persist outbound message so it appears in the conversation thread
            // (webhook-uazapi skips wasSentByApi callbacks).
            if (conversation?.id) {
              const { data: persisted } = await supabase.from("messages").insert({
                tenant_id: campaign.tenant_id,
                conversation_id: conversation.id,
                direction: "outbound",
                content: rendered,
                provider_message_id: providerMessageId,
                provider_metadata: { source: "campaign", campaign_id: campaignId },
              }).select("id").single();
              messageRowId = persisted?.id ?? null;
            }
          }
        }

        if (!sendOk) {
          await supabase.from("campaign_recipients").update({
            status: "failed",
            error: String(errMsg ?? "unknown_error").slice(0, 500),
          }).eq("id", rcp.id);
          failed++;
        } else {
          await supabase.from("campaign_recipients").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: providerMessageId,
            message_id: messageRowId,
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

    // Counters are maintained by tg_campaign_recipients_counters trigger — do NOT
    // recompute/overwrite here (would race with webhook delivered/read updates).

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
