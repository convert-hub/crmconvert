import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id, tenant_id } = await req.json();
    if (!conversation_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "Missing conversation_id or tenant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get tenant AI config for message_generation
    const { data: aiConfig, error: aiConfigErr } = await supabase
      .from("ai_configs")
      .select("*, global_api_key:global_api_keys(*)")
      .eq("tenant_id", tenant_id)
      .eq("task_type", "message_generation")
      .maybeSingle();

    if (aiConfigErr) {
      console.error("Error fetching ai_configs:", aiConfigErr);
      return new Response(JSON.stringify({ error: "Falha ao buscar configuração de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine API key: tenant's own or global
    let apiKey: string | null = null;
    let model = "gpt-4o-mini";

    if (aiConfig) {
      model = aiConfig.model || model;
      if (aiConfig.api_key_encrypted) {
        apiKey = aiConfig.api_key_encrypted;
      } else if (aiConfig.global_api_key) {
        apiKey = aiConfig.global_api_key.api_key_encrypted;
      }
    }

    // Fallback to env OPENAI_API_KEY
    if (!apiKey) {
      apiKey = Deno.env.get("OPENAI_API_KEY") || null;
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "IA não configurada para este tenant. Configure uma chave de API OpenAI nas configurações." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load tenant prompt template for message_generation
    const { data: promptTemplate } = await supabase
      .from("prompt_templates")
      .select("content, forbidden_terms, variables")
      .eq("tenant_id", tenant_id)
      .eq("task_type", "message_generation")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Fetch last 20 messages from conversation
    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("direction, content, is_ai_generated, created_at")
      .eq("conversation_id", conversation_id)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (msgErr) {
      console.error("Error fetching messages:", msgErr);
      return new Response(JSON.stringify({ error: "Failed to fetch messages" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Fetch contact info
    const { data: conv } = await supabase
      .from("conversations")
      .select("contact_id, channel, status, contact:contacts(name, phone, email, tags, status, notes)")
      .eq("id", conversation_id)
      .single();

    const contact = (conv as any)?.contact;
    const contactContext = contact
      ? `Nome: ${contact.name}. Status: ${contact.status}. Tags: ${(contact.tags || []).join(", ") || "nenhuma"}.${contact.notes ? ` Notas: ${contact.notes}` : ""}`
      : "Informações do contato indisponíveis";

    // 5. Fetch opportunity if linked
    const { data: opp } = await supabase
      .from("opportunities")
      .select("title, value, priority, status, next_action, stage:stages(name)")
      .eq("tenant_id", tenant_id)
      .eq("contact_id", conv?.contact_id)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const oppContext = opp
      ? `Oportunidade: "${(opp as any).title}" — Valor: R$${(opp as any).value} — Prioridade: ${(opp as any).priority} — Etapa: ${(opp as any).stage?.name || "?"}.${(opp as any).next_action ? ` Próxima ação: ${(opp as any).next_action}` : ""}`
      : "";

    // 6. RAG - Search knowledge base for relevant context
    let ragContext = "";
    const lastUserMessage = reversed.filter((m: any) => m.direction === "inbound").pop();
    if (lastUserMessage?.content) {
      try {
        // Generate embedding for the query
        const embResponse = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: lastUserMessage.content,
            dimensions: 1536,
          }),
        });

        if (embResponse.ok) {
          const embResult = await embResponse.json();
          const queryEmbedding = embResult.data?.[0]?.embedding;

          if (queryEmbedding) {
            const { data: chunks } = await supabase.rpc("search_knowledge", {
              _tenant_id: tenant_id,
              _query_embedding: JSON.stringify(queryEmbedding),
              _match_count: 5,
              _match_threshold: 0.5,
            });

            if (chunks && chunks.length > 0) {
              ragContext = "\n\n--- BASE DE CONHECIMENTO ---\nUse as informações abaixo como referência para responder:\n" +
                chunks.map((c: any) => c.content).join("\n---\n");
            }
          }
        }
      } catch (ragErr) {
        console.error("RAG search error:", ragErr);
      }
    }

    // 7. Build chat history
    const chatHistory = reversed.map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content || "[mídia]",
    }));

    // 8. Build system prompt — use tenant's template or default
    let systemPrompt: string;
    if (promptTemplate?.content) {
      // Replace variables in template
      systemPrompt = promptTemplate.content
        .replace(/\{\{contact_name\}\}/gi, contact?.name || "Cliente")
        .replace(/\{\{contact_status\}\}/gi, contact?.status || "desconhecido")
        .replace(/\{\{contact_tags\}\}/gi, (contact?.tags || []).join(", ") || "nenhuma")
        .replace(/\{\{contact_notes\}\}/gi, contact?.notes || "")
        .replace(/\{\{channel\}\}/gi, conv?.channel || "whatsapp")
        .replace(/\{\{conversation_status\}\}/gi, conv?.status || "aberto")
        .replace(/\{\{opportunity_context\}\}/gi, oppContext || "Nenhuma oportunidade aberta");

      // Append forbidden terms if any
      if (promptTemplate.forbidden_terms?.length) {
        systemPrompt += `\n\nTermos proibidos (NUNCA use): ${promptTemplate.forbidden_terms.join(", ")}`;
      }
    } else {
      systemPrompt = `Você é um assistente de CRM que sugere respostas para atendentes de vendas/suporte via WhatsApp.

Contexto do contato: ${contactContext}
${oppContext ? `\n${oppContext}` : ""}
Canal: ${conv?.channel || "whatsapp"}. Status da conversa: ${conv?.status || "aberto"}.

Regras:
- Responda APENAS com a sugestão de mensagem pronta para enviar (sem aspas, sem prefixo).
- Tom profissional mas amigável, direto ao ponto.
- Use o nome do contato quando disponível.
- Se houver oportunidade aberta, considere o contexto da negociação.
- Máximo 3 frases curtas.
- Nunca invente dados que não foram fornecidos.
- Se o último mensagem do cliente for uma pergunta, responda à pergunta.
- Se for uma saudação, retorne uma saudação cordial.`;
    }

    // 8. Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistory,
          { role: "user", content: "Sugira uma resposta adequada para eu enviar ao cliente agora." },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit da OpenAI excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401) {
        return new Response(JSON.stringify({ error: "Chave de API OpenAI inválida. Verifique as configurações." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Erro na API OpenAI: " + response.status }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const suggestion = result.choices?.[0]?.message?.content || "";

    // 9. Log AI usage
    const tokensUsed = result.usage?.total_tokens || 0;
    await supabase.from("ai_logs").insert({
      tenant_id,
      task_type: "message_generation",
      provider: "openai",
      model,
      tokens_used: tokensUsed,
      input_data: { conversation_id, messages_count: chatHistory.length },
      output_data: { suggestion: suggestion.substring(0, 200) },
    });

    // 10. Update usage counters
    if (aiConfig?.id) {
      await supabase.from("ai_configs").update({
        daily_usage: (aiConfig.daily_usage || 0) + 1,
        monthly_usage: (aiConfig.monthly_usage || 0) + 1,
      }).eq("id", aiConfig.id);
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
