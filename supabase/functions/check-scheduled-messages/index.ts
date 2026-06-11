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

        // Insert the message into messages table
        await supabase.from('messages').insert({
          tenant_id: msg.tenant_id,
          conversation_id: msg.conversation_id,
          direction: 'outbound',
          content: msg.content,
          sender_membership_id: msg.created_by,
          is_ai_generated: false,
        })

        if (conv.channel === 'whatsapp' && contact?.phone) {
          if (provider === 'meta_cloud') {
            // Chama wa-meta-send direto com service role
            const r = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${SERVICE_ROLE}`,
              },
              body: JSON.stringify({
                action: 'send',
                type: 'text',
                text: msg.content,
                conversation_id: msg.conversation_id,
                whatsapp_instance_id: conv.whatsapp_instance_id,
                skip_persist: true,
              }),
            })
            const d = await r.json().catch(() => ({}))
            if (!r.ok || d?.ok === false || d?.error) {
              console.warn('Meta send failed for scheduled msg', msg.id, d)
            }
          } else {
            // UAZAPI: enfileira para o worker
            await supabase.rpc('enqueue_job', {
              _type: 'send_whatsapp',
              _payload: JSON.stringify({
                tenant_id: msg.tenant_id,
                phone: contact.phone,
                message: msg.content,
                conversation_id: msg.conversation_id,
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

        // Mark as sent
        await supabase.from('scheduled_messages').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', msg.id)

        processed++
      } catch (err) {
        console.error(`Error processing scheduled message ${msg.id}:`, err)
        await supabase.from('scheduled_messages').update({
          status: 'failed',
        }).eq('id', msg.id)
      }
    }

    return new Response(JSON.stringify({ processed }), { headers: corsHeaders })
  } catch (err) {
    console.error('check-scheduled-messages error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
