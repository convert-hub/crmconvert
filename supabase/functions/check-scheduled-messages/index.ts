import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find pending scheduled messages that are due
    const { data: messages, error } = await supabase
      .from('scheduled_messages')
      .select('*, conversations!inner(contact_id, channel, tenant_id)')
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

        // Insert the message into messages table
        await supabase.from('messages').insert({
          tenant_id: msg.tenant_id,
          conversation_id: msg.conversation_id,
          direction: 'outbound',
          content: msg.content,
          sender_membership_id: msg.created_by,
          is_ai_generated: false,
        })

        // If WhatsApp, enqueue send job
        if (conv.channel === 'whatsapp' && contact?.phone) {
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
