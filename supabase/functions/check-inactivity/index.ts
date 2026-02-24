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

    // Get all stages with inactivity_hours configured
    const { data: stages, error: stagesErr } = await supabase
      .from('stages')
      .select('id, name, pipeline_id, tenant_id, inactivity_hours')
      .gt('inactivity_hours', 0)

    if (stagesErr) {
      console.error('Error fetching stages:', stagesErr)
      return new Response(JSON.stringify({ ok: true, error: stagesErr.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!stages || stages.length === 0) {
      return new Response(JSON.stringify({ ok: true, created: 0, message: 'No stages with inactivity configured' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    let totalCreated = 0

    for (const stage of stages) {
      const threshold = new Date(Date.now() - stage.inactivity_hours * 60 * 60 * 1000).toISOString()

      // Find inactive open opportunities in this stage
      const { data: opportunities, error: oppErr } = await supabase
        .from('opportunities')
        .select('id, title, contact_id, assigned_to, tenant_id, updated_at')
        .eq('stage_id', stage.id)
        .eq('status', 'open')
        .lt('updated_at', threshold)

      if (oppErr) {
        console.error(`Error fetching opportunities for stage ${stage.id}:`, oppErr)
        continue
      }

      if (!opportunities || opportunities.length === 0) continue

      for (const opp of opportunities) {
        // Check for existing pending follow-up
        const { data: existing } = await supabase
          .from('activities')
          .select('id')
          .eq('opportunity_id', opp.id)
          .eq('type', 'follow_up')
          .eq('is_completed', false)
          .ilike('title', '%Lembrete de follow-up%')
          .limit(1)

        if (existing && existing.length > 0) continue

        // Create follow-up activity
        const { error: insertErr } = await supabase
          .from('activities')
          .insert({
            tenant_id: opp.tenant_id,
            type: 'follow_up',
            title: `Lembrete de follow-up — ${stage.name}`,
            description: `Oportunidade "${opp.title}" está sem atualização há mais de ${stage.inactivity_hours}h na etapa "${stage.name}".`,
            opportunity_id: opp.id,
            contact_id: opp.contact_id,
            assigned_to: opp.assigned_to,
            due_date: new Date().toISOString(),
          })

        if (insertErr) {
          console.error(`Error creating follow-up for opp ${opp.id}:`, insertErr)
        } else {
          totalCreated++
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, created: totalCreated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ ok: true, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
