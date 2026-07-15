import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Auth: allow service role or CRON_SECRET
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const cronSecret = Deno.env.get('CRON_SECRET') || ''
  if (token !== SERVICE_ROLE && (!cronSecret || token !== cronSecret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

    // Find pending scheduled messages that are due
    const { data: messages, error } = await supabase
      .from('scheduled_messages')
      .select('*, conversations!inner(contact_id, channel, tenant_id, whatsapp_instance_id)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(50)

    if (error) {
      console.error('Error fetching scheduled messages:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders })
    }

    let processed = 0
    for (const msg of messages) {
      try {
        const conv = (msg as any).conversations
        if (!conv) continue

        // Get contact phone for WhatsApp
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone')
          .eq('id', conv.contact_id)
          .single()

        // Resolve provider via whatsapp_instance_id (default uazapi)
        let provider: 'meta_cloud' | 'uazapi' = 'uazapi'
        if (conv.whatsapp_instance_id) {
          const { data: inst } = await supabase
            .from('whatsapp_instances')
            .select('provider')
            .eq('id', conv.whatsapp_instance_id)
            .maybeSingle()
          if ((inst as any)?.provider === 'meta_cloud') provider = 'meta_cloud'
        }

        // Insert the message into messages table (capture id to reflect send failures)
        const { data: savedMsg } = await supabase.from('messages').insert({
          tenant_id: msg.tenant_id,
          conversation_id: msg.conversation_id,
          direction: 'outbound',
          content: msg.content,
          sender_membership_id: msg.created_by,
          is_ai_generated: false,
        }).select('id').single()

        if (conv.channel === 'whatsapp' && contact?.phone) {
          if (provider === 'meta_cloud') {
            // Agendamento pode ser texto ou template (msg.template = { name, language, components })
            const tpl = (msg as any).template
            const sendBody = tpl?.name
              ? {
                  action: 'send',
                  type: 'template',
                  template: { name: tpl.name, language: tpl.language, components: tpl.components },
                  conversation_id: msg.conversation_id,
                  whatsapp_instance_id: tpl.whatsapp_instance_id || conv.whatsapp_instance_id,
                  skip_persist: true,
                }
              : {
                  action: 'send',
                  type: 'text',
                  text: msg.content,
                  conversation_id: msg.conversation_id,
                  whatsapp_instance_id: conv.whatsapp_instance_id,
                  skip_persist: true,
                }
            // Chama wa-meta-send direto com service role
            const r = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${SERVICE_ROLE}`,
              },
              body: JSON.stringify(sendBody),
            })
            const d = await r.json().catch(() => ({}))
            if (!r.ok || d?.ok === false || d?.error) {
              console.warn('Meta send failed for scheduled msg', msg.id, d)
              const errText = typeof d?.error === 'string' ? d.error : `Falha no envio via WhatsApp Oficial (HTTP ${r.status})`
              if (savedMsg?.id) {
                await supabase.from('messages').update({
                  provider_metadata: { status: 'failed', error_message: errText, failed_at: new Date().toISOString() },
                }).eq('id', savedMsg.id)
              }
              await supabase.from('scheduled_messages').update({ status: 'failed', error_message: errText.slice(0, 500) }).eq('id', msg.id)
              continue
            }
            if (savedMsg?.id && d?.provider_message_id) {
              await supabase.from('messages').update({ provider_message_id: d.provider_message_id }).eq('id', savedMsg.id)
            }
          } else {
            // UAZAPI: enfileira para o worker (que marca mensagem/agendamento como failed se o envio falhar)
            await supabase.rpc('enqueue_job', {
              _type: 'send_whatsapp',
              _payload: JSON.stringify({
                tenant_id: msg.tenant_id,
                phone: contact.phone,
                message: msg.content,
                conversation_id: msg.conversation_id,
                message_id: savedMsg?.id ?? null,
                scheduled_message_id: msg.id,
              }),
              _tenant_id: msg.tenant_id,
            })
          }
        }

        // Update conversation
        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          last_agent_message_at: new Date().toISOString(),
          status: 'waiting_customer',
        }).eq('id', msg.conversation_id)

        // Mark as sent (limpa erro de tentativa anterior em caso de reagendamento)
        await supabase.from('scheduled_messages').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
        }).eq('id', msg.id)

        processed++
      } catch (err) {
        console.error(`Error processing scheduled message ${msg.id}:`, err)
        await supabase.from('scheduled_messages').update({
          status: 'failed',
          error_message: String(err).slice(0, 500),
        }).eq('id', msg.id)
      }
    }

    return new Response(JSON.stringify({ processed }), { headers: corsHeaders })
  } catch (err) {
    console.error('check-scheduled-messages error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
