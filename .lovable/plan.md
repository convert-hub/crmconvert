## Diagnóstico

Os logs de rede mostram que **todas** as chamadas para a WABA estão falhando com:

> `Error validating access token: Session has expired on Sunday, 10-May-26 05:00:00 PDT` (Graph API code 190 / subcode 463)

O token salvo na instância **PAIPE WABA** (`bf86edc0...`) é um token de **curta duração** (provavelmente copiado do Graph API Explorer ou do botão "Get access token" do app de teste), que dura ~1–24h. Ele expirou ontem.

Como o mesmo campo `meta_access_token_encrypted` é usado por `wa-meta-templates-sync`, `wa-meta-send` e qualquer ação Meta, **nenhuma operação Cloud API funciona** — não só os templates.

Pior: a edge function devolve HTTP 200 com `{ok:false, error:"..."}`, então o usuário só vê "não acontece nada", sem alerta.

## O que será feito

### 1. Detecção e sinalização clara de token inválido (essencial)
- Em `wa-meta-templates-sync` e `wa-meta-send`, quando a Graph API retornar `error.code === 190` (token expirado/inválido):
  - Marcar a instância no banco com um novo campo `meta_token_status` (`valid` | `expired` | `invalid`) e `meta_token_last_error_at`.
  - Devolver erro normalizado `{ok:false, code:'meta_token_expired', error:'Token Meta expirado — reconecte a instância'}`.
- Em `MetaCloudConnectionsCard.tsx`, mostrar **badge vermelho "Token expirado — reconectar"** ao lado da instância quando `meta_token_status !== 'valid'`, com botão direto para abrir o diálogo de reconexão.

### 2. Botão "Atualizar token" no card da instância
Hoje só dá para "desconectar e recriar". Adicionar ação **"Atualizar token Meta"** que:
- Abre o mesmo diálogo de colar token,
- Faz uma chamada de validação à Graph API (`GET /{waba_id}?fields=id`) antes de salvar,
- Se válido, atualiza `meta_access_token_encrypted` + `meta_token_status='valid'` e dispara um sync dos templates automaticamente.

### 3. Suporte a System User Token (permanente) — recomendado
Adicionar no diálogo de conexão um campo opcional **"Tipo de token"** com explicação curta:
- **Token de usuário (curta duração)** — expira em horas/dias. Bom só para testes.
- **System User Token (permanente)** — gerado em Business Settings → System Users. **Não expira.** Recomendado para produção.

Salvar o tipo em `meta_token_type` para podermos avisar o usuário quando ele estiver usando token temporário ("Atenção: este token expira em breve, considere migrar para System User").

### 4. Health-check periódico (opcional, defensivo)
Job diário (pg_cron já existe) `meta-token-healthcheck`:
- Para cada instância `provider='meta_cloud'` ativa, faz `GET /{waba_id}?fields=id`.
- Se 401/190 → marca `meta_token_status='expired'`.
- Não envia notificação por enquanto; só atualiza o badge na UI.

### 5. Documentação curta no card
Texto inline explicando como gerar um **System User Token permanente** (3 passos: Business Settings → System Users → Generate token com permissões `whatsapp_business_management` + `whatsapp_business_messaging`), para o usuário não cair no mesmo problema.

## Arquivos afetados

- `supabase/migrations/...` — adicionar colunas `meta_token_status`, `meta_token_last_error_at`, `meta_token_type` em `whatsapp_instances`.
- `supabase/functions/wa-meta-templates-sync/index.ts` — detectar 190, atualizar status, retornar erro normalizado.
- `supabase/functions/wa-meta-send/index.ts` — idem.
- `src/components/settings/MetaCloudConnectionsCard.tsx` — badge de status, botão "Atualizar token", validação na hora de salvar, campo "tipo de token", helper text com instruções.
- (Opcional) `supabase/functions/meta-token-healthcheck/index.ts` + cron.

## Ação imediata para destravar agora (sem código)

Independente do plano acima, **enquanto isso**: abra `Configurações → Conexões Meta Cloud → PAIPE WABA`, gere um novo token na Meta (preferencialmente System User permanente) e cole no campo. Os templates voltam a sincronizar na hora.

## Fora de escopo

- OAuth completo Embedded Signup da Meta (requer app review / Tech Provider).
- Refresh automático de tokens de curta duração (Meta não oferece refresh para tokens de usuário comuns).
