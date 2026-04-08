import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { media_url, message_id, tenant_id } = await req.json();

    if (!media_url || !tenant_id) {
      return new Response(JSON.stringify({ error: "media_url and tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Obter API key do tenant (mesma hierarquia do ai-generate)
    const { data: aiConfig } = await supabase
      .from("ai_configs")
      .select("*, global_api_key:global_api_keys(*)")
      .eq("tenant_id", tenant_id)
      .eq("task_type", "message_generation")
      .maybeSingle();

    const apiKey = aiConfig?.api_key_encrypted
      || aiConfig?.global_api_key?.api_key_encrypted
      || Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key found for transcription" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Baixar o áudio da URL
    console.log("transcribe-audio: downloading audio from", media_url.substring(0, 80));
    const audioResponse = await fetch(media_url);
    if (!audioResponse.ok) {
      return new Response(JSON.stringify({ error: "Failed to download audio", status: audioResponse.status }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const audioBlob = await audioResponse.blob();

    // 3. Enviar para OpenAI Whisper API
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

    console.log("transcribe-audio: sending to Whisper API, size:", audioBlob.size);
    const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text();
      console.error("transcribe-audio: Whisper error", whisperResponse.status, errText);
      return new Response(JSON.stringify({ error: "Whisper transcription failed", details: errText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await whisperResponse.json();
    const transcription = result.text || "";

    console.log("transcribe-audio: transcription result:", transcription.substring(0, 100));

    // 4. Salvar transcrição no provider_metadata da mensagem
    if (message_id && transcription) {
      const { data: msgRow } = await supabase
        .from("messages")
        .select("provider_metadata")
        .eq("id", message_id)
        .single();

      const currentMetadata = (msgRow?.provider_metadata as Record<string, unknown>) || {};
      await supabase.from("messages").update({
        provider_metadata: { ...currentMetadata, audio_transcription: transcription },
      }).eq("id", message_id);
    }

    return new Response(JSON.stringify({ transcription }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("transcribe-audio error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
