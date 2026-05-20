// Types for automation rule conditions (filters)

export type FilterOperator =
  | 'eq' | 'neq'
  | 'in' | 'nin'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'between'
  | 'contains'
  | 'has_any' | 'has_all'
  | 'is_empty' | 'is_not_empty';

// Dotted paths "<entity>.<field>"
export type FilterField =
  // opportunity
  | 'opportunity.pipeline_id'
  | 'opportunity.stage_id'
  | 'opportunity.status'
  | 'opportunity.priority'
  | 'opportunity.value'
  | 'opportunity.assigned_to'
  | 'opportunity.source'
  // contact
  | 'contact.status'
  | 'contact.tags'
  | 'contact.source'
  | 'contact.utm_source'
  | 'contact.utm_medium'
  | 'contact.utm_campaign'
  | 'contact.city'
  | 'contact.state'
  | 'contact.has_phone'
  | 'contact.has_email'
  | 'contact.do_not_contact'
  | 'contact.age_days'
  // conversation
  | 'conversation.channel'
  | 'conversation.status'
  | 'conversation.whatsapp_instance_id'
  | 'conversation.assigned_to'
  // context (computed)
  | 'context.business_hours'
  | 'context.weekday'
  | 'context.hour';

export type FilterCategory = 'opportunity' | 'contact' | 'conversation' | 'context';

export interface Filter {
  field: FilterField;
  op: FilterOperator;
  value?: unknown;
}

export interface AutomationConditions {
  // Trigger-specific (kept as today: from_stage_id, to_stage_id, hours, tag, source, ...)
  trigger?: Record<string, unknown>;
  // Generic AND-combined filters applied to every trigger
  filters?: Filter[];
}

// Normalize legacy `conditions` shape into the new one.
export function normalizeConditions(raw: unknown): AutomationConditions {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if ('trigger' in c || 'filters' in c) {
    return {
      trigger: (c.trigger as Record<string, unknown>) ?? {},
      filters: Array.isArray(c.filters) ? (c.filters as Filter[]) : [],
    };
  }
  // legacy: flat fields belonged to trigger
  return { trigger: { ...c }, filters: [] };
}
