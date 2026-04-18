## Plano: Debounce de mensagens via job queue

Agrupar mensagens fragmentadas do lead em uma única chamada à IA, usando job agendado `debounced_ai_reply` com janela de 8s.

### Arquivo único: `worker/index.js`

**1. Nova constante** (topo, junto às outras):

```js
const AI_REPLY_DEBOUNCE_SECONDS = 8;
```

**2. Substituir as 2 chamadas diretas a `handleAiAutoReply` em `process_uazapi_message**` (fluxo principal + legacy) por:

```js
// Grava timestamp do último inbound (merge metadata)
const nowIso = new Date().toISOString();
await supabase.from('conversations').update({
  metadata: { ...(freshConv.metadata || {}), last_inbound_at: nowIso },
}).eq('id', freshConv.id);

// Enfileira job debounced (idempotency_key por janela de 8s)
const windowBucket = Math.floor(Date.now() / (AI_REPLY_DEBOUNCE_SECONDS * 1000));
await supabase.rpc('enqueue_job', {
  _type: 'debounced_ai_reply',
  _payload: { tenant_id, conversation_id: freshConv.id, contact_id: (freshContact || contact).id },
  _tenant_id: tenant_id,
  _run_after: new Date(Date.now() + AI_REPLY_DEBOUNCE_SECONDS * 1000).toISOString(),
  _idempotency_key: `debounced-ai-reply-${freshConv.id}-${windowBucket}`,
});
```

**3. Novo handler `debounced_ai_reply**` registrado no map de handlers:

```js
async function handleDebouncedAiReply(payload) {
  const { tenant_id, conversation_id, contact_id } = payload;

  // Fetch fresh conversation
  const { data: freshConv } = await supabase.from('conversations')
    .select('*').eq('id', conversation_id).maybeSingle();
  if (!freshConv) return { skipped: true, reason: 'conversation_not_found' };
  if (freshConv.assigned_to) return { skipped: true, reason: 'assigned_to_human' };
  if (freshConv.metadata?.ai_activated !== true) return { skipped: true, reason: 'ai_not_activated' };

  // Janela ainda quente? Reagendar.
  const lastInboundAt = freshConv.metadata?.last_inbound_at;
  if (lastInboundAt) {
    const elapsed = Date.now() - new Date(lastInboundAt).getTime();
    if (elapsed < (AI_REPLY_DEBOUNCE_SECONDS - 1) * 1000) {
      const newRunAfter = new Date(new Date(lastInboundAt).getTime() + AI_REPLY_DEBOUNCE_SECONDS * 1000).toISOString();
      const newBucket = Math.floor(new Date(newRunAfter).getTime() / (AI_REPLY_DEBOUNCE_SECONDS * 1000));
      await supabase.rpc('enqueue_job', {
        _type: 'debounced_ai_reply',
        _payload: { tenant_id, conversation_id, contact_id },
        _tenant_id: tenant_id,
        _run_after: newRunAfter,
        _idempotency_key: `debounced-ai-reply-${conversation_id}-${newBucket}`,
      });
      return { skipped: true, reason: 'debounce_rescheduled' };
    }
  }

  // Coletar inbounds desde o último outbound AI
  const { data: msgs } = await supabase.from('messages')
    .select('id, content, direction, is_ai_generated, created_at')
    .eq('conversation_id', conversation_id).eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false }).limit(30);

  const collected = [];
  for (const m of (msgs || [])) {
    if (m.direction === 'outbound' && m.is_ai_generated) break;
    if (m.direction === 'inbound' && m.content?.trim()) collected.push(m.content.trim());
  }
  collected.reverse();
  const concatenated = collected.join('\n');

  // Fetch fresh contact
  const { data: freshContact } = await supabase.from('contacts')
    .select('*').eq('id', contact_id).maybeSingle();

  await handleAiAutoReply(tenant_id, freshConv, freshContact, concatenated);
  return { ai_processed: true, messages_grouped: collected.length };
}
```

E adicionar `'debounced_ai_reply': handleDebouncedAiReply` no dispatcher de handlers.

### Garantias

- **Idempotência**: `floor(now/8s)` agrupa todas as mensagens da mesma janela em UM único job. Janela seguinte gera key diferente.
- **Reagendamento dinâmico**: se o job acordar e a última mensagem for muito recente (<7s), ele se reagenda em vez de disparar prematuramente.
- **Concatenação**: pega apenas inbounds posteriores à última resposta da IA — evita reprocessar histórico antigo.
- **Sem alterações em**: `handleAiAutoReply`, `checkKeywordAndActivateAi`, `checkQualification`, transcrição de áudio, marcação atômica.

### Teste mental

Lead manda "oi" (t=0s), "tudo bem?" (t=2s), "quero drenagem" (t=5s):

- t=0s: bucket=N → enfileira job1, run_after=8s, last_inbound_at=0s
- t=2s: bucket=N (mesma janela) → idempotency colide → job1 reutilizado, last_inbound_at=2s
- t=5s: bucket=N → idempotency colide → job1 reutilizado, last_inbound_at=5s
- t=8s: job1 acorda; elapsed=3s < 7s → reagenda para t=13s
- t=13s: elapsed=8s ≥ 7s → coleta as 3 inbounds → 1 chamada à IA com texto concatenado

**Resultado: 1 resposta da IA agrupando as 3 mensagens.**

### Riscos

- Worker offline no run_after: job permanece `queued`, é pego no próximo poll — OK.
- Falha do handler: `fail_job` faz retry exponencial — OK.
- Race entre 2 mensagens em janelas diferentes (t=0s e t=9s): geram 2 jobs distintos com keys diferentes — comportamento esperado, 2 respostas separadas (lead pausou 9s, é razoável).  
  
Plano aprovado com 3 adendos obrigatórios:
  1. LEGACY FLOW USA OUTRAS VARIÁVEIS. Na segunda substituição dentro de 
     process_uazapi_message (o legacy flow, após a linha ~360), as variáveis 
     locais são `conversation` e `contact`, NÃO `freshConvfreshContact`. 
     Elas já foram atualizadas via `if (freshConv2) conversation = freshConv2`. 
     Adaptar o bloco de substituição para usar os nomes corretos nesse escopo.
  2. STRINGIFY DO PAYLOAD. Por consistência com o resto do worker, passar 
     `_payload: JSON.stringify({ tenant_id, conversation_id, contact_id })` 
     em vez de objeto direto.
  3. NÃO MOVER triggerMessageReceivedFlows PARA O JOB DEBOUNCED. Ele deve 
     continuar rodando imediato após o enqueue do job, em ambos os fluxos. 
     Apenas handleAiAutoReply é adiada.
  Todo o resto do plano (constante AI_REPLY_DEBOUNCE_SECONDS, estrutura do 
  handler, idempotency por bucket, reagendamento dinâmico, coleta de inbounds 
  desde último outbound AI, teste mental) está correto e deve ser mantido 
  sem alteração.
  Mostre o diff completo antes de aplicar.