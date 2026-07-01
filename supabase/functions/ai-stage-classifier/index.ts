// AI Pipeline Stage Classifier
// Reads recent messages of a conversation, decides the best stage, and either
// suggests (mode='suggestion') or applies (mode='auto') the change.
// Called by the worker (never inline in a webhook). verify_jwt=false; only reachable
// via SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("AI_STAGE_CLASSIFIER_MODEL") || "google/gemini-3-flash-preview";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Stage = {
  id: string;
  name: string;
  position: number;
  is_won: boolean | null;
  is_lost: boolean | null;
  ai_criteria: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { tenant_id, conversation_id } = await req.json();
    if (!tenant_id || !conversation_id) {
      return json({ error: "tenant_id and conversation_id required" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, svc);

    // 1) Tenant AI Pipeline config
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", tenant_id).maybeSingle();
    const cfg = (tenant?.settings as any)?.ai_pipeline || {};
    const enabled = cfg.enabled === true;
    if (!enabled) return json({ skipped: "disabled" });

    const mode: "suggestion" | "auto" = cfg.mode === "auto" ? "auto" : "suggestion";
    const minConfidence: number = typeof cfg.min_confidence === "number" ? cfg.min_confidence : 0.7;
    const direction: "forward_only" | "any" = cfg.direction === "any" ? "any" : "forward_only";
    const excludeWonLost: boolean = cfg.exclude_won_lost !== false; // default true

    // 2) Resolve opportunity for this conversation
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, tenant_id, contact_id, opportunity_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv || conv.tenant_id !== tenant_id) return json({ skipped: "conv_not_found" });

    let opp: any = null;
    if (conv.opportunity_id) {
      const { data } = await supabase.from("opportunities").select("*").eq("id", conv.opportunity_id).maybeSingle();
      opp = data;
    }
    if (!opp && conv.contact_id) {
      const { data } = await supabase
        .from("opportunities")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("contact_id", conv.contact_id)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      opp = data;
    }
    if (!opp) return json({ skipped: "no_opportunity" });

    // 3) Debounce (data-level): if an AI move for this opp in the last 120s exists, bail
    const cutoff = new Date(Date.now() - 120 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("stage_moves")
      .select("id")
      .eq("opportunity_id", opp.id)
      .eq("is_ai_move", true)
      .gte("created_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) return json({ skipped: "debounced" });

    // 4) Load stages of the pipeline (exclude won/lost)
    const { data: allStages } = await supabase
      .from("stages")
      .select("id,name,position,is_won,is_lost,ai_criteria")
      .eq("tenant_id", tenant_id)
      .eq("pipeline_id", opp.pipeline_id)
      .order("position", { ascending: true });
    const stages = (allStages || []).filter((s) => !s.is_won && !s.is_lost) as Stage[];
    if (stages.length < 2) return json({ skipped: "not_enough_stages" });

    const currentStage = stages.find((s) => s.id === opp.stage_id);
    if (!currentStage) return json({ skipped: "current_stage_terminal_or_unknown" });

    // 5) Load last 6 non-internal messages + contact
    const { data: msgs } = await supabase
      .from("messages")
      .select("direction,content,media_type,created_at")
      .eq("conversation_id", conversation_id)
      .eq("is_internal", false)
      .order("created_at", { ascending: false })
      .limit(6);
    const messages = (msgs || []).reverse();
    if (messages.length === 0) return json({ skipped: "no_messages" });

    let contactName = "";
    let ctwa: any = null;
    if (conv.contact_id) {
      const { data: c } = await supabase.from("contacts").select("name,custom_fields").eq("id", conv.contact_id).maybeSingle();
      contactName = c?.name || "";
      ctwa = (c?.custom_fields as any)?.ctwa || null;
    }

    // 6) Build prompt
    const stageCatalog = stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      criteria: s.ai_criteria || "(sem critérios definidos)",
    }));

    const system = `Você é um classificador de etapas de pipeline comercial. Sua tarefa é decidir em qual etapa do funil o lead está com base nas últimas mensagens da conversa.

REGRAS ESTRITAS:
- Responda APENAS com um JSON válido, sem texto extra.
- Escolha "suggested_stage_id" APENAS entre os IDs listados no catálogo.
- Se não houver evidência suficiente de mudança, retorne o mesmo id da etapa atual.
- "confidence" é um número entre 0 e 1.
- "reason" curto (máx. 200 caracteres), em pt-BR.
- "criteria_met" é uma lista curta de bullets (strings) que sustentam a decisão.
- Considere os "criteria" descritos por etapa como fonte primária de verdade.

Formato esperado:
{"suggested_stage_id":"<uuid>","confidence":0.0,"reason":"...","criteria_met":["..."]}`;

    const userPayload = {
      contact: { name: contactName, ctwa },
      current_stage_id: currentStage.id,
      current_stage_name: currentStage.name,
      stages: stageCatalog,
      messages: messages.map((m) => ({
        role: m.direction === "inbound" ? "cliente" : "empresa",
        text: (m.content || "").slice(0, 1000),
        media: m.media_type || null,
        at: m.created_at,
      })),
    };

    // 7) Call Lovable AI Gateway
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const aiResp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("[ai-stage-classifier] gateway error", aiResp.status, errText);
      if (aiResp.status === 429) return json({ error: "rate_limited" }, 429);
      if (aiResp.status === 402) return json({ error: "credits_exhausted" }, 402);
      return json({ error: "ai_gateway_failed" }, 502);
    }

    const aiData = await aiResp.json();
    const raw = aiData?.choices?.[0]?.message?.content;
    let parsed: any;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      console.error("[ai-stage-classifier] json_parse_failed", raw);
      return json({ error: "invalid_ai_output" }, 502);
    }

    const suggestedId: string | undefined = parsed?.suggested_stage_id;
    const confidence: number = typeof parsed?.confidence === "number" ? parsed.confidence : 0;
    const reason: string = String(parsed?.reason || "").slice(0, 500);
    const criteria_met = Array.isArray(parsed?.criteria_met) ? parsed.criteria_met.slice(0, 10) : [];

    // 8) Guard-rails
    const suggestedStage = stages.find((s) => s.id === suggestedId);
    const ai_pipeline_last = {
      at: new Date().toISOString(),
      current_stage_id: currentStage.id,
      suggested_stage_id: suggestedId || null,
      confidence,
      reason,
      criteria_met,
      mode,
      applied: false,
      status: "ignored" as string,
    };

    if (!suggestedStage) {
      ai_pipeline_last.status = "invalid_stage";
      await patchOppQualification(supabase, opp, ai_pipeline_last);
      return json({ skipped: "invalid_stage_id" });
    }
    if (suggestedStage.id === currentStage.id) {
      ai_pipeline_last.status = "same_stage";
      await patchOppQualification(supabase, opp, ai_pipeline_last);
      return json({ skipped: "same_stage" });
    }
    if (confidence < minConfidence) {
      ai_pipeline_last.status = "low_confidence";
      await patchOppQualification(supabase, opp, ai_pipeline_last);
      return json({ skipped: "low_confidence", confidence });
    }
    if (direction === "forward_only" && suggestedStage.position <= currentStage.position) {
      ai_pipeline_last.status = "regression_blocked";
      await patchOppQualification(supabase, opp, ai_pipeline_last);
      return json({ skipped: "regression_blocked" });
    }

    // 9) Action
    if (mode === "suggestion") {
      const { error: insErr } = await supabase.from("stage_moves").insert({
        tenant_id,
        opportunity_id: opp.id,
        from_stage_id: currentStage.id,
        to_stage_id: suggestedStage.id,
        is_ai_move: true,
        status: "suggested",
        confidence_score: confidence,
        ai_reason: reason,
        criteria_met,
        moved_by: null,
      });
      if (insErr) {
        console.error("[ai-stage-classifier] insert stage_move failed", insErr);
        return json({ error: "insert_failed" }, 500);
      }
      ai_pipeline_last.status = "suggested";
      await patchOppQualification(supabase, opp, ai_pipeline_last);
      return json({ ok: true, action: "suggested", from: currentStage.id, to: suggestedStage.id, confidence });
    }

    // mode === 'auto'
    const { error: updErr } = await supabase
      .from("opportunities")
      .update({ stage_id: suggestedStage.id, updated_at: new Date().toISOString() })
      .eq("id", opp.id);
    if (updErr) {
      console.error("[ai-stage-classifier] update opportunity failed", updErr);
      return json({ error: "update_failed" }, 500);
    }
    await supabase.from("stage_moves").insert({
      tenant_id,
      opportunity_id: opp.id,
      from_stage_id: currentStage.id,
      to_stage_id: suggestedStage.id,
      is_ai_move: true,
      status: "applied",
      confidence_score: confidence,
      ai_reason: reason,
      criteria_met,
      moved_by: null,
    });
    ai_pipeline_last.status = "applied";
    ai_pipeline_last.applied = true;
    await patchOppQualification(supabase, opp, ai_pipeline_last);
    return json({ ok: true, action: "applied", from: currentStage.id, to: suggestedStage.id, confidence });
  } catch (e) {
    console.error("[ai-stage-classifier] error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function patchOppQualification(supabase: any, opp: any, ai_pipeline_last: any) {
  try {
    const q = (opp?.qualification_data as any) || {};
    q.ai_pipeline_last = ai_pipeline_last;
    await supabase.from("opportunities").update({ qualification_data: q }).eq("id", opp.id);
  } catch (e) {
    console.error("[ai-stage-classifier] patchOppQualification failed", e);
  }
}
