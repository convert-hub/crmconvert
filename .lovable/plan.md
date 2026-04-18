## Plano: Extração assíncrona de nome do lead em `ai-generate`

Adicionar uma segunda chamada (fire-and-forget) ao gpt-4o-mini para extrair o nome real do lead a partir do histórico, atualizando `contacts.name` quando o nome atual for genérico/inválido.

### Alteração em `supabase/functions/ai-generate/index.ts`

Após o bloco "// 11. Call OpenAI API" (depois de obter `suggestion` e `tokensUsed`, antes do `return`), inserir uma IIFE async **não-aguardada**:

```ts
// 11b. Fire-and-forget: extract real name from chat history
(async () => {
  try {
    if (!conv?.contact_id) return;

    const currentName = (contact?.name || "").trim();
    const phone = (contact?.phone || "").trim();
    const needsExtraction =
      !currentName ||
      currentName.toLowerCase() === "cliente" ||
      currentName.length < 2 ||
      /\d/.test(currentName) ||
      currentName === phone;

    if (!needsExtraction) return;

    const last10 = chatHistory.slice(-10)
      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const extractRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você extrai o NOME REAL (primeiro nome + sobrenome, se houver) de um lead a partir do histórico de conversa. Responda APENAS com JSON: {\"name\": \"Nome Sobrenome\"} ou {\"name\": null} se não houver nome claro. NUNCA invente. Ignore mensagens genéricas, saudações e nomes de terceiros." },
          { role: "user", content: last10 },
        ],
        temperature: 0,
        max_tokens: 50,
        response_format: { type: "json_object" },
      }),
    });

    if (!extractRes.ok) return;
    const extractJson = await extractRes.json();
    const raw = extractJson.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const extracted = typeof parsed.name === "string" ? parsed.name.trim() : null;

    if (extracted && extracted.length >= 2 && !/\d/.test(extracted) && extracted !== currentName) {
      await supabase.from("contacts").update({ name: extracted }).eq("id", conv.contact_id);
      console.log(`[ai-generate] Contact name updated: "${currentName}" → "${extracted}"`);
    }
  } catch (e) {
    console.error("[ai-generate] Name extraction failed (non-blocking):", e);
  }
})();

// 12. Log AI usage  ← continua igual
```

### Garantias

- **Não bloqueia**: IIFE sem `await` na chamada principal — o `return new Response(...)` da sugestão é executado imediatamente.
- **Seguro**: try/catch externo + checagem `extractRes.ok` + `JSON.parse` protegido.
- **Idempotente**: só atualiza se nome for genérico (`Cliente`, vazio, < 2 chars, contém dígito, ou igual ao telefone).
- **Sem efeitos colaterais**: não toca em `webhook-uazapi`, `worker/index.js`, nem em outras edge functions.

### Deploy

Edge function `ai-generate` será deployada automaticamente.  
  
Plano aprovado com 3 adendos obrigatórios antes de aplicar:

ADENDO 1 (CRÍTICO) — Envolver a IIFE em EdgeRuntime.waitUntil()

Motivo: em Supabase Edge Functions (Deno Deploy), depois que a função retorna new Response(...), o runtime pode encerrar o isolate antes da IIFE background terminar. Uma IIFE solta não é garantida — a chamada ao OpenAI pode ser cortada no meio, ou completar mas o update no supabase nunca rodar. O mecanismo oficial para background tasks é EdgeRuntime.waitUntil().

Mudança: substituir

  (async () => {

    try { ... }

    catch (e) { ... }

  })();

por

  EdgeRuntime.waitUntil((async () => {

    try { ... }

    catch (e) { ... }

  })());

Todo o resto do bloco interno permanece IDÊNTICO ao que você já planejou.

ADENDO 2 — Incrementar contador de uso quando aplicar a atualização

Motivo: a chamada extra ao gpt-4o-mini consome tokens do tenant mas hoje não é contabilizada em ai_configs.daily_usage/monthly_usage. Isso distorce tracking e pode ultrapassar limites silenciosamente.

Mudança: logo APÓS o supabase.from("contacts").update({ name: extracted })..., adicionar:

  if (aiConfig?.id) {

    await supabase.from("ai_configs").update({

      daily_usage: (aiConfig.daily_usage || 0) + 1,

      monthly_usage: (aiConfig.monthly_usage || 0) + 1,

    }).eq("id", [aiConfig.id](http://aiConfig.id));

  }

ADENDO 3 — Logar cada extração em ai_logs

Motivo: auditoria de custo e comportamento. Sem log, não dá pra diagnosticar se a extração está rodando e acertando/errando.

Mudança: APÓS parsear extractJson e ANTES do if de validação final, adicionar:

  await supabase.from("ai_logs").insert({

    tenant_id,

    task_type: "name_extraction",

    provider: "openai",

    model: "gpt-4o-mini",

    tokens_used: extractJson.usage?.total_tokens || 0,

    input_data: { conversation_id, history_length: chatHistory.length },

    output_data: { extracted_name: extracted, applied: false },

  });

O flag "applied" começa false. Se quiser, pode atualizar para true depois do update do contact — opcional. O importante é registrar que a chamada rodou.

VALIDAÇÕES antes de me mostrar o diff final:

1. Confirme que EdgeRuntime está disponível no runtime (é o padrão Deno Deploy / Supabase Edge Functions — basta usar sem import).

2. Confirme que aiConfig, chatHistory, contact, conv, tenant_id, conversation_id e apiKey estão todos em escopo no ponto onde a IIFE é inserida.

3. Mostre o diff completo antes de aplicar.

Resto do plano original (posição do bloco após "// 11. Call OpenAI API", validação needsExtraction, response_format json_object, try/catch externo, heurísticas de nome genérico) está correto e deve ser mantido sem alteração.