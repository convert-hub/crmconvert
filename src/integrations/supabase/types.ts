export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_completed: boolean | null
          metadata: Json | null
          opportunity_id: string | null
          tenant_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          metadata?: Json | null
          opportunity_id?: string | null
          tenant_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          metadata?: Json | null
          opportunity_id?: string | null
          tenant_id?: string
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_configs: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          daily_limit: number | null
          daily_usage: number | null
          global_api_key_id: string | null
          id: string
          model: string
          monthly_limit: number | null
          monthly_usage: number | null
          provider: string
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          updated_at: string
          usage_reset_at: string | null
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          daily_limit?: number | null
          daily_usage?: number | null
          global_api_key_id?: string | null
          id?: string
          model?: string
          monthly_limit?: number | null
          monthly_usage?: number | null
          provider?: string
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          updated_at?: string
          usage_reset_at?: string | null
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          daily_limit?: number | null
          daily_usage?: number | null
          global_api_key_id?: string | null
          id?: string
          model?: string
          monthly_limit?: number | null
          monthly_usage?: number | null
          provider?: string
          task_type?: Database["public"]["Enums"]["ai_task_type"]
          tenant_id?: string
          updated_at?: string
          usage_reset_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_configs_global_api_key_id_fkey"
            columns: ["global_api_key_id"]
            isOneToOne: false
            referencedRelation: "global_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_logs: {
        Row: {
          cost_estimate: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          input_data: Json | null
          model: string | null
          output_data: Json | null
          provider: string | null
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          tokens_used: number | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_data?: Json | null
          model?: string | null
          output_data?: Json | null
          provider?: string | null
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          tokens_used?: number | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_data?: Json | null
          model?: string | null
          output_data?: Json | null
          provider?: string | null
          task_type?: Database["public"]["Enums"]["ai_task_type"]
          tenant_id?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          target_id: string | null
          target_table: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json | null
          conditions: Json | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          trigger_type: Database["public"]["Enums"]["automation_trigger"]
          updated_at: string
        }
        Insert: {
          actions?: Json | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          trigger_type: Database["public"]["Enums"]["automation_trigger"]
          updated_at?: string
        }
        Update: {
          actions?: Json | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          trigger_type?: Database["public"]["Enums"]["automation_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_flows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          edges: Json
          id: string
          is_active: boolean
          name: string
          nodes: Json
          tenant_id: string
          trigger_config: Json | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean
          name: string
          nodes?: Json
          tenant_id: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          tenant_id?: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_flows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_flows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          ad_id: string | null
          adset_id: string | null
          assigned_to: string | null
          avatar_url: string | null
          birth_date: string | null
          campaign_id: string | null
          city: string | null
          company_id: string | null
          consent_given: boolean | null
          created_at: string
          custom_fields: Json | null
          do_not_contact: boolean | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          state: string | null
          status: Database["public"]["Enums"]["contact_status"]
          tags: string[] | null
          tenant_id: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ad_id?: string | null
          adset_id?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          campaign_id?: string | null
          city?: string | null
          company_id?: string | null
          consent_given?: boolean | null
          created_at?: string
          custom_fields?: Json | null
          do_not_contact?: boolean | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ad_id?: string | null
          adset_id?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          campaign_id?: string | null
          city?: string | null
          company_id?: string | null
          consent_given?: boolean | null
          created_at?: string
          custom_fields?: Json | null
          do_not_contact?: boolean | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_fk"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_fk"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reviews: {
        Row: {
          ai_cost_estimate: number | null
          ai_model_used: string | null
          comments: string | null
          conversation_id: string
          created_at: string
          id: string
          rating: number | null
          reviewed_by: string | null
          strengths: string | null
          suggestions: string | null
          tenant_id: string
          weaknesses: string | null
        }
        Insert: {
          ai_cost_estimate?: number | null
          ai_model_used?: string | null
          comments?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          rating?: number | null
          reviewed_by?: string | null
          strengths?: string | null
          suggestions?: string | null
          tenant_id: string
          weaknesses?: string | null
        }
        Update: {
          ai_cost_estimate?: number | null
          ai_model_used?: string | null
          comments?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          rating?: number | null
          reviewed_by?: string | null
          strengths?: string | null
          suggestions?: string | null
          tenant_id?: string
          weaknesses?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reviews_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          contact_id: string | null
          created_at: string
          id: string
          last_agent_message_at: string | null
          last_customer_message_at: string | null
          last_message_at: string | null
          metadata: Json | null
          opportunity_id: string | null
          provider_chat_id: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          tenant_id: string
          unread_count: number | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          contact_id?: string | null
          created_at?: string
          id?: string
          last_agent_message_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          metadata?: Json | null
          opportunity_id?: string | null
          provider_chat_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          tenant_id: string
          unread_count?: number | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          contact_id?: string | null
          created_at?: string
          id?: string
          last_agent_message_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          metadata?: Json | null
          opportunity_id?: string | null
          provider_chat_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          tenant_id?: string
          unread_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_executions: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          context: Json | null
          conversation_id: string | null
          current_node_id: string | null
          error: string | null
          flow_id: string
          id: string
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          context?: Json | null
          conversation_id?: string | null
          current_node_id?: string | null
          error?: string | null
          flow_id: string
          id?: string
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          context?: Json | null
          conversation_id?: string | null
          current_node_id?: string | null
          error?: string | null
          flow_id?: string
          id?: string
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_executions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "chatbot_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      global_api_keys: {
        Row: {
          api_key_encrypted: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          metadata: Json | null
          provider: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          metadata?: Json | null
          provider: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          metadata?: Json | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          run_after: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          is_ai_generated: boolean | null
          is_internal: boolean
          media_type: string | null
          media_url: string | null
          provider_message_id: string | null
          provider_metadata: Json | null
          sender_membership_id: string | null
          tenant_id: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          is_ai_generated?: boolean | null
          is_internal?: boolean
          media_type?: string | null
          media_url?: string | null
          provider_message_id?: string | null
          provider_metadata?: Json | null
          sender_membership_id?: string | null
          tenant_id: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          is_ai_generated?: boolean | null
          is_internal?: boolean
          media_type?: string | null
          media_url?: string | null
          provider_message_id?: string | null
          provider_metadata?: Json | null
          sender_membership_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_membership_id_fkey"
            columns: ["sender_membership_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          assigned_to: string | null
          company_id: string | null
          contact_id: string | null
          conversation_state: Json | null
          created_at: string
          custom_fields: Json | null
          expected_close_date: string | null
          id: string
          loss_reason: string | null
          next_action: string | null
          next_action_date: string | null
          pipeline_id: string
          position: number | null
          priority: Database["public"]["Enums"]["opportunity_priority"] | null
          qualification_data: Json | null
          source: string | null
          stage_id: string
          status: Database["public"]["Enums"]["opportunity_status"]
          tenant_id: string
          title: string
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          value: number | null
        }
        Insert: {
          assigned_to?: string | null
          company_id?: string | null
          contact_id?: string | null
          conversation_state?: Json | null
          created_at?: string
          custom_fields?: Json | null
          expected_close_date?: string | null
          id?: string
          loss_reason?: string | null
          next_action?: string | null
          next_action_date?: string | null
          pipeline_id: string
          position?: number | null
          priority?: Database["public"]["Enums"]["opportunity_priority"] | null
          qualification_data?: Json | null
          source?: string | null
          stage_id: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          tenant_id: string
          title: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          value?: number | null
        }
        Update: {
          assigned_to?: string | null
          company_id?: string | null
          contact_id?: string | null
          conversation_state?: Json | null
          created_at?: string
          custom_fields?: Json | null
          expected_close_date?: string | null
          id?: string
          loss_reason?: string | null
          next_action?: string | null
          next_action_date?: string | null
          pipeline_id?: string
          position?: number | null
          priority?: Database["public"]["Enums"]["opportunity_priority"] | null
          qualification_data?: Json | null
          source?: string | null
          stage_id?: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          id: string
          is_default: boolean | null
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          forbidden_terms: string[] | null
          id: string
          is_active: boolean | null
          name: string
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          updated_at: string
          variables: string[] | null
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          forbidden_terms?: string[] | null
          id?: string
          is_active?: boolean | null
          name: string
          task_type: Database["public"]["Enums"]["ai_task_type"]
          tenant_id: string
          updated_at?: string
          variables?: string[] | null
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          forbidden_terms?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          task_type?: Database["public"]["Enums"]["ai_task_type"]
          tenant_id?: string
          updated_at?: string
          variables?: string[] | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          position: number
          shortcut: string
          tenant_id: string
          title: string
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          position?: number
          shortcut: string
          tenant_id: string
          title: string
          updated_at?: string
          variables?: string[] | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          position?: number
          shortcut?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_replies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_admins: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          media_type: string | null
          media_url: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_moves: {
        Row: {
          ai_reason: string | null
          confidence_score: number | null
          created_at: string
          criteria_met: Json | null
          from_stage_id: string | null
          id: string
          is_ai_move: boolean | null
          moved_by: string | null
          opportunity_id: string
          tenant_id: string
          to_stage_id: string
          undone: boolean | null
        }
        Insert: {
          ai_reason?: string | null
          confidence_score?: number | null
          created_at?: string
          criteria_met?: Json | null
          from_stage_id?: string | null
          id?: string
          is_ai_move?: boolean | null
          moved_by?: string | null
          opportunity_id: string
          tenant_id: string
          to_stage_id: string
          undone?: boolean | null
        }
        Update: {
          ai_reason?: string | null
          confidence_score?: number | null
          created_at?: string
          criteria_met?: Json | null
          from_stage_id?: string | null
          id?: string
          is_ai_move?: boolean | null
          moved_by?: string | null
          opportunity_id?: string
          tenant_id?: string
          to_stage_id?: string
          undone?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_moves_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_moves_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_moves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_moves_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          inactivity_minutes: number | null
          is_lost: boolean | null
          is_won: boolean | null
          name: string
          pipeline_id: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          inactivity_minutes?: number | null
          is_lost?: boolean | null
          is_won?: boolean | null
          name: string
          pipeline_id: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          inactivity_minutes?: number | null
          is_lost?: boolean | null
          is_won?: boolean | null
          name?: string
          pipeline_id?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_confidence_threshold: number
          ai_move_mode: Database["public"]["Enums"]["ai_move_mode"]
          business_hours: Json | null
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          ai_confidence_threshold?: number
          ai_move_mode?: Database["public"]["Enums"]["ai_move_mode"]
          business_hours?: Json | null
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          ai_confidence_threshold?: number
          ai_move_mode?: Database["public"]["Enums"]["ai_move_mode"]
          business_hours?: Json | null
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          processed: boolean | null
          processing_error: string | null
          raw_payload: Json
          source: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          processed?: boolean | null
          processing_error?: string | null
          raw_payload: Json
          source: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          processed?: boolean | null
          processing_error?: string | null
          raw_payload?: Json
          source?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          api_token_encrypted: string | null
          api_url: string
          created_at: string
          id: string
          instance_name: string
          is_active: boolean | null
          phone_number: string | null
          tenant_id: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_token_encrypted?: string | null
          api_url: string
          created_at?: string
          id?: string
          instance_name: string
          is_active?: boolean | null
          phone_number?: string | null
          tenant_id: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_token_encrypted?: string | null
          api_url?: string
          created_at?: string
          id?: string
          instance_name?: string
          is_active?: boolean | null
          phone_number?: string | null
          tenant_id?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_next_job: {
        Args: { _types?: string[] }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          run_after: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string | null
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_job: {
        Args: { _job_id: string; _result?: Json }
        Returns: undefined
      }
      enqueue_job: {
        Args: {
          _idempotency_key?: string
          _max_attempts?: number
          _payload: Json
          _run_after?: string
          _tenant_id?: string
          _type: string
        }
        Returns: string
      }
      fail_job: {
        Args: { _error: string; _job_id: string }
        Returns: undefined
      }
      get_member_workload: {
        Args: { p_tenant_id: string }
        Returns: {
          membership_id: string
          open_conversations: number
          open_opportunities: number
          role: string
          total_load: number
          user_id: string
        }[]
      }
      get_user_membership_id: { Args: { _tenant_id: string }; Returns: string }
      get_user_role_in_tenant: {
        Args: { _tenant_id: string }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      get_user_tenant_id: { Args: never; Returns: string }
      has_tenant_role: {
        Args: {
          _role: Database["public"]["Enums"]["tenant_role"]
          _tenant_id: string
        }
        Returns: boolean
      }
      is_admin_or_manager: { Args: { _tenant_id: string }; Returns: boolean }
      is_member_of_tenant: { Args: { _tenant_id: string }; Returns: boolean }
      is_saas_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      activity_type:
        | "call"
        | "task"
        | "note"
        | "email"
        | "meeting"
        | "follow_up"
      ai_move_mode: "suggest_only" | "auto_with_guard" | "auto_free"
      ai_task_type:
        | "message_generation"
        | "qa_review"
        | "qualification"
        | "stage_classifier"
      automation_trigger:
        | "lead_created"
        | "opportunity_stage_changed"
        | "conversation_no_customer_reply"
        | "conversation_no_agent_reply"
        | "conversation_closed"
        | "tag_added"
        | "tag_removed"
      contact_status: "lead" | "customer" | "churned" | "inactive"
      conversation_channel: "whatsapp" | "email" | "phone" | "web" | "facebook"
      conversation_status:
        | "open"
        | "waiting_customer"
        | "waiting_agent"
        | "closed"
      job_status: "queued" | "running" | "done" | "failed" | "dead"
      message_direction: "inbound" | "outbound"
      opportunity_priority: "low" | "medium" | "high" | "urgent"
      opportunity_status: "open" | "won" | "lost"
      tenant_role: "admin" | "manager" | "attendant" | "readonly"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: ["call", "task", "note", "email", "meeting", "follow_up"],
      ai_move_mode: ["suggest_only", "auto_with_guard", "auto_free"],
      ai_task_type: [
        "message_generation",
        "qa_review",
        "qualification",
        "stage_classifier",
      ],
      automation_trigger: [
        "lead_created",
        "opportunity_stage_changed",
        "conversation_no_customer_reply",
        "conversation_no_agent_reply",
        "conversation_closed",
        "tag_added",
        "tag_removed",
      ],
      contact_status: ["lead", "customer", "churned", "inactive"],
      conversation_channel: ["whatsapp", "email", "phone", "web", "facebook"],
      conversation_status: [
        "open",
        "waiting_customer",
        "waiting_agent",
        "closed",
      ],
      job_status: ["queued", "running", "done", "failed", "dead"],
      message_direction: ["inbound", "outbound"],
      opportunity_priority: ["low", "medium", "high", "urgent"],
      opportunity_status: ["open", "won", "lost"],
      tenant_role: ["admin", "manager", "attendant", "readonly"],
    },
  },
} as const
