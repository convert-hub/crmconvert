import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { document_id, tenant_id } = await req.json();
    if (!document_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "Missing document_id or tenant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get document
    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status to processing
    await supabase.from("knowledge_documents").update({ status: "processing" }).eq("id", document_id);

    // Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("crm-files")
      .download(doc.storage_path);

    if (dlErr || !fileData) {
      await supabase.from("knowledge_documents").update({ status: "error", error: "Failed to download file" }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract text based on mime type
    let text = "";
    const mime = doc.mime_type || "";

    if (mime.includes("text/plain") || mime.includes("text/csv") || mime.includes("text/markdown")) {
      text = await fileData.text();
    } else if (mime.includes("application/json")) {
      const json = await fileData.text();
      text = json;
    } else {
      // For PDF, DOCX etc - extract raw text
      // Simple approach: read as text, filter binary noise
      try {
        const rawText = await fileData.text();
        // Try to extract readable content from PDF
        if (mime.includes("pdf")) {
          // Extract text between stream/endstream or readable sequences
          const readable = rawText.match(/[\x20-\x7E\xC0-\xFF]{20,}/g);
          text = readable ? readable.join("\n") : "";
          // Also try BT/ET text blocks
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
        } else {
          text = rawText.replace(/[^\x20-\x7E\xC0-\xFF\n\r\t]/g, " ").replace(/\s{3,}/g, "\n");
        }
      } catch {
        text = "";
      }
    }

    if (!text || text.trim().length < 10) {
      await supabase.from("knowledge_documents").update({ 
        status: "error", 
        error: "Não foi possível extrair texto do documento. Use arquivos .txt, .csv ou .md para melhores resultados." 
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "Could not extract text" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunk the text (500-1000 tokens ~ 2000-4000 chars with overlap)
    const CHUNK_SIZE = 2000;
    const CHUNK_OVERLAP = 200;
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      let chunk = text.slice(start, end);
      
      // Try to break at sentence boundary
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

    if (chunks.length === 0) {
      await supabase.from("knowledge_documents").update({ status: "error", error: "Nenhum chunk gerado" }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No chunks generated" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get OpenAI API key for embeddings
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
        error: "Chave de API OpenAI não configurada. Configure nas configurações de IA." 
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No OpenAI API key" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate embeddings in batches
    const BATCH_SIZE = 20;
    let totalChunksInserted = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
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
        console.error("Embeddings error:", errText);
        await supabase.from("knowledge_documents").update({ 
          status: "error", 
          error: `Erro ao gerar embeddings: ${embResponse.status}` 
        }).eq("id", document_id);
        return new Response(JSON.stringify({ error: "Embeddings failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const embResult = await embResponse.json();
      const embeddings = embResult.data;

      // Insert chunks with embeddings
      const chunkRows = batch.map((content, idx) => ({
        tenant_id,
        document_id,
        content,
        embedding: JSON.stringify(embeddings[idx].embedding),
        chunk_index: i + idx,
        metadata: { char_count: content.length },
      }));

      const { error: insertErr } = await supabase.from("knowledge_chunks").insert(chunkRows);
      if (insertErr) {
        console.error("Insert chunks error:", insertErr);
        await supabase.from("knowledge_documents").update({ 
          status: "error", 
          error: "Erro ao salvar chunks: " + insertErr.message 
        }).eq("id", document_id);
        return new Response(JSON.stringify({ error: "Insert failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      totalChunksInserted += batch.length;
    }

    // Update document as completed
    await supabase.from("knowledge_documents").update({ 
      status: "completed", 
      chunk_count: totalChunksInserted 
    }).eq("id", document_id);

    return new Response(JSON.stringify({ 
      success: true, 
      chunks: totalChunksInserted,
      document_id 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ingest-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
