import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "npm:unpdf@0.12.1";

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

async function processDocument(document_id: string, tenant_id: string) {
  const supabase = getSupabase();

  try {
    console.log(`[ingest] Starting processing for document ${document_id}`);

    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (docErr || !doc) {
      console.error("[ingest] Document not found:", docErr);
      return;
    }

    await supabase.from("knowledge_documents").update({ status: "processing" }).eq("id", document_id);

    // Clean up old chunks for reprocessing support
    console.log(`[ingest] Deleting old chunks for document ${document_id}`);
    await supabase.from("knowledge_chunks").delete().eq("document_id", document_id);

    // Download file
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("crm-files")
      .download(doc.storage_path);

    if (dlErr || !fileData) {
      console.error("[ingest] Failed to download file:", dlErr);
      await supabase.from("knowledge_documents").update({ status: "error", error: "Failed to download file" }).eq("id", document_id);
      return;
    }

    // Extract text
    let text = "";
    const mime = doc.mime_type || "";
    console.log(`[ingest] File MIME type: ${mime}, size: ${doc.file_size}`);

    if (mime.includes("text/plain") || mime.includes("text/csv") || mime.includes("text/markdown")) {
      text = await fileData.text();
    } else if (mime.includes("application/json")) {
      text = await fileData.text();
    } else if (mime.includes("pdf")) {
      // Use unpdf for proper PDF text extraction
      try {
        console.log("[ingest] Extracting text from PDF using unpdf...");
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const pdfResult = await extractText(uint8);
        // extractText may return text as string or array of page strings
        const rawPdfText = pdfResult.text;
        text = Array.isArray(rawPdfText) ? rawPdfText.join("\n") : String(rawPdfText || "");
        console.log(`[ingest] unpdf extracted ${text.length} characters, pages: ${pdfResult.totalPages}`);
      } catch (pdfErr) {
        console.warn("[ingest] unpdf failed, trying regex fallback:", pdfErr);
        try {
          const rawText = await fileData.text();
          const readable = rawText.match(/[\x20-\x7E\xC0-\xFF]{20,}/g);
          text = readable ? readable.join("\n") : "";
          const btBlocks = rawText.match(/BT[\s\S]*?ET/g);
          if (btBlocks) {
            const extracted = btBlocks
              .map(b => {
                const tjMatches = b.match(/\(([^)]*)\)/g);
                return tjMatches ? tjMatches.map(m => m.slice(1, -1)).join(" ") : "";
              })
              .filter(Boolean)
              .join("\n");
            if (extracted.length > text.length) text = extracted;
          }
          console.log(`[ingest] Regex fallback extracted ${text.length} characters`);
        } catch (fallbackErr) {
          console.error("[ingest] Regex fallback also failed:", fallbackErr);
          text = "";
        }
      }
    } else {
      // Fallback for other file types
      try {
        const rawText = await fileData.text();
        text = rawText.replace(/[^\x20-\x7E\xC0-\xFF\n\r\t]/g, " ").replace(/\s{3,}/g, "\n");
      } catch {
        text = "";
      }
    }

    console.log(`[ingest] Total extracted text length: ${text.length}`);

    if (!text || text.trim().length < 10) {
      await supabase.from("knowledge_documents").update({
        status: "error",
        error: "Não foi possível extrair texto do documento. Use arquivos .txt, .csv ou .md para melhores resultados."
      }).eq("id", document_id);
      return;
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
      return;
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
      return;
    }

    // Generate embeddings in small batches
    const BATCH_SIZE = 5;
    let totalChunksInserted = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      console.log(`[ingest] Sending embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${batch.length} chunks)`);

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
        console.error("[ingest] Embeddings API error:", errText);
        await supabase.from("knowledge_documents").update({
          status: "error",
          error: `Erro ao gerar embeddings: ${embResponse.status}`
        }).eq("id", document_id);
        return;
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
        return;
      }

      totalChunksInserted += batch.length;
    }

    await supabase.from("knowledge_documents").update({
      status: "completed",
      chunk_count: totalChunksInserted
    }).eq("id", document_id);

    console.log(`[ingest] Document ${document_id} processed successfully: ${totalChunksInserted} chunks`);
  } catch (e) {
    console.error("[ingest] processDocument critical error:", e instanceof Error ? e.message : e, e instanceof Error ? e.stack : "");
    const supabase2 = getSupabase();
    await supabase2.from("knowledge_documents").update({
      status: "error",
      error: e instanceof Error ? e.message : "Unknown error"
    }).eq("id", document_id);
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

    // Fire and forget — process in background
    EdgeRuntime.waitUntil(processDocument(document_id, tenant_id));

    return new Response(JSON.stringify({ success: true, message: "Processing started", document_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ingest] Request error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
