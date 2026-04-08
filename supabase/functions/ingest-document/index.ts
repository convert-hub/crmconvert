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
    const { document_id, tenant_id, extracted_text } = await req.json();
    if (!document_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "Missing document_id or tenant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ingest] Request for ${document_id}, text length: ${extracted_text?.length || 0}`);

    const supabase = getSupabase();

    // Get document
    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ success: false, error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("knowledge_documents").update({ status: "processing" }).eq("id", document_id);

    // Delete old chunks
    await supabase.from("knowledge_chunks").delete().eq("document_id", document_id);

    // Determine text
    const mime = doc.mime_type || "";
    let text = "";

    if (extracted_text && extracted_text.trim().length > 10) {
      text = extracted_text;
      console.log(`[ingest] Using pre-extracted text: ${text.length} chars`);
    } else if (mime.includes("pdf")) {
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "PDF precisa ser reprocessado pela interface. Clique em Reprocessar."
      }).eq("id", document_id);
      return new Response(JSON.stringify({ success: false, message: "PDF requires browser extraction" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // Download and extract text for non-PDF files
      const { data: fileData, error: dlErr } = await supabase.storage
        .from("crm-files")
        .download(doc.storage_path);
      if (dlErr || !fileData) {
        await supabase.from("knowledge_documents").update({ status: "error", error: "Falha no download" }).eq("id", document_id);
        return new Response(JSON.stringify({ success: false, message: "Download failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      text = await fileData.text();
      console.log(`[ingest] Text file: ${text.length} chars`);
    }

    if (!text || text.trim().length < 10) {
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "Texto insuficiente extraído do documento."
      }).eq("id", document_id);
      return new Response(JSON.stringify({ success: false, message: "No text" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunk text
    const CHUNK_SIZE = 2000;
    const CHUNK_OVERLAP = 200;
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      let chunk = text.slice(start, end);
      if (end < text.length) {
        const bp = Math.max(chunk.lastIndexOf("."), chunk.lastIndexOf("\n"));
        if (bp > CHUNK_SIZE * 0.5) chunk = chunk.slice(0, bp + 1);
      }
      if (chunk.trim().length > 20) chunks.push(chunk.trim());
      start += chunk.length - CHUNK_OVERLAP;
      if (start <= 0 && chunks.length > 0) break;
    }

    console.log(`[ingest] ${chunks.length} chunks`);

    if (chunks.length === 0) {
      await supabase.from("knowledge_documents").update({ status: "error", error: "Nenhum chunk gerado" }).eq("id", document_id);
      return new Response(JSON.stringify({ success: false, message: "No chunks" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get API key
    let apiKey: string | null = null;
    const { data: aiConfig } = await supabase
      .from("ai_configs")
      .select("*, global_api_key:global_api_keys(*)")
      .eq("tenant_id", tenant_id)
      .eq("task_type", "message_generation")
      .maybeSingle();
    if (aiConfig) apiKey = aiConfig.api_key_encrypted || aiConfig.global_api_key?.api_key_encrypted || null;
    if (!apiKey) apiKey = Deno.env.get("OPENAI_API_KEY") || null;

    if (!apiKey) {
      await supabase.from("knowledge_documents").update({ status: "error", error: "API key não configurada" }).eq("id", document_id);
      return new Response(JSON.stringify({ success: false, message: "No API key" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Embed in batches of 2
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 2) {
      const batch = chunks.slice(i, i + 2);
      console.log(`[ingest] Embedding batch ${Math.floor(i/2)+1}/${Math.ceil(chunks.length/2)}`);

      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch, dimensions: 1536 }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[ingest] Embedding error:`, errText);
        await supabase.from("knowledge_documents").update({ status: "error", error: `Embedding error: HTTP ${resp.status}` }).eq("id", document_id);
        return new Response(JSON.stringify({ success: false, message: `Embedding error` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await resp.json();
      const rows = batch.map((content, idx) => ({
        tenant_id, document_id, content,
        embedding: JSON.stringify(result.data[idx].embedding),
        chunk_index: i + idx,
        document_name: doc.name,
        metadata: { char_count: content.length, category: doc.category || null },
      }));

      const { error: insErr } = await supabase.from("knowledge_chunks").insert(rows);
      if (insErr) {
        console.error("[ingest] Insert error:", insErr);
        await supabase.from("knowledge_documents").update({ status: "error", error: "Erro ao salvar: " + insErr.message }).eq("id", document_id);
        return new Response(JSON.stringify({ success: false, message: "Insert error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inserted += batch.length;
    }

    await supabase.from("knowledge_documents").update({ status: "completed", chunk_count: inserted }).eq("id", document_id);
    console.log(`[ingest] DONE: ${inserted} chunks`);

    return new Response(JSON.stringify({ success: true, message: "OK", document_id, chunks: inserted }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ingest] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
