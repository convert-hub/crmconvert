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

    // Send via UAZAPI API
    const response = await fetch(`${instance.api_url}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${instance.api_token_encrypted}`, // In production, decrypt first
      },
      body: JSON.stringify({
        phone: phone.replace('+', ''),
        message: message,
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

// Main loop
async function pollJobs() {
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
