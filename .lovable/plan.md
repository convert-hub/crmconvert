## Causa-raiz confirmada

1. **Race do provider** — `ChatPanel.tsx:729` renderiza `<AudioRecorder ... provider={providerInfo?.provider ?? null} />` desde o primeiro paint. `providerInfo` é resolvido por `getConversationProvider` num efeito assíncrono, então durante a janela inicial chega `null` no `AudioRecorder`. Em `AudioRecorder.tsx:startRecording`, só entra no caminho ogg/opus se `provider === 'meta_cloud'`; com `null` cai direto em `startNative()` → webm.
2. **Fallback silencioso do opus-recorder** — em `AudioRecorder.tsx:startRecording`, o `catch` em volta de `startOpus()` cai em `startNative()` (webm) mesmo para meta_cloud, sem avisar ninguém.
3. **Cache do encoder worker** — `nginx.conf` aplica `Cache-Control: public, immutable; expires 1y` em `.js`, incluindo `/encoderWorker.min.js` (servido de `public/`). Uma cópia ruim/parcial fica presa no browser do atendente por um ano.
4. **wa-meta-send** — `validateMimeForMeta` já existe e retorna `200 + ok:false + code:'audio_mime_unsupported'`, e o ChatPanel já trata `_mime_unsupported`. O "non-2xx" que o atendente vê vem provavelmente de uma falha anterior (rede/Graph) que ainda devolve 4xx; é cinto-e-suspensório blindar.

## Plano (4 frentes, sem regredir o que funciona)

### 1. `src/components/inbox/AudioRecorder.tsx` — nunca gerar webm para meta_cloud

- Pré-instanciar o `opus-recorder` ao montar o componente (dynamic import + `new Recorder({...})` sem chamar `start()`), guardando em `opusRecorderRef`. Estado novo `opusReady: 'loading' | 'ready' | 'failed'`. Se falhar, **1 retry** com backoff curto.
- Em `startRecording`:
  - Se `provider === 'meta_cloud'` **ou** `provider == null` (ainda carregando) → exigir caminho ogg. Se `opusReady !== 'ready'`, **bloquear**, mostrar toast em pt-BR ("Não foi possível gravar áudio compatível com o WhatsApp Oficial. Recarregue a página e tente novamente.") e abortar. **Nunca** chamar `startNative()` nesse caso.
  - Remover o `catch → startNative()` para meta_cloud. Mantém fallback webm apenas para `provider === 'uazapi'` explícito.
- Botão de microfone: `disabled` quando `provider == null` (provider ainda não resolvido) ou quando `provider === 'meta_cloud' && opusReady === 'loading'`. Tooltip explicativo.

### 2. `src/components/inbox/ChatPanel.tsx` — esperar provider antes de habilitar áudio

- Adicionar flag `providerLoading` (inicializa `true`, vira `false` no fim do `useEffect` que carrega `getConversationProvider`).
- Passar `provider={providerLoading ? null : (providerInfo?.provider ?? 'uazapi')}` e nova prop `providerLoading` para o `AudioRecorder` (ou simplesmente deixar `null` enquanto carrega — o `AudioRecorder` já trata).
- Após resolver, garantir que conversas sem `whatsapp_instance_id` continuem caindo em `'uazapi'` (retrocompat — `getConversationProvider` já faz isso).

### 3. Cache do encoder worker

- `nginx.conf`: adicionar bloco específico antes da regra genérica `*.js`:
  ```
  location = /encoderWorker.min.js {
      add_header Cache-Control "no-cache, must-revalidate";
      expires off;
  }
  ```
- Não mexer no cache dos outros assets (Vite já versiona o resto com hash).
- Como ação complementar de segurança: no `AudioRecorder`, ao importar dinâmico, anexar `?v=<APP_BUILD>` ao `encoderPath` via `import.meta.env` quando disponível, para invalidar de vez quem ainda tiver o worker velho.

### 4. `supabase/functions/wa-meta-send/index.ts` — blindar upload_media

- O caminho mime-unsupported já retorna `200 + ok:false`. Auditar todos os outros `return` de `upload_media` (fetch da URL, FormData, chamada ao Graph): **garantir que nenhum caminho retorne 4xx/5xx** — todos devem usar `jsonResponse({ ok: false, code, error }, 200)` com mensagens em pt-BR.
- Logar `received_mime` e tenant para diagnóstico futuro (já existe parcialmente).
- Acrescentar log no início do action `upload_media` com `media_mime` recebido para confirmar em produção se ainda chega webm de algum lugar.

## Riscos e mitigação


| Risco                                                                | Mitigação                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Atendente clica antes do provider carregar e percebe botão "travado" | Toast curto + spinner no ícone do mic enquanto `providerLoading                                                                            |
| `opus-recorder` falhar em browser antigo                             | Toast claro pedindo recarregar; UAZAPI continua aceitando webm normalmente.                                                                |
| Mudança no nginx exige redeploy do container web                     | Documentar no commit; sem isso, browsers atuais continuam com worker antigo cacheado (versionamento via `?v=` resolve mesmo sem redeploy). |
| Pré-instanciar Recorder consome um worker idle                       | Aceitável: 1 worker por sessão de inbox, liberado no unmount.                                                                              |


**1. CRÍTICO —** `providerLoading` **tem que virar** `false` **no** `finally`**, não só no sucesso.**  
O efeito é `getConversationProvider(...).then(setProviderInfo).catch(() => setProviderInfo(null))`. Se a busca do provider **falhar ou travar**, e o `providerLoading` só virar `false` no caminho de sucesso, o **botão de microfone fica desabilitado para sempre** naquela conversa. Exige: `.finally(() => setProviderLoading(false))`. Sem isso, troca-se "manda webm" por "não manda áudio nenhum".

**2. IMPORTANTE — o log do item 4 é o que finalmente fecha o mistério do "non-2xx".**  
Tem uma contradição que o plano chamou de "provavelmente rede/Graph": o código atual do `wa-meta-send` **já deveria** devolver `200 + ok:false` para webm (a `validateMimeForMeta` pega webm). Se mesmo assim o atendente viu "non-2xx", então **ou a validação não disparou, ou a função quebrou/expirou** — e isso é um caminho que não entendemos 100%. Então: **não assuma a causa** — implemente o log de `media_mime` no início do `upload_media` e, depois do deploy, a gente **olha o log em produção** pra confirmar que (a) não chega mais webm e (b) o que aquele caminho antigo realmente retornava. Manter tudo em `200` é o certo de qualquer forma.

**3. Cuidado com o default** `'uazapi'` **no erro de lookup.**  
`provider={providerLoading ? null : (providerInfo?.provider ?? 'uazapi')}` — se a busca do provider **falhar** numa conversa que é Meta, ela cai em `'uazapi'` → grava webm de novo. Como a conversa **tem** `whatsapp_instance_id`, o ideal é: se há instância vinculada mas o provider não resolveu, **não assumir uazapi** (bloquear/retry), e só usar `'uazapi'` como default quando a conversa realmente **não tem** instância. É raro, mas é exatamente o tipo de canto que reabre o bug.

**4. O bloqueio anti-webm vale também se o** `start()` **falhar na hora de gravar, não só na pré-instanciação.**  
Removeram o `catch → startNative()` da init — ótimo. Garanta que, se o `opus-recorder.start()` **rejeitar no momento da gravação** (não só ao montar), o comportamento seja o mesmo: **toast claro + abortar**, nunca cair em webm para meta_cloud.  
  
O que NÃO muda

- Caminho ogg/opus → `upload_media` → `send` para Meta continua idêntico.
- Tenants UAZAPI seguem gravando em webm via `startNative()`.
- Janela 24h/72h (erro 131047) intocada.
- `whatsappRouter.sendMedia` intocada.