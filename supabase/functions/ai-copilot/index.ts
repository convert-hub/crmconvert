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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get auth token
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch last 20 messages from conversation
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

    // Fetch contact info
    const { data: conv } = await supabase
      .from("conversations")
      .select("contact_id, channel, status, contact:contacts(name, phone, email, tags, status, notes)")
      .eq("id", conversation_id)
      .single();

    const contact = (conv as any)?.contact;
    const contactContext = contact
      ? `Nome: ${contact.name}. Status: ${contact.status}. Tags: ${(contact.tags || []).join(", ") || "nenhuma"}.${contact.notes ? ` Notas: ${contact.notes}` : ""}`
      : "Informações do contato indisponíveis";

    // Fetch opportunity if linked
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

    // Build chat history
    const reversed = (messages || []).reverse();
    const chatHistory = reversed.map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content || "[mídia]",
    }));

    const systemPrompt = `Você é um assistente de CRM que sugere respostas para atendentes de vendas/suporte via WhatsApp.

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistory,
          { role: "user", content: "Sugira uma resposta adequada para eu enviar ao cliente agora." },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const suggestion = result.choices?.[0]?.message?.content || "";

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
