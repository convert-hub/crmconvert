// CRM Domain Types (mirrors DB schema)

export type TenantRole = 'admin' | 'manager' | 'attendant' | 'readonly';
export type ContactStatus = 'lead' | 'customer' | 'churned' | 'inactive';
export type OpportunityPriority = 'low' | 'medium' | 'high' | 'urgent';
export type OpportunityStatus = 'open' | 'won' | 'lost';
export type ConversationStatus = 'open' | 'waiting_customer' | 'waiting_agent' | 'closed';
export type ConversationChannel = 'whatsapp' | 'email' | 'phone' | 'web' | 'facebook';
export type MessageDirection = 'inbound' | 'outbound';
export type ActivityType = 'call' | 'task' | 'note' | 'email' | 'meeting' | 'follow_up';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  ai_move_mode: 'suggest_only' | 'auto_with_guard' | 'auto_free';
  ai_confidence_threshold: number;
  business_hours: Record<string, { start: string; end: string }>;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
}

export interface Contact {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  tags: string[];
  source: string | null;
  status: ContactStatus;
  consent_given: boolean;
  do_not_contact: boolean;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  birth_date: string | null;
  company_id: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pipeline {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  position: number;
}

export interface Stage {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
  is_won: boolean;
  is_lost: boolean;
  inactivity_minutes: number | null;
}

export interface Opportunity {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  priority: OpportunityPriority;
  status: OpportunityStatus;
  assigned_to: string | null;
  source: string | null;
  loss_reason: string | null;
  next_action: string | null;
  next_action_date: string | null;
  expected_close_date: string | null;
  qualification_data: Record<string, unknown>;
  conversation_state: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
  // joined
  contact?: Contact;
  stage?: Stage;
  assigned_member?: TenantMembership & { profile?: Profile };
}

export interface Conversation {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  assigned_to: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  // joined
  contact?: Contact;
  assigned_member?: TenantMembership & { profile?: Profile };
}

export interface Message {
  id: string;
  tenant_id: string;
  conversation_id: string;
  direction: MessageDirection;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  sender_membership_id: string | null;
  is_ai_generated: boolean;
  created_at: string;
}

export interface Activity {
  id: string;
  tenant_id: string;
  type: ActivityType;
  title: string;
  description: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  conversation_id: string | null;
  assigned_to: string | null;
  due_date: string | null;
  is_completed: boolean;
  created_at: string;
}
