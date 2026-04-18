

## Plano: Gate mínimo de inbounds em `checkQualification`

Adicionar guard no início de `checkQualification` (`worker/index.js`) para pular execução quando o lead ainda não enviou mensagens suficientes.

### Alterações em `worker/index.js`

1. **Topo do arquivo** — adicionar constante junto às outras constantes globais:
   ```js
   const MIN_INBOUND_FOR_QUALIFICATION = 5;
   ```

2. **Início de `checkQualification`** (antes da chamada ao OpenAI):
   ```js
   const inboundCount = history.filter(m => m.role === 'user').length;
   if (inboundCount < MIN_INBOUND_FOR_QUALIFICATION) {
     console.log(`[Worker] Qualification skipped: only ${inboundCount} inbound messages, waiting for ${MIN_INBOUND_FOR_QUALIFICATION}`);
     return;
   }
   ```

### Resultado

- Qualificação só roda a partir da 5ª mensagem do lead
- Economiza tokens nas primeiras trocas (já é cliente? / nome / procedimento / dor)
- Nada mais é alterado: prompt, threshold, metadata update, activities, task de revisão permanecem intactos

### Após deploy

Rebuild/restart do container do worker.

