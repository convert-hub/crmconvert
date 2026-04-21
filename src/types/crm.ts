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
  timezone: string;
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
  whatsapp_instance_id?: string | null;
  created_at: string;
  // joined
  contact?: Contact;
  assigned_member?: TenantMembership & { profile?: Profile };
}

export type WhatsAppProvider = 'uazapi' | 'meta_cloud';

export interface WhatsAppInstance {
  id: string;
  tenant_id: string;
  provider: WhatsAppProvider;
  display_name?: string | null;
  instance_name: string;
  api_url: string;
  phone_number: string | null;
  is_active: boolean;
  // Meta Cloud (optional, only for provider='meta_cloud')
  meta_phone_number_id?: string | null;
  meta_waba_id?: string | null;
  meta_verify_token?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMessageTemplate {
  id: string;
  tenant_id: string;
  whatsapp_instance_id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: Array<Record<string, unknown>>;
  meta_template_id: string | null;
  created_at: string;
  updated_at: string;
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

// ----- Campaigns (mass send via Meta templates) -----
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type CampaignRecipientStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'replied' | 'skipped';

export interface CampaignAudienceFilter {
  tags?: string[];
  status?: ContactStatus[];
  pipeline_id?: string | null;
  stage_id?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  source?: string | null;
  has_phone?: boolean;
  consent_required?: boolean;
  exclude_do_not_contact?: boolean;
  inactive_days?: number | null;
}

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  whatsapp_instance_id: string | null;
  template_id: string | null;
  template_variables: Record<string, string>;
  audience_filter: CampaignAudienceFilter;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  throttle_per_minute: number;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  replied_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  tenant_id: string;
  campaign_id: string;
  contact_id: string;
  conversation_id: string | null;
  message_id: string | null;
  provider_message_id: string | null;
  variables_used: Record<string, string>;
  status: CampaignRecipientStatus;
  error: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}
