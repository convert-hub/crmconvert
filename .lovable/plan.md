

# Lembretes automaticos de follow-up por inatividade

## Resumo

Sistema de lembretes automaticos que detecta oportunidades inativas em cada estagio do pipeline e cria atividades de follow-up para a equipe. O tempo de inatividade e configuravel por estagio (coluna) diretamente na tela de Configuracoes > Pipeline.

---

## Arquitetura

### 1. Armazenamento: campo `inactivity_hours` na tabela `stages`

Adicionar uma coluna `inactivity_hours` (integer, nullable, default null) na tabela `stages`. Quando null ou 0, o lembrete esta desativado para aquele estagio. Isso garante que a configuracao acompanha o ciclo de vida do estagio (renomear, reordenar, deletar).

**Migracao SQL:**
```text
ALTER TABLE stages ADD COLUMN inactivity_hours integer DEFAULT NULL;
```

### 2. Edge Function cron: `check-inactivity`

Uma nova Edge Function executada periodicamente (a cada 30 minutos via pg_cron) que:

1. Busca todos os tenants ativos
2. Para cada tenant, busca estagios com `inactivity_hours > 0`
3. Para cada estagio, busca oportunidades com `status = 'open'` e `updated_at` mais antigo que o threshold
4. Para cada oportunidade inativa, verifica se ja existe atividade de follow-up nao concluida (evita duplicatas)
5. Se nao existe, cria atividade tipo `follow_up` vinculada a oportunidade e ao contato

**Logica de inatividade:**
```text
oportunidade.updated_at < NOW() - (stage.inactivity_hours * interval '1 hour')
```

**Prevencao de duplicatas:**
Antes de criar o follow-up, verifica se ja existe atividade com:
- `opportunity_id` = oportunidade
- `type` = 'follow_up'
- `is_completed` = false
- `title` contendo 'Lembrete de follow-up'

### 3. UI de configuracao em Configuracoes > Pipeline

Na aba Pipeline da pagina de Settings, adicionar na tabela de estagios uma nova coluna "Inatividade" com:
- Um input numerico (horas) ao lado de cada estagio
- Valor 0 ou vazio = desativado
- Botao salvar por linha ou auto-save ao perder foco
- Texto auxiliar explicando que a primeira coluna normalmente nao precisa (leads novos)

---

## Fluxo de execucao

```text
pg_cron (a cada 30 min)
      |
      v
Edge Function: check-inactivity
      |
      +-- Para cada tenant:
            +-- Busca stages com inactivity_hours > 0
            +-- Para cada stage:
                  +-- Busca opportunities com status='open' 
                  |   e updated_at < (now - inactivity_hours)
                  +-- Para cada opp inativa:
                        +-- Verifica se ja tem follow_up pendente
                        +-- Se NAO: cria atividade follow_up
```

---

## Detalhes tecnicos

### Migracao de banco
- Adicionar coluna `inactivity_hours` (integer, nullable) na tabela `stages`
- Nenhuma nova tabela necessaria

### Edge Function `check-inactivity`

Arquivo: `supabase/functions/check-inactivity/index.ts`

- Usa `SUPABASE_SERVICE_ROLE_KEY` para acessar todos os tenants
- Busca estagios com `inactivity_hours > 0` (join com pipelines para ter tenant_id)
- Para cada estagio, busca oportunidades inativas usando comparacao de timestamps
- Cria atividades de follow-up com:
  - `type`: 'follow_up'
  - `title`: 'Lembrete de follow-up'
  - `description`: inclui nome do estagio e tempo de inatividade
  - `due_date`: now (ja esta atrasado)
  - `opportunity_id`: vinculado
  - `contact_id`: vinculado
  - `assigned_to`: herda da oportunidade (se tiver)
- Responde 200 sempre (cron nao deve falhar)

### Configuracao no `supabase/config.toml`

```text
[functions.check-inactivity]
verify_jwt = false
```

### Agendamento via pg_cron

SQL para agendar (executado via insert tool, nao migracao):
```text
SELECT cron.schedule(
  'check-inactivity-every-30min',
  '*/30 * * * *',
  $$ SELECT net.http_post(
    url:='https://zhywwrhzaqfcjcwywkwf.supabase.co/functions/v1/check-inactivity',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id; $$
);
```

### UI: `src/pages/SettingsPage.tsx`

Na aba Pipeline, modificar a tabela de estagios para incluir:
- Nova coluna "Inatividade (horas)" com input numerico
- Funcao `updateStageInactivity(stageId, hours)` que faz update no campo `inactivity_hours`
- Texto explicativo abaixo da tabela

---

## Arquivos a serem criados/modificados

| Arquivo | Alteracao |
|---------|-----------|
| Migracao SQL | Adicionar coluna `inactivity_hours` em `stages` |
| `supabase/functions/check-inactivity/index.ts` | Nova edge function para verificar inatividade |
| `supabase/config.toml` | Adicionar config da nova function |
| `src/pages/SettingsPage.tsx` | Adicionar input de horas por estagio na aba Pipeline |
| pg_cron (via insert tool) | Agendar execucao a cada 30 minutos |

