// CRM Worker - Node.js Docker service
// Consumes jobs from Postgres queue with retry and idempotency
// Run via: docker-compose up worker

const { createClient } = require('@supabase/supabase-js');
const { executeAutomations } = require('./automation-handler');

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
    const phone = normalizePhone(data.phone || data.telefone || data.whatsapp);
    const email = data.email || null;
    const name = data.name || data.nome || data.full_name || 'Lead sem nome';

    const utm = {
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      utm_content: data.utm_content || null,
      utm_term: data.utm_term || null,
    };

    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, email, source: 'form_webhook',
        status: 'lead', ...utm,
      }).select().single();
      contact = c;
    } else {
      await supabase.from('contacts').update({ ...utm, source: 'form_webhook' }).eq('id', contact.id);
    }

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

    await supabase.from('activities').insert({
      tenant_id, type: 'note', title: 'Lead via formulário',
      description: `Novo lead recebido via webhook de formulário.`,
      contact_id: contact.id,
    });

    // Trigger automations
    await executeAutomations(supabase, tenant_id, 'lead_created', {
      contact_id: contact.id, source: 'form_webhook',
    });

    return { contact_id: contact.id };
  },

  async process_meta_lead(payload) {
    const { tenant_id, data } = payload;
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

    // Trigger automations
    await executeAutomations(supabase, tenant_id, 'lead_created', {
      contact_id: contact.id, source: 'facebook_lead_ads',
    });

    return { contact_id: contact.id };
  },

  async process_uazapi_message(payload) {
    const { tenant_id, conversation_id, contact_id, message_text, already_saved, data } = payload;

    // If the webhook already saved the message (new flow), only handle AI auto-reply
    if (already_saved) {
      console.log(`[Worker] Message already saved by webhook, checking AI auto-reply for conv=${conversation_id}`);
      
      if (!conversation_id || !contact_id) {
        return { skipped: true, reason: 'missing conversation_id or contact_id' };
      }

      // Get conversation and contact
      const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversation_id).single();
      const { data: contact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();

      if (!conv || !contact) {
        return { skipped: true, reason: 'conversation or contact not found' };
      }

      // Only auto-reply if no human agent assigned
      if (!conv.assigned_to) {
        try {
          await handleAiAutoReply(tenant_id, conv, contact, message_text || '');
        } catch (err) {
          console.error('[Worker] AI auto-reply error:', err.message);
        }
      }

      // Keyword-based lead creation for inbound messages
      if (message_text && !data?.fromMe) {
        try {
          await checkKeywordLeadCreation(tenant_id, contact_id, conversation_id, message_text);
        } catch (err) {
          console.error('[Worker] Keyword lead creation error:', err.message);
        }
      }

      // Trigger active chatbot flows with trigger_type='message_received'
      if (message_text && !data?.fromMe) {
        try {
          await triggerMessageReceivedFlows(tenant_id, contact_id, conversation_id, message_text);
        } catch (err) {
          console.error('[Worker] Flow trigger error:', err.message);
        }
      }

      return { conversation_id, contact_id, ai_processed: true };
    }

    // Legacy flow: webhook didn't save the message, process from raw data
    const msg = data || {};
    
    // UAZAPI v2 flat format
    const chatid = msg.chatid || msg.key?.remoteJid || '';
    const isGroup = chatid.endsWith('@g.us') || msg.isGroup === true;
    if (isGroup) return { skipped: true, reason: 'group message' };

    const fromMe = msg.fromMe === true || msg.key?.fromMe === true;
    const text = msg.text || msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content?.text || '';
    const senderName = msg.senderName || msg.pushName || msg.notifyName || '';
    const messageId = msg.messageid || msg.id || msg.key?.id || '';
    const sender = msg.sender || msg.chatid || msg.key?.remoteJid || '';
    
    const phone = normalizePhone(sender.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, ''));

    if (!phone || !text) {
      return { skipped: true, reason: 'no phone or content' };
    }

    // Find or create contact
    let contact = await findContact(tenant_id, phone, null);
    if (!contact) {
      const name = senderName || phone;
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, source: 'whatsapp', status: 'lead',
      }).select().single();
      contact = c;
    }

    // Find or create conversation
    let conversation;
    const { data: existingConv } = await supabase.from('conversations')
      .select('*').eq('tenant_id', tenant_id).eq('contact_id', contact.id)
      .eq('channel', 'whatsapp').in('status', ['open', 'waiting_customer', 'waiting_agent']).limit(1);

    if (existingConv && existingConv.length > 0) {
      conversation = existingConv[0];
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        tenant_id, contact_id: contact.id, channel: 'whatsapp', status: 'open',
        provider_chat_id: chatid,
      }).select().single();
      conversation = newConv;
    }

    // Save message
    await supabase.from('messages').insert({
      tenant_id, conversation_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      content: text, provider_message_id: messageId,
      provider_metadata: msg,
    });

    // Update conversation timestamps
    const updates = { last_message_at: new Date().toISOString() };
    if (!fromMe) {
      updates.last_customer_message_at = new Date().toISOString();
      updates.unread_count = (conversation.unread_count || 0) + 1;
      updates.status = 'waiting_agent';
    } else {
      updates.last_agent_message_at = new Date().toISOString();
    }
    await supabase.from('conversations').update(updates).eq('id', conversation.id);

    // AI auto-reply for inbound
    if (!fromMe && !conversation.assigned_to) {
      try {
        await handleAiAutoReply(tenant_id, conversation, contact, text);
      } catch (err) {
        console.error('[Worker] AI auto-reply error:', err.message);
      }
    }

    // Keyword-based lead creation for inbound messages (legacy flow)
    if (!fromMe && text) {
      try {
        await checkKeywordLeadCreation(tenant_id, contact.id, conversation.id, text);
      } catch (err) {
        console.error('[Worker] Keyword lead creation error:', err.message);
      }

      try {
        await triggerMessageReceivedFlows(tenant_id, contact.id, conversation.id, text);
      } catch (err) {
        console.error('[Worker] Flow trigger error:', err.message);
      }
    }

    return { contact_id: contact.id, conversation_id: conversation.id };
  },

  async send_whatsapp(payload) {
    const { tenant_id, phone, message, conversation_id } = payload;

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

    const response = await fetch(`${instance.api_url}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instToken,
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message,
        delay: 0,
        readchat: true,
        readmessages: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`UAZAPI send failed: ${response.status} ${errText}`);
    }

    return await response.json();
  },
  async run_automations(payload) {
    const { tenant_id, trigger_type, context } = payload;
    if (!tenant_id || !trigger_type) throw new Error('Missing tenant_id or trigger_type');
    await executeAutomations(supabase, tenant_id, trigger_type, context || {});
    return { trigger_type, executed: true };
  },

  async execute_flow(payload) {
    const { flow_id, tenant_id, contact_id, conversation_id, trigger_data } = payload;
    if (!flow_id || !tenant_id) throw new Error('Missing flow_id or tenant_id');

    const { data: flow } = await supabase.from('chatbot_flows').select('*').eq('id', flow_id).eq('is_active', true).single();
    if (!flow) return { skipped: true, reason: 'flow not found or inactive' };

    // Create execution record
    const { data: execution } = await supabase.from('flow_executions').insert({
      flow_id, tenant_id, contact_id: contact_id || null, conversation_id: conversation_id || null,
      status: 'running', context: { trigger_data: trigger_data || {} },
    }).select().single();

    try {
      const nodes = flow.nodes || [];
      const edges = flow.edges || [];

      // Build adjacency map
      const adjacency = {};
      edges.forEach(e => {
        const key = e.sourceHandle ? `${e.source}:${e.sourceHandle}` : e.source;
        if (!adjacency[key]) adjacency[key] = [];
        adjacency[key].push(e.target);
      });

      // Find trigger node
      const triggerNode = nodes.find(n => n.type === 'trigger');
      if (!triggerNode) throw new Error('No trigger node found');

      // BFS execution
      const queue = [triggerNode.id];
      const visited = new Set();
      const ctx = { contact_id, conversation_id, tenant_id, variables: { ...(trigger_data || {}) } };
      let stepCount = 0;
      const MAX_STEPS = 50;

      while (queue.length > 0 && stepCount < MAX_STEPS) {
        const nodeId = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        stepCount++;

        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;

        await supabase.from('flow_executions').update({ current_node_id: nodeId }).eq('id', execution.id);

        if (node.type === 'trigger') {
          // Just proceed to next
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'message') {
          // Send message via WhatsApp
          const content = (node.data?.content || '').replace(/\{\{(\w+)\}\}/g, (_, key) => ctx.variables[key] || '');
          if (content && ctx.conversation_id) {
            await supabase.from('messages').insert({
              tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
              content, is_ai_generated: false,
            });
            // Send via WhatsApp
            if (ctx.contact_id) {
              const { data: contact } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
              if (contact?.phone) {
                await supabase.rpc('enqueue_job', {
                  _type: 'send_whatsapp',
                  _payload: JSON.stringify({ tenant_id, phone: contact.phone, message: content, conversation_id: ctx.conversation_id }),
                  _tenant_id: tenant_id,
                });
              }
            }
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'delay') {
          // Schedule continuation as a delayed job
          const delayMinutes = node.data?.delayMinutes || 5;
          const runAfter = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
          // For simplicity, we just wait inline (for short delays) or enqueue continuation
          if (delayMinutes <= 1) {
            await new Promise(r => setTimeout(r, delayMinutes * 60 * 1000));
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
          } else {
            // For longer delays, we stop here and enqueue a continuation job
            // This is a simplified approach - full implementation would save state
            console.log(`[Worker] Flow ${flow_id}: delay node ${nodeId} - ${delayMinutes}min`);
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
            // In production, you'd save queue state and resume later
          }
        } else if (node.type === 'condition') {
          const field = node.data?.field || 'message';
          const operator = node.data?.operator || 'contains';
          const value = node.data?.value || '';
          let testValue = ctx.variables[field] || ctx.variables.message || '';

          let result = false;
          switch (operator) {
            case 'contains': result = testValue.toLowerCase().includes(value.toLowerCase()); break;
            case 'equals': result = testValue.toLowerCase() === value.toLowerCase(); break;
            case 'starts_with': result = testValue.toLowerCase().startsWith(value.toLowerCase()); break;
            case 'not_contains': result = !testValue.toLowerCase().includes(value.toLowerCase()); break;
          }

          // Route to yes or no handle
          const yesTargets = adjacency[`${nodeId}:yes`] || adjacency[nodeId] || [];
          const noTargets = adjacency[`${nodeId}:no`] || [];
          if (result) yesTargets.forEach(n => queue.push(n));
          else noTargets.forEach(n => queue.push(n));
        } else if (node.type === 'action') {
          const actionType = node.data?.actionType || '';
          const config = node.data?.config || {};
          switch (actionType) {
            case 'add_tag':
              if (ctx.contact_id && config.tag) {
                const { data: c } = await supabase.from('contacts').select('tags').eq('id', ctx.contact_id).single();
                const tags = [...new Set([...(c?.tags || []), config.tag])];
                await supabase.from('contacts').update({ tags }).eq('id', ctx.contact_id);
              }
              break;
            case 'remove_tag':
              if (ctx.contact_id && config.tag) {
                const { data: c } = await supabase.from('contacts').select('tags').eq('id', ctx.contact_id).single();
                const tags = (c?.tags || []).filter(t => t !== config.tag);
                await supabase.from('contacts').update({ tags }).eq('id', ctx.contact_id);
              }
              break;
            case 'send_whatsapp':
              if (ctx.contact_id && config.message) {
                const { data: contact } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
                if (contact?.phone) {
                  await supabase.rpc('enqueue_job', {
                    _type: 'send_whatsapp',
                    _payload: JSON.stringify({ tenant_id, phone: contact.phone, message: config.message, conversation_id: ctx.conversation_id }),
                    _tenant_id: tenant_id,
                  });
                }
              }
              break;
            case 'close_conversation':
              if (ctx.conversation_id) {
                await supabase.from('conversations').update({ status: 'closed' }).eq('id', ctx.conversation_id);
              }
              break;
            case 'assign_agent':
              if (ctx.conversation_id) {
                const { data: workload } = await supabase.rpc('get_member_workload', { p_tenant_id: tenant_id });
                if (workload && workload.length > 0) {
                  await supabase.from('conversations').update({ assigned_to: workload[0].membership_id }).eq('id', ctx.conversation_id);
                }
              }
              break;
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'question') {
          // Question node: the response is expected in ctx.variables.message (the user's reply)
          // Save the answer to the configured contact field
          const saveField = node.data?.saveField || '';
          const answer = ctx.variables.message || ctx.variables.last_answer || '';
          if (ctx.contact_id && saveField && answer) {
            if (saveField === 'custom') {
              const customKey = node.data?.customFieldKey || '';
              if (customKey) {
                const { data: c } = await supabase.from('contacts').select('custom_fields').eq('id', ctx.contact_id).single();
                const customFields = { ...(c?.custom_fields || {}), [customKey]: answer };
                await supabase.from('contacts').update({ custom_fields: customFields }).eq('id', ctx.contact_id);
                console.log(`[Worker] Flow: saved custom field "${customKey}" = "${answer}"`);
              }
            } else {
              const updateData = { [saveField]: answer };
              await supabase.from('contacts').update(updateData).eq('id', ctx.contact_id);
              console.log(`[Worker] Flow: saved "${saveField}" = "${answer}"`);
            }
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'randomizer') {
          const mode = node.data?.mode || 'random';
          const options = node.data?.options || [];
          if (options.length === 0) {
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
          } else {
            let chosenIndex = 0;
            if (mode === 'random') {
              // Weighted random selection
              const totalWeight = options.reduce((s, o) => s + (o.weight || 0), 0);
              const rand = Math.random() * totalWeight;
              let cumulative = 0;
              for (let i = 0; i < options.length; i++) {
                cumulative += options[i].weight || 0;
                if (rand <= cumulative) { chosenIndex = i; break; }
              }
            } else {
              // Sequential round-robin using execution context
              const counterKey = `randomizer_${nodeId}`;
              const counters = ctx.variables._randomizer_counters || {};
              const current = counters[counterKey] || 0;
              chosenIndex = current % options.length;
              // Update counter in context and flow_executions
              counters[counterKey] = current + 1;
              ctx.variables._randomizer_counters = counters;
              await supabase.from('flow_executions').update({
                context: { ...ctx, variables: ctx.variables },
              }).eq('id', execution.id);
            }
            console.log(`[Worker] Flow: randomizer ${mode} chose option ${chosenIndex} "${options[chosenIndex]?.label}"`);
            // Follow edges from the chosen option handle
            const handleKey = `${nodeId}:option-${chosenIndex}`;
            const next = adjacency[handleKey] || [];
            next.forEach(n => queue.push(n));
          }
        }
      }

      await supabase.from('flow_executions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', execution.id);
      return { execution_id: execution.id, steps: stepCount };
    } catch (err) {
      await supabase.from('flow_executions').update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() }).eq('id', execution.id);
      throw err;
    }
  },

  async send_scheduled_message(payload) {
    const { scheduled_message_id } = payload;
    if (!scheduled_message_id) throw new Error('Missing scheduled_message_id');

    const { data: msg } = await supabase.from('scheduled_messages')
      .select('*, conversations!inner(contact_id, channel)')
      .eq('id', scheduled_message_id)
      .eq('status', 'pending')
      .single();

    if (!msg) return { skipped: true, reason: 'not found or not pending' };

    const conv = msg.conversations;

    // Insert message
    await supabase.from('messages').insert({
      tenant_id: msg.tenant_id,
      conversation_id: msg.conversation_id,
      direction: 'outbound',
      content: msg.content,
      sender_membership_id: msg.created_by,
      is_ai_generated: false,
    });

    // Send via WhatsApp if applicable
    if (conv.channel === 'whatsapp' && conv.contact_id) {
      const { data: contact } = await supabase.from('contacts').select('phone').eq('id', conv.contact_id).single();
      if (contact?.phone) {
        await supabase.rpc('enqueue_job', {
          _type: 'send_whatsapp',
          _payload: JSON.stringify({
            tenant_id: msg.tenant_id,
            phone: contact.phone,
            message: msg.content,
            conversation_id: msg.conversation_id,
          }),
          _tenant_id: msg.tenant_id,
        });
      }
    }

    // Update conversation
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      last_agent_message_at: new Date().toISOString(),
      status: 'waiting_customer',
    }).eq('id', msg.conversation_id);

    // Mark as sent
    await supabase.from('scheduled_messages').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', msg.id);

    return { sent: true, scheduled_message_id };
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

// Keyword Lead Creation
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function checkKeywordLeadCreation(tenantId, contactId, conversationId, messageText) {
  // 1. Check contact status
  const { data: contact } = await supabase.from('contacts').select('id, name, status').eq('id', contactId).single();
  if (!contact || contact.status !== 'lead') return;

  // 2. Get tenant keywords
  const { data: tenant } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
  const keywords = tenant?.settings?.lead_keywords || [];
  if (keywords.length === 0) return;

  // 3. Normalize and match
  const normalizedMessage = removeAccents(messageText.toLowerCase());
  const matchedKeyword = keywords.find(k => normalizedMessage.includes(removeAccents(k.toLowerCase())));
  if (!matchedKeyword) return;

  console.log(`[Worker] Keyword match "${matchedKeyword}" for contact ${contactId}`);

  // 4. Check if open opportunity already exists
  const { data: existingOpps } = await supabase.from('opportunities')
    .select('id').eq('contact_id', contactId).eq('tenant_id', tenantId).eq('status', 'open').limit(1);
  if (existingOpps && existingOpps.length > 0) {
    console.log(`[Worker] Open opportunity already exists for contact ${contactId}, skipping`);
    return;
  }

  // 5. Get default pipeline and first stage
  const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenantId).eq('is_default', true).single();
  if (!pipeline) { console.log('[Worker] No default pipeline found'); return; }

  const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
  if (!stage) { console.log('[Worker] No stages in default pipeline'); return; }

  // 6. Create opportunity with idempotency
  const idempKey = `kw_opp_${contactId}_${new Date().toISOString().slice(0, 10)}`;
  const { data: existingByKey } = await supabase.from('opportunities')
    .select('id').eq('tenant_id', tenantId).eq('contact_id', contactId).eq('source', 'whatsapp_keyword').eq('status', 'open').limit(1);
  if (existingByKey && existingByKey.length > 0) return;

  await supabase.from('opportunities').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    pipeline_id: pipeline.id,
    stage_id: stage.id,
    title: `Lead: ${contact.name}`,
    source: 'whatsapp_keyword',
  });

  // 7. Create notification activity
  await supabase.from('activities').insert({
    tenant_id: tenantId,
    type: 'note',
    title: 'Lead acionado por palavra-chave',
    description: `Palavra-chave detectada: "${matchedKeyword}". Mensagem: "${messageText.substring(0, 200)}"`,
    contact_id: contactId,
    conversation_id: conversationId,
  });

  console.log(`[Worker] Created opportunity and activity for contact ${contactId} via keyword "${matchedKeyword}"`);
}

// AI Functions
async function getAiConfig(tenantId, taskType) {
  const { data } = await supabase.from('ai_configs').select('*, global_api_key:global_api_keys(*)')
    .eq('tenant_id', tenantId).eq('task_type', taskType).limit(1);
  if (!data || data.length === 0) return null;
  const config = data[0];
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
  const config = await getAiConfig(tenantId, 'message_generation');
  if (!config) {
    console.log('[Worker] No AI config for message_generation or limits reached');
    return;
  }

  let apiKey = config.api_key_encrypted || config.global_api_key?.api_key_encrypted || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[Worker] No API key for message_generation');
    return;
  }

  const template = await getPromptTemplate(tenantId, 'message_generation');
  if (!template) {
    console.log('[Worker] No active prompt_template for message_generation, skipping auto-reply');
    return;
  }

  const history = await getConversationHistory(conversation.id);
  const systemPrompt = template.content;

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

  const apiKey = config.api_key_encrypted || config.global_api_key?.api_key_encrypted || process.env.OPENAI_API_KEY;
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

      await supabase.from('contacts').update({ status: 'customer' }).eq('id', contact.id);

      await supabase.from('conversations').update({
        status: 'waiting_agent',
        metadata: { ...((conversation.metadata || {})), qualification: qualification },
      }).eq('id', conversation.id);

      const { data: opps } = await supabase.from('opportunities')
        .select('id').eq('contact_id', contact.id).eq('tenant_id', tenantId).eq('status', 'open').limit(1);
      if (opps && opps.length > 0) {
        await supabase.from('opportunities').update({ qualification_data: qualification }).eq('id', opps[0].id);
      }

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

// Poll loop
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
  setInterval(pollJobs, POLL_INTERVAL);
  pollJobs();
}

start();
