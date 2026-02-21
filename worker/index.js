// CRM Worker - Node.js Docker service
// Consumes jobs from Postgres queue with retry and idempotency
// Run via: docker-compose up worker

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL = process.env.POLL_INTERVAL || 2000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Job handlers registry
const handlers = {
  async process_form_webhook(payload) {
    const { tenant_id, data } = payload;
    // Normalize phone
    const phone = normalizePhone(data.phone || data.telefone || data.whatsapp);
    const email = data.email || null;
    const name = data.name || data.nome || data.full_name || 'Lead sem nome';

    // Extract UTM
    const utm = {
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      utm_content: data.utm_content || null,
      utm_term: data.utm_term || null,
    };

    // Dedup by phone or email
    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, email, source: 'form_webhook',
        status: 'lead', ...utm,
      }).select().single();
      contact = c;
    } else {
      // Update UTM (latest)
      await supabase.from('contacts').update({ ...utm, source: 'form_webhook' }).eq('id', contact.id);
    }

    // Create opportunity in first stage of default pipeline
    const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant_id).eq('is_default', true).single();
    if (pipeline) {
      const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
      if (stage) {
        await supabase.from('opportunities').insert({
          tenant_id, contact_id: contact.id, pipeline_id: pipeline.id, stage_id: stage.id,
          title: `Lead: ${name}`, source: 'form_webhook', ...utm,
        });
      }
    }

    // Log activity
    await supabase.from('activities').insert({
      tenant_id, type: 'note', title: 'Lead via formulário',
      description: `Novo lead recebido via webhook de formulário.`,
      contact_id: contact.id,
    });

    return { contact_id: contact.id };
  },

  async process_meta_lead(payload) {
    const { tenant_id, data } = payload;
    // Facebook Lead Ads payload parsing
    const entry = data.entry?.[0];
    const changes = entry?.changes?.[0];
    const leadData = changes?.value || data;

    const name = leadData.full_name || leadData.name || 'Lead Facebook';
    const phone = normalizePhone(leadData.phone_number || leadData.phone);
    const email = leadData.email || null;

    const utm = {
      utm_source: leadData.utm_source || 'facebook_lead_ads',
      utm_medium: leadData.utm_medium || 'paid',
      utm_campaign: leadData.campaign_name || leadData.utm_campaign || null,
      campaign_id: leadData.campaign_id || null,
      adset_id: leadData.adset_id || null,
      ad_id: leadData.ad_id || null,
    };

    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, email, source: 'facebook_lead_ads',
        status: 'lead', ...utm,
      }).select().single();
      contact = c;
    }

    // Create opportunity
    const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant_id).eq('is_default', true).single();
    if (pipeline) {
      const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
      if (stage) {
        await supabase.from('opportunities').insert({
          tenant_id, contact_id: contact.id, pipeline_id: pipeline.id, stage_id: stage.id,
          title: `Lead FB: ${name}`, source: 'facebook_lead_ads',
        });
      }
    }

    return { contact_id: contact.id };
  },

  async process_uazapi_message(payload) {
    const { tenant_id, data } = payload;
    const msg = data;
    
    // Extract phone from UAZAPI payload
    const remoteJid = msg.key?.remoteJid || msg.from || '';
    const phone = normalizePhone(remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', ''));
    const isFromMe = msg.key?.fromMe || false;
    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.body || '';

    if (!phone || !content) {
      return { skipped: true, reason: 'no phone or content' };
    }

    // Find or create contact
    let contact = await findContact(tenant_id, phone, null);
    const isNewContact = !contact;
    if (!contact) {
      const name = msg.pushName || msg.notifyName || phone;
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, source: 'whatsapp', status: 'lead',
      }).select().single();
      contact = c;
    }

    // Find or create conversation
    let conversation;
    const { data: existingConv } = await supabase.from('conversations')
      .select('*').eq('tenant_id', tenant_id).eq('contact_id', contact.id).eq('channel', 'whatsapp').eq('status', 'open').limit(1);
    
    if (existingConv && existingConv.length > 0) {
      conversation = existingConv[0];
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        tenant_id, contact_id: contact.id, channel: 'whatsapp', status: 'open',
        provider_chat_id: remoteJid,
      }).select().single();
      conversation = newConv;
    }

    // Save message
    await supabase.from('messages').insert({
      tenant_id, conversation_id: conversation.id,
      direction: isFromMe ? 'outbound' : 'inbound',
      content, provider_message_id: msg.key?.id,
      provider_metadata: msg,
    });

    // Update conversation timestamps
    const updates = { last_message_at: new Date().toISOString() };
    if (!isFromMe) {
      updates.last_customer_message_at = new Date().toISOString();
      updates.unread_count = (conversation.unread_count || 0) + 1;
    } else {
      updates.last_agent_message_at = new Date().toISOString();
    }
    await supabase.from('conversations').update(updates).eq('id', conversation.id);

    // AI Auto-reply: only for inbound messages, and only if no human agent is assigned
    if (!isFromMe && !conversation.assigned_to) {
      try {
        await handleAiAutoReply(tenant_id, conversation, contact, content);
      } catch (err) {
        console.error('[Worker] AI auto-reply error:', err.message);
      }
    }

    return { contact_id: contact.id, conversation_id: conversation.id };
  },

  async send_whatsapp(payload) {
    const { tenant_id, phone, message, conversation_id } = payload;
    
    // Get UAZAPI instance for tenant
    const { data: instance } = await supabase.from('whatsapp_instances')
      .select('*').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).single();
    
    if (!instance) {
      throw new Error('No active WhatsApp instance for tenant');
    }

    const instToken = instance.api_token_encrypted || '';
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

    if (!cleanPhone) {
      throw new Error('No phone number provided');
    }

    // Send via UAZAPI /send/text with token header
    const response = await fetch(`${instance.api_url}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instToken,
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message,
        delay: 1000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`UAZAPI send failed: ${response.status} ${errText}`);
    }

    return await response.json();
  },
};

// Helpers
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function findContact(tenantId, phone, email) {
  if (phone) {
    const { data } = await supabase.from('contacts').select('*')
      .eq('tenant_id', tenantId).eq('phone', phone).limit(1);
    if (data && data.length > 0) return data[0];
  }
  if (email) {
    const { data } = await supabase.from('contacts').select('*')
      .eq('tenant_id', tenantId).eq('email', email).limit(1);
    if (data && data.length > 0) return data[0];
  }
  return null;
}

// AI Functions
async function getAiConfig(tenantId, taskType) {
  const { data } = await supabase.from('ai_configs').select('*, global_api_key:global_api_keys(*)')
    .eq('tenant_id', tenantId).eq('task_type', taskType).limit(1);
  if (!data || data.length === 0) return null;
  const config = data[0];
  // Check daily/monthly limits
  const now = new Date();
  const resetAt = config.usage_reset_at ? new Date(config.usage_reset_at) : null;
  if (resetAt && now.toDateString() !== resetAt.toDateString()) {
    await supabase.from('ai_configs').update({ daily_usage: 0, usage_reset_at: now.toISOString() }).eq('id', config.id);
    config.daily_usage = 0;
  }
  if (config.daily_usage >= (config.daily_limit || 100)) return null;
  if (config.monthly_usage >= (config.monthly_limit || 3000)) return null;
  return config;
}

async function callOpenAI(apiKey, model, messages) {
  const startTime = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${data.error?.message || response.status}`);
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokens: data.usage?.total_tokens || 0,
    duration: Date.now() - startTime,
  };
}

async function getConversationHistory(conversationId, limit = 20) {
  const { data } = await supabase.from('messages').select('direction, content, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(limit);
  return (data || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content || '',
  }));
}

async function getPromptTemplate(tenantId, taskType) {
  const { data } = await supabase.from('prompt_templates').select('*')
    .eq('tenant_id', tenantId).eq('task_type', taskType).eq('is_active', true).limit(1);
  return data?.[0] || null;
}

async function incrementAiUsage(configId) {
  // Increment daily and monthly usage
  const { data: config } = await supabase.from('ai_configs').select('daily_usage, monthly_usage').eq('id', configId).single();
  if (config) {
    await supabase.from('ai_configs').update({
      daily_usage: (config.daily_usage || 0) + 1,
      monthly_usage: (config.monthly_usage || 0) + 1,
      usage_reset_at: new Date().toISOString(),
    }).eq('id', configId);
  }
}

async function logAiCall(tenantId, taskType, model, provider, tokens, duration, input, output, error) {
  await supabase.from('ai_logs').insert({
    tenant_id: tenantId, task_type: taskType, model, provider,
    tokens_used: tokens, duration_ms: duration,
    input_data: input, output_data: output, error,
  });
}

async function handleAiAutoReply(tenantId, conversation, contact, incomingMessage) {
  // Get message_generation config
  const config = await getAiConfig(tenantId, 'message_generation');
  if (!config) {
    console.log('[Worker] No AI config for message_generation or limits reached');
    return;
  }

  const apiKey = config.global_api_key?.api_key_encrypted;
  if (!apiKey) {
    console.log('[Worker] No API key for message_generation');
    return;
  }

  // Get conversation history
  const history = await getConversationHistory(conversation.id);

  // Get prompt template
  const template = await getPromptTemplate(tenantId, 'message_generation');
  const systemPrompt = template?.content || `Você é um atendente virtual de uma empresa. Seja cordial, objetivo e profissional.
Responda perguntas sobre a empresa e seus serviços.
Se o cliente demonstrar interesse real em comprar ou contratar, responda normalmente mas sinalize internamente que está qualificado.
NÃO use emojis em excesso. Mantenha mensagens curtas e claras para WhatsApp.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  try {
    const result = await callOpenAI(apiKey, config.model || 'gpt-4o-mini', messages);
    
    await incrementAiUsage(config.id);
    await logAiCall(tenantId, 'message_generation', config.model, config.provider, result.tokens, result.duration, { message: incomingMessage }, { reply: result.content }, null);

    if (result.content) {
      // Send via WhatsApp
      await supabase.rpc('enqueue_job', {
        _type: 'send_whatsapp',
        _payload: JSON.stringify({
          tenant_id: tenantId,
          phone: contact.phone,
          message: result.content,
          conversation_id: conversation.id,
        }),
        _tenant_id: tenantId,
      });

      // Save AI message to DB
      await supabase.from('messages').insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        direction: 'outbound',
        content: result.content,
        is_ai_generated: true,
      });

      // Run qualification check
      await checkQualification(tenantId, conversation, contact, history.concat([
        { role: 'user', content: incomingMessage },
        { role: 'assistant', content: result.content },
      ]));
    }
  } catch (err) {
    await logAiCall(tenantId, 'message_generation', config.model, config.provider, 0, 0, { message: incomingMessage }, null, err.message);
    throw err;
  }
}

async function checkQualification(tenantId, conversation, contact, history) {
  const config = await getAiConfig(tenantId, 'qualification');
  if (!config) return;

  const apiKey = config.global_api_key?.api_key_encrypted;
  if (!apiKey) return;

  const template = await getPromptTemplate(tenantId, 'qualification');
  const systemPrompt = template?.content || `Analise a conversa a seguir e determine se o lead está QUALIFICADO para falar com um atendente humano.
Um lead qualificado demonstra:
- Interesse real em comprar/contratar
- Fez perguntas sobre preço, disponibilidade ou como funciona
- Forneceu informações de contato ou demonstrou urgência

Responda APENAS com JSON: {"qualified": true/false, "reason": "motivo breve", "confidence": 0.0-1.0}`;

  try {
    const result = await callOpenAI(apiKey, config.model || 'gpt-4o-mini', [
      { role: 'system', content: systemPrompt },
      ...history,
    ]);

    await incrementAiUsage(config.id);
    
    let qualification;
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      qualification = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { qualification = null; }

    await logAiCall(tenantId, 'qualification', config.model, config.provider, result.tokens, result.duration, { history_length: history.length }, qualification, null);

    if (qualification?.qualified && qualification.confidence >= 0.7) {
      console.log(`[Worker] Lead ${contact.id} QUALIFIED - handing off to human`);
      
      // Update contact status
      await supabase.from('contacts').update({ status: 'customer' }).eq('id', contact.id);
      
      // Update conversation to waiting_agent so a human picks it up
      await supabase.from('conversations').update({ 
        status: 'waiting_agent',
        metadata: { ...((conversation.metadata || {})), qualification: qualification },
      }).eq('id', conversation.id);

      // Store qualification data on opportunity if exists
      const { data: opps } = await supabase.from('opportunities')
        .select('id').eq('contact_id', contact.id).eq('tenant_id', tenantId).eq('status', 'open').limit(1);
      if (opps && opps.length > 0) {
        await supabase.from('opportunities').update({ qualification_data: qualification }).eq('id', opps[0].id);
      }

      // Create activity noting the handoff
      await supabase.from('activities').insert({
        tenant_id: tenantId,
        type: 'note',
        title: 'Lead qualificado pela IA',
        description: `Motivo: ${qualification.reason || 'Lead demonstrou interesse'}. Confiança: ${Math.round((qualification.confidence || 0) * 100)}%`,
        contact_id: contact.id,
        conversation_id: conversation.id,
      });
    }
  } catch (err) {
    console.error('[Worker] Qualification error:', err.message);
  }
}
  try {
    const { data: job } = await supabase.rpc('acquire_next_job', {
      _types: Object.keys(handlers),
    });

    if (!job || !job.id) return;

    console.log(`[Worker] Processing job ${job.id} type=${job.type} attempt=${job.attempts}`);

    const handler = handlers[job.type];
    if (!handler) {
      await supabase.rpc('fail_job', { _job_id: job.id, _error: `Unknown job type: ${job.type}` });
      return;
    }

    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      const result = await handler(payload);
      await supabase.rpc('complete_job', { _job_id: job.id, _result: JSON.stringify(result) });
      console.log(`[Worker] Job ${job.id} completed`);
    } catch (err) {
      console.error(`[Worker] Job ${job.id} failed:`, err.message);
      await supabase.rpc('fail_job', { _job_id: job.id, _error: err.message });
    }
  } catch (err) {
    console.error('[Worker] Poll error:', err.message);
  }
}

// Listen for NOTIFY and poll
async function start() {
  console.log('[Worker] Starting job worker...');
  
  // Poll loop
  setInterval(pollJobs, POLL_INTERVAL);
  
  // Also process immediately
  pollJobs();
}

start();
