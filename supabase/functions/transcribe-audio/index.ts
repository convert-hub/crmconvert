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

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get API key (same hierarchy as ai-generate)
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

    // 2. Download audio via UAZAPI (mirrors uazapi-proxy download_media logic)
    let audioBlob: Blob | null = null;
    let detectedMime = "";

    if (message_id) {
      const { data: msgRow } = await supabase
        .from("messages")
        .select("provider_message_id, provider_metadata")
        .eq("id", message_id)
        .single();

      const providerMessageId = msgRow?.provider_message_id;

      if (providerMessageId) {
        // Get WhatsApp instance for this tenant
        const { data: instance } = await supabase
          .from("whatsapp_instances")
          .select("api_url, api_token_encrypted, phone_number")
          .eq("tenant_id", tenant_id)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (instance) {
          const apiBase = instance.api_url.replace(/\/+$/, "");
          const token = instance.api_token_encrypted || "";
          const instancePhone = (instance.phone_number || "").replace(/\D/g, "");

          // Mirror uazapi-proxy: try owner:messageId first, then short messageId
          const fullId = instancePhone ? `${instancePhone}:${providerMessageId}` : providerMessageId;
          console.log("transcribe-audio: downloading via UAZAPI, fullId:", fullId);

          try {
            let dlResponse = await fetch(`${apiBase}/message/download`, {
              method: "POST",
              headers: { "Content-Type": "application/json", token },
              body: JSON.stringify({ id: fullId }),
            });

            // Fallback: try short ID if full ID failed
            if (!dlResponse.ok && instancePhone) {
              console.log(`transcribe-audio: full ID failed (${dlResponse.status}), trying short ID: ${providerMessageId}`);
              dlResponse = await fetch(`${apiBase}/message/download`, {
                method: "POST",
                headers: { "Content-Type": "application/json", token },
                body: JSON.stringify({ id: providerMessageId }),
              });
            }

            if (dlResponse.ok) {
              const contentType = dlResponse.headers.get("content-type") || "";

              if (contentType.includes("application/json")) {
                // UAZAPI returns JSON with fileURL or base64
                const dlData = await dlResponse.json();
                const fileURL = dlData.fileURL || dlData.url || dlData.link;
                const base64 = dlData.base64;
                detectedMime = dlData.mimetype || "";

                if (base64) {
                  console.log("transcribe-audio: using base64 from UAZAPI, mime:", detectedMime);
                  const binaryStr = atob(base64);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                  audioBlob = new Blob([bytes], { type: detectedMime || "audio/ogg" });
                } else if (fileURL) {
                  console.log("transcribe-audio: downloading from UAZAPI fileURL, mime:", detectedMime);
                  const fileResp = await fetch(fileURL);
                  if (fileResp.ok) {
                    audioBlob = await fileResp.blob();
                    if (!detectedMime) {
                      detectedMime = fileResp.headers.get("content-type")?.split(";")[0]?.trim() || "";
                    }
                  }
                }
              } else {
                // Direct binary response
                audioBlob = await dlResponse.blob();
                detectedMime = contentType.split(";")[0].trim();
                console.log("transcribe-audio: got binary response, mime:", detectedMime, "size:", audioBlob.size);
              }
            } else {
              console.log("transcribe-audio: UAZAPI download failed, status:", dlResponse.status);
            }
          } catch (uazErr) {
            console.error("transcribe-audio: UAZAPI download error:", uazErr);
          }
        }
      }
    }

    // 3. Fallback: download from raw media_url if UAZAPI failed
    if (!audioBlob && media_url) {
      console.log("transcribe-audio: fallback to raw media_url:", media_url.substring(0, 80));
      const audioResponse = await fetch(media_url);
      if (!audioResponse.ok) {
        return new Response(JSON.stringify({ error: "Failed to download audio", status: audioResponse.status }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      audioBlob = await audioResponse.blob();
      detectedMime = audioResponse.headers.get("content-type")?.split(";")[0]?.trim()?.toLowerCase() || "";
    }

    if (!audioBlob || audioBlob.size === 0) {
      return new Response(JSON.stringify({ error: "No audio data obtained" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Map MIME type to correct file extension for Whisper
    const mimeToExt: Record<string, string> = {
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/webm": "webm",
      "audio/flac": "flac",
      "video/mp4": "mp4",
      "application/ogg": "ogg",
      "audio/opus": "ogg",
    };

    const baseMime = (detectedMime || "").toLowerCase().split(";")[0].trim();
    let fileExt = mimeToExt[baseMime] || "";

    if (!fileExt && media_url) {
      const urlExt = media_url.split("?")[0].split(".").pop()?.toLowerCase() || "";
      if (Object.values(mimeToExt).includes(urlExt)) {
        fileExt = urlExt;
      }
    }

    // Default to ogg (WhatsApp PTT uses opus in ogg container)
    if (!fileExt) fileExt = "ogg";

    console.log("transcribe-audio: mime:", baseMime, "-> ext:", fileExt, "size:", audioBlob.size);

    // 5. Send to OpenAI Whisper API
    const formData = new FormData();
    formData.append("file", audioBlob, `audio.${fileExt}`);
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

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

    // 6. Save transcription in provider_metadata
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
