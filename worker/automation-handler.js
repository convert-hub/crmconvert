// Automation execution engine for the CRM worker
// Processes structured automation actions triggered by events

async function executeAutomations(supabase, tenantId, triggerType, context) {
  // context: { opportunity_id, contact_id, conversation_id, from_stage_id, to_stage_id, tag, ... }
  try {
    const { data: automations } = await supabase
      .from('automations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('trigger_type', triggerType)
      .eq('is_active', true);

    if (!automations || automations.length === 0) return;

    for (const automation of automations) {
      try {
        if (!matchConditions(automation.conditions, context, triggerType)) continue;
        console.log(`[Automations] Running "${automation.name}" (${automation.id})`);

        const actions = Array.isArray(automation.actions) ? automation.actions : [];
        for (const action of actions) {
          await executeAction(supabase, tenantId, action, context);
        }
      } catch (err) {
        console.error(`[Automations] Error in automation "${automation.name}":`, err.message);
      }
    }
  } catch (err) {
    console.error('[Automations] Failed to load automations:', err.message);
  }
}

function matchConditions(conditions, context, triggerType) {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  switch (triggerType) {
    case 'opportunity_stage_changed':
      if (conditions.from_stage_id && conditions.from_stage_id !== context.from_stage_id) return false;
      if (conditions.to_stage_id && conditions.to_stage_id !== context.to_stage_id) return false;
      return true;

    case 'tag_added':
    case 'tag_removed':
      if (conditions.tag && conditions.tag !== context.tag) return false;
      return true;

    case 'lead_created':
      if (conditions.source && conditions.source !== context.source) return false;
      return true;

    case 'conversation_no_customer_reply':
    case 'conversation_no_agent_reply':
      // hours condition is checked by the cron/check-inactivity function
      return true;

    default:
      return true;
  }
}

async function executeAction(supabase, tenantId, action, context) {
  const { type } = action;

  switch (type) {
    case 'move_to_stage': {
      if (!action.stage_id || !context.opportunity_id) break;
      await supabase.from('opportunities').update({ stage_id: action.stage_id }).eq('id', context.opportunity_id);
      // Record stage move
      await supabase.from('stage_moves').insert({
        tenant_id: tenantId,
        opportunity_id: context.opportunity_id,
        from_stage_id: context.to_stage_id || context.from_stage_id || null,
        to_stage_id: action.stage_id,
        is_ai_move: false,
        ai_reason: 'Automação',
      });
      console.log(`[Automations] Moved opportunity ${context.opportunity_id} to stage ${action.stage_id}`);
      break;
    }

    case 'add_tag': {
      if (!action.tag || !context.contact_id) break;
      const { data: contact } = await supabase.from('contacts').select('tags').eq('id', context.contact_id).single();
      const tags = contact?.tags || [];
      if (!tags.includes(action.tag)) {
        await supabase.from('contacts').update({ tags: [...tags, action.tag] }).eq('id', context.contact_id);
        console.log(`[Automations] Added tag "${action.tag}" to contact ${context.contact_id}`);
      }
      break;
    }

    case 'remove_tag': {
      if (!action.tag || !context.contact_id) break;
      const { data: contact } = await supabase.from('contacts').select('tags').eq('id', context.contact_id).single();
      const tags = (contact?.tags || []).filter(t => t !== action.tag);
      await supabase.from('contacts').update({ tags }).eq('id', context.contact_id);
      console.log(`[Automations] Removed tag "${action.tag}" from contact ${context.contact_id}`);
      break;
    }

    case 'create_activity': {
      const dueDate = action.activity_due_hours
        ? new Date(Date.now() + action.activity_due_hours * 3600000).toISOString()
        : null;
      await supabase.from('activities').insert({
        tenant_id: tenantId,
        type: action.activity_type || 'follow_up',
        title: action.activity_title || 'Atividade automática',
        contact_id: context.contact_id || null,
        opportunity_id: context.opportunity_id || null,
        conversation_id: context.conversation_id || null,
        due_date: dueDate,
      });
      console.log(`[Automations] Created activity "${action.activity_title}"`);
      break;
    }

    case 'change_contact_status': {
      if (!action.contact_status || !context.contact_id) break;
      await supabase.from('contacts').update({ status: action.contact_status }).eq('id', context.contact_id);
      console.log(`[Automations] Changed contact ${context.contact_id} status to ${action.contact_status}`);
      break;
    }

    case 'send_whatsapp': {
      if (!action.whatsapp_message || !context.contact_id) break;
      const { data: contact } = await supabase.from('contacts').select('phone').eq('id', context.contact_id).single();
      if (contact?.phone) {
        await supabase.rpc('enqueue_job', {
          _type: 'send_whatsapp',
          _payload: JSON.stringify({
            tenant_id: tenantId,
            phone: contact.phone,
            message: action.whatsapp_message,
            conversation_id: context.conversation_id || null,
          }),
          _tenant_id: tenantId,
        });
        console.log(`[Automations] Enqueued WhatsApp message to ${contact.phone}`);
      }
      break;
    }

    case 'assign_round_robin': {
      if (!context.opportunity_id) break;
      // Get active members (attendants, managers)
      const { data: members } = await supabase.from('tenant_memberships')
        .select('id, user_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('role', ['attendant', 'manager', 'admin']);

      if (!members || members.length === 0) break;

      // Count open opportunities per member
      const counts = await Promise.all(members.map(async m => {
        const { count } = await supabase.from('opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('assigned_to', m.id)
          .eq('status', 'open');
        return { membership_id: m.id, count: count || 0 };
      }));

      counts.sort((a, b) => a.count - b.count);
      const assignTo = counts[0].membership_id;

      await supabase.from('opportunities').update({ assigned_to: assignTo }).eq('id', context.opportunity_id);
      if (context.contact_id) {
        await supabase.from('contacts').update({ assigned_to: assignTo }).eq('id', context.contact_id);
      }
      console.log(`[Automations] Round-robin assigned to ${assignTo}`);
      break;
    }

    default:
      console.warn(`[Automations] Unknown action type: ${type}`);
  }
}

module.exports = { executeAutomations };
