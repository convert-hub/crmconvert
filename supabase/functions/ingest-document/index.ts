import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import pdf from "https://esm.sh/pdf-parse@1.1.1/lib/pdf-parse.js";

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

async function extractTextFromStorage(supabase: any, storagePath: string, mime: string): Promise<string> {
  console.log(`[ingest] Downloading file from storage: ${storagePath}`);
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("crm-files")
    .download(storagePath);

  if (dlErr || !fileData) {
    throw new Error(`Failed to download file: ${dlErr?.message || "no data"}`);
  }

  console.log(`[ingest] File downloaded, MIME: ${mime}, size: ${fileData.size}`);

  // PDF extraction via pdf-parse
  if (mime.includes("pdf")) {
    try {
      console.log("[ingest] Extracting text from PDF via pdf-parse...");
      const arrayBuffer = await fileData.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const result = await pdf(uint8);
      const text = result.text || "";
      console.log(`[ingest] PDF extracted: ${text.length} chars, ${result.numpages} pages`);
      return text;
    } catch (pdfErr) {
      console.error("[ingest] pdf-parse failed:", pdfErr instanceof Error ? pdfErr.message : pdfErr);
      return "";
    }
  }

  // Text-based files
  if (mime.includes("text/plain") || mime.includes("text/csv") || mime.includes("text/markdown") || mime.includes("application/json")) {
    const text = await fileData.text();
    console.log(`[ingest] Text file extracted: ${text.length} chars`);
    return text;
  }

  // Fallback: try reading as text
  try {
    const rawText = await fileData.text();
    const cleaned = rawText.replace(/[^\x20-\x7E\xC0-\xFF\n\r\t]/g, " ").replace(/\s{3,}/g, "\n");
    console.log(`[ingest] Fallback text extraction: ${cleaned.length} chars`);
    return cleaned;
  } catch {
    return "";
  }
}

async function processDocument(document_id: string, tenant_id: string) {
  const supabase = getSupabase();

  try {
    console.log(`[ingest] === START processing document ${document_id} ===`);

    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (docErr || !doc) {
      console.error("[ingest] Document not found:", docErr);
      await supabase.from("knowledge_documents").update({ status: "error", error: "Documento não encontrado" }).eq("id", document_id);
      return { success: false, error: "Document not found" };
    }

    await supabase.from("knowledge_documents").update({ status: "processing" }).eq("id", document_id);

    // Clean up old chunks
    console.log(`[ingest] Deleting old chunks for document ${document_id}`);
    await supabase.from("knowledge_chunks").delete().eq("document_id", document_id);

    // Extract text from file
    const mime = doc.mime_type || "";
    let text = "";
    try {
      text = await extractTextFromStorage(supabase, doc.storage_path, mime);
    } catch (e) {
      console.error("[ingest] Text extraction failed:", e);
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: `Falha na extração de texto: ${e instanceof Error ? e.message : "erro desconhecido"}`
      }).eq("id", document_id);
      return { success: false, error: "Text extraction failed" };
    }

    console.log(`[ingest] Total text length: ${text.length}`);

    if (!text || text.trim().length < 10) {
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "Não foi possível extrair texto do documento. Use arquivos .txt, .csv ou .md para melhores resultados."
      }).eq("id", document_id);
      return { success: false, error: "No text extracted" };
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
        const lastPeriod = chunk.lastIndexOf(".");
        const lastNewline = chunk.lastIndexOf("\n");
        const breakPoint = Math.max(lastPeriod, lastNewline);
        if (breakPoint > CHUNK_SIZE * 0.5) {
          chunk = chunk.slice(0, breakPoint + 1);
        }
      }

      if (chunk.trim().length > 20) {
        chunks.push(chunk.trim());
      }

      start += chunk.length - CHUNK_OVERLAP;
      if (start <= 0 && chunks.length > 0) break;
    }

    console.log(`[ingest] Generated ${chunks.length} chunks`);

    if (chunks.length === 0) {
      await supabase.from("knowledge_documents").update({ status: "error", error: "Nenhum chunk gerado" }).eq("id", document_id);
      return { success: false, error: "No chunks generated" };
    }

    // Get API key
    let apiKey: string | null = null;
    const { data: aiConfig } = await supabase
      .from("ai_configs")
      .select("*, global_api_key:global_api_keys(*)")
      .eq("tenant_id", tenant_id)
      .eq("task_type", "message_generation")
      .maybeSingle();

    if (aiConfig) {
      apiKey = aiConfig.api_key_encrypted || aiConfig.global_api_key?.api_key_encrypted || null;
    }
    if (!apiKey) {
      apiKey = Deno.env.get("OPENAI_API_KEY") || null;
    }

    if (!apiKey) {
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "Chave de API OpenAI não configurada."
      }).eq("id", document_id);
      return { success: false, error: "No API key" };
    }

    // Generate embeddings in small batches (3 at a time to avoid memory limits)
    const BATCH_SIZE = 3;
    let totalChunksInserted = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      console.log(`[ingest] Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

      const embResponse = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: batch,
          dimensions: 1536,
        }),
      });

      if (!embResponse.ok) {
        const errText = await embResponse.text();
        console.error(`[ingest] Embeddings API error (batch ${batchNum}):`, errText);
        await supabase.from("knowledge_documents").update({
          status: "error",
          error: `Erro ao gerar embeddings (batch ${batchNum}): HTTP ${embResponse.status}`
        }).eq("id", document_id);
        return { success: false, error: `Embeddings API error: ${embResponse.status}` };
      }

      const embResult = await embResponse.json();

      const chunkRows = batch.map((content, idx) => ({
        tenant_id,
        document_id,
        content,
        embedding: JSON.stringify(embResult.data[idx].embedding),
        chunk_index: i + idx,
        document_name: doc.name,
        metadata: { char_count: content.length, category: doc.category || null },
      }));

      const { error: insertErr } = await supabase.from("knowledge_chunks").insert(chunkRows);
      if (insertErr) {
        console.error("[ingest] Insert chunks error:", insertErr);
        await supabase.from("knowledge_documents").update({
          status: "error",
          error: "Erro ao salvar chunks: " + insertErr.message
        }).eq("id", document_id);
        return { success: false, error: "Insert error" };
      }

      totalChunksInserted += batch.length;
      console.log(`[ingest] Batch ${batchNum} inserted. Total so far: ${totalChunksInserted}`);
    }

    await supabase.from("knowledge_documents").update({
      status: "completed",
      chunk_count: totalChunksInserted
    }).eq("id", document_id);

    console.log(`[ingest] === COMPLETED document ${document_id}: ${totalChunksInserted} chunks ===`);
    return { success: true, chunks: totalChunksInserted };
  } catch (e) {
    console.error("[ingest] Critical error:", e instanceof Error ? e.message : e);
    try {
      const supabase2 = getSupabase();
      await supabase2.from("knowledge_documents").update({
        status: "error",
        error: e instanceof Error ? e.message : "Erro crítico desconhecido"
      }).eq("id", document_id);
    } catch (updateErr) {
      console.error("[ingest] Failed to update error status:", updateErr);
    }
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
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

    console.log(`[ingest] Request received for document ${document_id}`);

    // Process synchronously — no EdgeRuntime.waitUntil
    const result = await processDocument(document_id, tenant_id);

    return new Response(JSON.stringify({ success: result.success, message: result.success ? "Processing completed" : result.error, document_id }), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ingest] Request error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
