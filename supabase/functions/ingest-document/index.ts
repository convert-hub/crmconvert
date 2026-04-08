import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { document_id, tenant_id } = await req.json();
    if (!document_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "Missing document_id or tenant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ingest] Dispatching job for document ${document_id}`);

    const supabase = getSupabase();

    // Verify document exists
    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("id", document_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ success: false, error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as processing and clear old error
    await supabase.from("knowledge_documents").update({
      status: "processing",
      error: null,
      chunk_count: 0,
    }).eq("id", document_id);

    // Delete old chunks
    await supabase.from("knowledge_chunks").delete().eq("document_id", document_id);

    // Enqueue job for the worker
    const { data: jobId, error: jobErr } = await supabase.rpc("enqueue_job", {
      _type: "ingest_document",
      _payload: JSON.stringify({ document_id, tenant_id }),
      _tenant_id: tenant_id,
      _idempotency_key: `ingest_${document_id}_${Date.now()}`,
    });

    if (jobErr) {
      console.error("[ingest] Failed to enqueue job:", jobErr);
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "Falha ao enfileirar processamento: " + jobErr.message,
      }).eq("id", document_id);

      return new Response(JSON.stringify({ success: false, error: jobErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ingest] Job enqueued: ${jobId}`);

    return new Response(JSON.stringify({ success: true, message: "Job enqueued", document_id, job_id: jobId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ingest] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
