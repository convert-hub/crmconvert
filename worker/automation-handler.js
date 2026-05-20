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
        const norm = normalizeConditions(automation.conditions);
        if (!matchTriggerConditions(norm.trigger, context, triggerType)) continue;
        if (norm.filters && norm.filters.length > 0) {
          const data = await loadFilterData(supabase, tenantId, context);
          if (!evalFilters(norm.filters, data)) {
            console.log(`[Automations] Skipped "${automation.name}" — filters não bateram`);
            continue;
          }
        }
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

function normalizeConditions(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  if ('trigger' in c || 'filters' in c) {
    return { trigger: c.trigger || {}, filters: Array.isArray(c.filters) ? c.filters : [] };
  }
  return { trigger: { ...c }, filters: [] };
}

function matchTriggerConditions(conditions, context, triggerType) {
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
    default:
      return true;
  }
}

// ─── Filter data loading ──────────────────────────────────────────────────

async function loadFilterData(supabase, tenantId, context) {
  const data = { opportunity: null, contact: null, conversation: null, tenant: null, now: new Date() };

  const promises = [];
  if (context.opportunity_id) {
    promises.push(supabase.from('opportunities').select('*').eq('id', context.opportunity_id).maybeSingle()
      .then(({ data: d }) => { data.opportunity = d; }));
  }
  if (context.contact_id) {
    promises.push(supabase.from('contacts').select('*').eq('id', context.contact_id).maybeSingle()
      .then(({ data: d }) => { data.contact = d; }));
  }
  if (context.conversation_id) {
    promises.push(supabase.from('conversations').select('*').eq('id', context.conversation_id).maybeSingle()
      .then(({ data: d }) => { data.conversation = d; }));
  }
  promises.push(supabase.from('tenants').select('business_hours, timezone').eq('id', tenantId).maybeSingle()
    .then(({ data: d }) => { data.tenant = d; }));

  await Promise.all(promises);
  return data;
}

// ─── Filter evaluation ────────────────────────────────────────────────────

function evalFilters(filters, data) {
  for (const f of filters) {
    if (!evalFilter(f, data)) return false;
  }
  return true;
}

function getFieldValue(field, data) {
  const [entity, ...rest] = field.split('.');
  const key = rest.join('.');

  if (entity === 'opportunity' && data.opportunity) {
    return data.opportunity[key];
  }
  if (entity === 'contact' && data.contact) {
    switch (key) {
      case 'tags': return data.contact.tags || [];
      case 'has_phone': return !!data.contact.phone;
      case 'has_email': return !!data.contact.email;
      case 'age_days': {
        if (!data.contact.created_at) return null;
        const diff = Date.now() - new Date(data.contact.created_at).getTime();
        return Math.floor(diff / 86400000);
      }
      default: return data.contact[key];
    }
  }
  if (entity === 'conversation' && data.conversation) {
    return data.conversation[key];
  }
  if (entity === 'context') {
    const tz = data.tenant?.timezone || 'America/Sao_Paulo';
    const now = data.now;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const hourStr = parts.find(p => p.type === 'hour')?.value || '0';
    const minuteStr = parts.find(p => p.type === 'minute')?.value || '0';
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value || '';
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = weekdayMap[weekdayStr] ?? new Date(now).getDay();
    const hour = parseInt(hourStr, 10) % 24;

    if (key === 'hour') return hour;
    if (key === 'weekday') return String(weekday);
    if (key === 'business_hours') {
      const bh = data.tenant?.business_hours || {};
      const dayKeys = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      const today = bh[dayKeys[weekday]];
      if (!today || !today.start || !today.end) return false;
      const nowMin = hour * 60 + parseInt(minuteStr, 10);
      const [sH, sM] = today.start.split(':').map(Number);
      const [eH, eM] = today.end.split(':').map(Number);
      return nowMin >= (sH * 60 + sM) && nowMin <= (eH * 60 + eM);
    }
  }
  return null;
}

function evalFilter(filter, data) {
  const { field, op, value } = filter;
  const actual = getFieldValue(field, data);

  switch (op) {
    case 'eq': return String(actual ?? '') === String(value ?? '');
    case 'neq': return String(actual ?? '') !== String(value ?? '');
    case 'in': return Array.isArray(value) && value.map(String).includes(String(actual));
    case 'nin': return Array.isArray(value) && !value.map(String).includes(String(actual));
    case 'gt': return Number(actual) > Number(value);
    case 'gte': return Number(actual) >= Number(value);
    case 'lt': return Number(actual) < Number(value);
    case 'lte': return Number(actual) <= Number(value);
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const n = Number(actual);
      return n >= Number(value[0]) && n <= Number(value[1]);
    }
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'has_any': {
      const arr = Array.isArray(actual) ? actual : [];
      const v = Array.isArray(value) ? value : [value];
      return v.some(x => arr.includes(x));
    }
    case 'has_all': {
      const arr = Array.isArray(actual) ? actual : [];
      const v = Array.isArray(value) ? value : [value];
      return v.every(x => arr.includes(x));
    }
    case 'is_empty':
      return actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'is_not_empty':
      return !(actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0));
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
            whatsapp_instance_id: action.whatsapp_instance_id || null,
          }),
          _tenant_id: tenantId,
        });
        console.log(`[Automations] Enqueued WhatsApp message to ${contact.phone}`);
      }
      break;
    }

    case 'send_whatsapp_template': {
      if (!action.template_id || !action.whatsapp_instance_id || !context.contact_id) break;
      const { data: contact } = await supabase.from('contacts').select('phone').eq('id', context.contact_id).single();
      if (!contact?.phone) break;
      await supabase.rpc('enqueue_job', {
        _type: 'send_whatsapp_template',
        _payload: JSON.stringify({
          tenant_id: tenantId,
          phone: contact.phone,
          contact_id: context.contact_id,
          conversation_id: context.conversation_id || null,
          whatsapp_instance_id: action.whatsapp_instance_id,
          template_id: action.template_id,
          template_variables: action.template_variables || {},
        }),
        _tenant_id: tenantId,
      });
      console.log(`[Automations] Enqueued WhatsApp template to ${contact.phone}`);
      break;
    }

    case 'assign_round_robin': {
      if (!context.opportunity_id) break;
      const { data: workload } = await supabase.rpc('get_member_workload', { p_tenant_id: tenantId });

      if (!workload || workload.length === 0) {
        const { data: members } = await supabase.from('tenant_memberships')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .in('role', ['attendant', 'manager', 'admin']);
        if (!members || members.length === 0) break;
        const assignTo = members[Math.floor(Math.random() * members.length)].id;
        await supabase.from('opportunities').update({ assigned_to: assignTo }).eq('id', context.opportunity_id);
        if (context.contact_id) {
          await supabase.from('contacts').update({ assigned_to: assignTo }).eq('id', context.contact_id);
        }
        console.log(`[Automations] Fallback round-robin assigned to ${assignTo}`);
        break;
      }

      const assignTo = workload[0].membership_id;
      await supabase.from('opportunities').update({ assigned_to: assignTo }).eq('id', context.opportunity_id);
      if (context.contact_id) {
        await supabase.from('contacts').update({ assigned_to: assignTo }).eq('id', context.contact_id);
      }
      if (context.conversation_id) {
        await supabase.from('conversations').update({ assigned_to: assignTo }).eq('id', context.conversation_id);
      }
      console.log(`[Automations] Workload-based round-robin assigned to ${assignTo} (load: ${workload[0].total_load})`);
      break;
    }

    default:
      console.warn(`[Automations] Unknown action type: ${type}`);
  }
}

module.exports = { executeAutomations };
