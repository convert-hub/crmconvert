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
      acompanhamentos_cs: {
        Row: {
          autor_id: string
          cliente_id: string
          conteudo: string | null
          created_at: string
          data_interacao: string
          duracao_minutos: number | null
          id: string
          participantes_reuniao: Json | null
          proximos_passos: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_acompanhamento"]
          titulo: string
          updated_at: string
        }
        Insert: {
          autor_id: string
          cliente_id: string
          conteudo?: string | null
          created_at?: string
          data_interacao?: string
          duracao_minutos?: number | null
          id?: string
          participantes_reuniao?: Json | null
          proximos_passos?: string | null
          tenant_id: string
          tipo?: Database["public"]["Enums"]["tipo_acompanhamento"]
          titulo: string
          updated_at?: string
        }
        Update: {
          autor_id?: string
          cliente_id?: string
          conteudo?: string | null
          created_at?: string
          data_interacao?: string
          duracao_minutos?: number | null
          id?: string
          participantes_reuniao?: Json | null
          proximos_passos?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_acompanhamento"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acompanhamentos_cs_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string | null
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string | null
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string | null
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          contexto: Json | null
          created_at: string | null
          id: string
          last_message_at: string | null
          lead_id: string | null
          mensagens_ia_count: number | null
          pending_messages: Json | null
          qualificacao_dados: Json | null
          status: string
          telefone: string
          tenant_id: string
          transferido_em: string | null
          transferido_para: string | null
          updated_at: string | null
        }
        Insert: {
          contexto?: Json | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          mensagens_ia_count?: number | null
          pending_messages?: Json | null
          qualificacao_dados?: Json | null
          status?: string
          telefone: string
          tenant_id: string
          transferido_em?: string | null
          transferido_para?: string | null
          updated_at?: string | null
        }
        Update: {
          contexto?: Json | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          mensagens_ia_count?: number | null
          pending_messages?: Json | null
          qualificacao_dados?: Json | null
          status?: string
          telefone?: string
          tenant_id?: string
          transferido_em?: string | null
          transferido_para?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_transferido_para_fkey"
            columns: ["transferido_para"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_financeiras: {
        Row: {
          ativa: boolean | null
          cor: string | null
          created_at: string | null
          icone: string | null
          id: string
          nome: string
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_transacao"]
        }
        Insert: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome: string
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_transacao"]
        }
        Update: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome?: string
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_transacao"]
        }
        Relationships: [
          {
            foreignKeyName: "categorias_financeiras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      centros_custo: {
        Row: {
          ativo: boolean | null
          cliente_id: string | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          tenant_id: string
        }
        Insert: {
          ativo?: boolean | null
          cliente_id?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          tenant_id: string
        }
        Update: {
          ativo?: boolean | null
          cliente_id?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "centros_custo_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_custo_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_canais: {
        Row: {
          avatar_url: string | null
          created_at: string
          criador_id: string
          id: string
          nome: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_canal_chat"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          criador_id: string
          id?: string
          nome?: string | null
          tenant_id: string
          tipo?: Database["public"]["Enums"]["tipo_canal_chat"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          criador_id?: string
          id?: string
          nome?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_canal_chat"]
          updated_at?: string
        }
        Relationships: []
      }
      chat_mensagens: {
        Row: {
          anexos: Json | null
          autor_id: string
          canal_id: string
          conteudo: string
          created_at: string
          editado: boolean | null
          id: string
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          anexos?: Json | null
          autor_id: string
          canal_id: string
          conteudo: string
          created_at?: string
          editado?: boolean | null
          id?: string
          tenant_id: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          anexos?: Json | null
          autor_id?: string
          canal_id?: string
          conteudo?: string
          created_at?: string
          editado?: boolean | null
          id?: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_mensagens_canal_id_fkey"
            columns: ["canal_id"]
            isOneToOne: false
            referencedRelation: "chat_canais"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participantes: {
        Row: {
          canal_id: string
          id: string
          joined_at: string
          last_read_at: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          canal_id: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          canal_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participantes_canal_id_fkey"
            columns: ["canal_id"]
            isOneToOne: false
            referencedRelation: "chat_canais"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profitability_analysis: {
        Row: {
          analise_ia: string | null
          classificacao: string | null
          cliente_id: string
          created_at: string | null
          horas_trabalhadas: number | null
          id: string
          periodo_fim: string
          periodo_inicio: string
          recomendacoes: Json | null
          score_lucratividade: number | null
          tenant_id: string
          valor_por_hora: number | null
          valor_recebido: number | null
        }
        Insert: {
          analise_ia?: string | null
          classificacao?: string | null
          cliente_id: string
          created_at?: string | null
          horas_trabalhadas?: number | null
          id?: string
          periodo_fim: string
          periodo_inicio: string
          recomendacoes?: Json | null
          score_lucratividade?: number | null
          tenant_id: string
          valor_por_hora?: number | null
          valor_recebido?: number | null
        }
        Update: {
          analise_ia?: string | null
          classificacao?: string | null
          cliente_id?: string
          created_at?: string | null
          horas_trabalhadas?: number | null
          id?: string
          periodo_fim?: string
          periodo_inicio?: string
          recomendacoes?: Json | null
          score_lucratividade?: number | null
          tenant_id?: string
          valor_por_hora?: number | null
          valor_recebido?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_profitability_analysis_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_profitability_analysis_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          aprovacao_padrao:
            | Database["public"]["Enums"]["aprovacao_padrao"]
            | null
          asaas_customer_id: string | null
          asaas_key_id: string | null
          ativo: boolean | null
          aviso_previo_dias: number | null
          cnpj: string | null
          created_at: string | null
          cs_responsavel_id: string | null
          dados_nf: Json | null
          data_cancelamento: string | null
          data_fim_contrato: string | null
          data_inicio_contrato: string | null
          data_prevista_cancelamento: string | null
          data_primeiro_pagamento: string | null
          dia_vencimento: number | null
          email: string | null
          email_cobranca: string | null
          emitir_nf_automatica: boolean | null
          endereco: Json | null
          gerente_projeto_id: string | null
          grupos_whatsapp: Json | null
          id: string
          link_contrato: string | null
          links_uteis: Json | null
          motivo_cancelamento: string | null
          nome: string
          nome_aprovador_cliente: string | null
          onboarding: string | null
          public_token: string | null
          razao_social: string | null
          servicos_contratados: Json | null
          status_contrato: Database["public"]["Enums"]["status_contrato"] | null
          telefone: string | null
          telefone_cobranca: string | null
          tenant_id: string
          tipo_relacionamento:
            | Database["public"]["Enums"]["tipo_relacionamento"]
            | null
          updated_at: string | null
          valor_mensal: number | null
        }
        Insert: {
          aprovacao_padrao?:
            | Database["public"]["Enums"]["aprovacao_padrao"]
            | null
          asaas_customer_id?: string | null
          asaas_key_id?: string | null
          ativo?: boolean | null
          aviso_previo_dias?: number | null
          cnpj?: string | null
          created_at?: string | null
          cs_responsavel_id?: string | null
          dados_nf?: Json | null
          data_cancelamento?: string | null
          data_fim_contrato?: string | null
          data_inicio_contrato?: string | null
          data_prevista_cancelamento?: string | null
          data_primeiro_pagamento?: string | null
          dia_vencimento?: number | null
          email?: string | null
          email_cobranca?: string | null
          emitir_nf_automatica?: boolean | null
          endereco?: Json | null
          gerente_projeto_id?: string | null
          grupos_whatsapp?: Json | null
          id?: string
          link_contrato?: string | null
          links_uteis?: Json | null
          motivo_cancelamento?: string | null
          nome: string
          nome_aprovador_cliente?: string | null
          onboarding?: string | null
          public_token?: string | null
          razao_social?: string | null
          servicos_contratados?: Json | null
          status_contrato?:
            | Database["public"]["Enums"]["status_contrato"]
            | null
          telefone?: string | null
          telefone_cobranca?: string | null
          tenant_id: string
          tipo_relacionamento?:
            | Database["public"]["Enums"]["tipo_relacionamento"]
            | null
          updated_at?: string | null
          valor_mensal?: number | null
        }
        Update: {
          aprovacao_padrao?:
            | Database["public"]["Enums"]["aprovacao_padrao"]
            | null
          asaas_customer_id?: string | null
          asaas_key_id?: string | null
          ativo?: boolean | null
          aviso_previo_dias?: number | null
          cnpj?: string | null
          created_at?: string | null
          cs_responsavel_id?: string | null
          dados_nf?: Json | null
          data_cancelamento?: string | null
          data_fim_contrato?: string | null
          data_inicio_contrato?: string | null
          data_prevista_cancelamento?: string | null
          data_primeiro_pagamento?: string | null
          dia_vencimento?: number | null
          email?: string | null
          email_cobranca?: string | null
          emitir_nf_automatica?: boolean | null
          endereco?: Json | null
          gerente_projeto_id?: string | null
          grupos_whatsapp?: Json | null
          id?: string
          link_contrato?: string | null
          links_uteis?: Json | null
          motivo_cancelamento?: string | null
          nome?: string
          nome_aprovador_cliente?: string | null
          onboarding?: string | null
          public_token?: string | null
          razao_social?: string | null
          servicos_contratados?: Json | null
          status_contrato?:
            | Database["public"]["Enums"]["status_contrato"]
            | null
          telefone?: string | null
          telefone_cobranca?: string | null
          tenant_id?: string
          tipo_relacionamento?:
            | Database["public"]["Enums"]["tipo_relacionamento"]
            | null
          updated_at?: string | null
          valor_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_cs_responsavel_id_fkey"
            columns: ["cs_responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_gerente_projeto_id_fkey"
            columns: ["gerente_projeto_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cobrancas_enviadas: {
        Row: {
          asaas_charge_id: string | null
          asaas_invoice_id: string | null
          canal: string
          cliente_id: string | null
          created_at: string | null
          erro: string | null
          fatura_id: string | null
          id: string
          mensagem: string | null
          status: string | null
          tenant_id: string
          tipo: string
          transacao_id: string | null
          uazapi_message_id: string | null
        }
        Insert: {
          asaas_charge_id?: string | null
          asaas_invoice_id?: string | null
          canal: string
          cliente_id?: string | null
          created_at?: string | null
          erro?: string | null
          fatura_id?: string | null
          id?: string
          mensagem?: string | null
          status?: string | null
          tenant_id: string
          tipo: string
          transacao_id?: string | null
          uazapi_message_id?: string | null
        }
        Update: {
          asaas_charge_id?: string | null
          asaas_invoice_id?: string | null
          canal?: string
          cliente_id?: string | null
          created_at?: string | null
          erro?: string | null
          fatura_id?: string | null
          id?: string
          mensagem?: string | null
          status?: string | null
          tenant_id?: string
          tipo?: string
          transacao_id?: string | null
          uazapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_enviadas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_enviadas_fatura_id_fkey"
            columns: ["fatura_id"]
            isOneToOne: false
            referencedRelation: "faturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_enviadas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_enviadas_transacao_id_fkey"
            columns: ["transacao_id"]
            isOneToOne: false
            referencedRelation: "transacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      comentarios_tarefas: {
        Row: {
          autor_id: string
          conteudo: string
          created_at: string
          id: string
          mencoes_ids: string[] | null
          tarefa_id: string
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          autor_id: string
          conteudo: string
          created_at?: string
          id?: string
          mencoes_ids?: string[] | null
          tarefa_id: string
          tenant_id: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          autor_id?: string
          conteudo?: string
          created_at?: string
          id?: string
          mencoes_ids?: string[] | null
          tarefa_id?: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_tarefas_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_tarefas_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_tarefas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      comunicados_whatsapp: {
        Row: {
          completed_at: string | null
          created_at: string | null
          criado_por_id: string | null
          entregues: number | null
          enviados: number | null
          falhas: number | null
          filtro_destinatarios: Json | null
          id: string
          lidos: number | null
          mensagem: string
          status: string | null
          tenant_id: string
          titulo: string | null
          total_destinatarios: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          entregues?: number | null
          enviados?: number | null
          falhas?: number | null
          filtro_destinatarios?: Json | null
          id?: string
          lidos?: number | null
          mensagem: string
          status?: string | null
          tenant_id: string
          titulo?: string | null
          total_destinatarios?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          entregues?: number | null
          enviados?: number | null
          falhas?: number | null
          filtro_destinatarios?: Json | null
          id?: string
          lidos?: number | null
          mensagem?: string
          status?: string | null
          tenant_id?: string
          titulo?: string | null
          total_destinatarios?: number
        }
        Relationships: [
          {
            foreignKeyName: "comunicados_whatsapp_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_whatsapp_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      comunicados_whatsapp_itens: {
        Row: {
          cliente_id: string | null
          comunicado_id: string
          created_at: string | null
          erro: string | null
          id: string
          mensagem_id: string | null
          status: string | null
          telefone: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          cliente_id?: string | null
          comunicado_id: string
          created_at?: string | null
          erro?: string | null
          id?: string
          mensagem_id?: string | null
          status?: string | null
          telefone: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string | null
          comunicado_id?: string
          created_at?: string | null
          erro?: string | null
          id?: string
          mensagem_id?: string | null
          status?: string | null
          telefone?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicados_whatsapp_itens_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_whatsapp_itens_comunicado_id_fkey"
            columns: ["comunicado_id"]
            isOneToOne: false
            referencedRelation: "comunicados_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_whatsapp_itens_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_whatsapp_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos: {
        Row: {
          cliente_id: string
          created_at: string | null
          criado_por_id: string | null
          data_geracao: string | null
          data_upload_assinado: string | null
          id: string
          numero: string
          pdf_assinado_url: string | null
          pdf_gerado_url: string | null
          status: string | null
          template_id: string | null
          tenant_id: string
          titulo: string
          updated_at: string | null
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          criado_por_id?: string | null
          data_geracao?: string | null
          data_upload_assinado?: string | null
          id?: string
          numero: string
          pdf_assinado_url?: string | null
          pdf_gerado_url?: string | null
          status?: string | null
          template_id?: string | null
          tenant_id: string
          titulo: string
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          criado_por_id?: string | null
          data_geracao?: string | null
          data_upload_assinado?: string | null
          id?: string
          numero?: string
          pdf_assinado_url?: string | null
          pdf_gerado_url?: string | null
          status?: string | null
          template_id?: string | null
          tenant_id?: string
          titulo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contratos_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos_cliente: {
        Row: {
          ativo: boolean | null
          cliente_id: string
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          data_primeiro_pagamento: string | null
          dia_vencimento: number | null
          id: string
          nome: string
          observacoes: string | null
          servicos_contratados: Json | null
          status: Database["public"]["Enums"]["status_contrato"] | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_relacionamento"]
          updated_at: string | null
          valor_mensal: number | null
        }
        Insert: {
          ativo?: boolean | null
          cliente_id: string
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          data_primeiro_pagamento?: string | null
          dia_vencimento?: number | null
          id?: string
          nome: string
          observacoes?: string | null
          servicos_contratados?: Json | null
          status?: Database["public"]["Enums"]["status_contrato"] | null
          tenant_id: string
          tipo?: Database["public"]["Enums"]["tipo_relacionamento"]
          updated_at?: string | null
          valor_mensal?: number | null
        }
        Update: {
          ativo?: boolean | null
          cliente_id?: string
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          data_primeiro_pagamento?: string | null
          dia_vencimento?: number | null
          id?: string
          nome?: string
          observacoes?: string | null
          servicos_contratados?: Json | null
          status?: Database["public"]["Enums"]["status_contrato"] | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_relacionamento"]
          updated_at?: string | null
          valor_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_cliente_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_cliente_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos_templates: {
        Row: {
          ativo: boolean | null
          conteudo_html: string
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          conteudo_html: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          conteudo_html?: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      convites: {
        Row: {
          cargo: string | null
          convidado_por_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          tenant_id: string
          token: string
        }
        Insert: {
          cargo?: string | null
          convidado_por_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id: string
          token?: string
        }
        Update: {
          cargo?: string | null
          convidado_por_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "convites_convidado_por_id_fkey"
            columns: ["convidado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      demandas_templates: {
        Row: {
          ativo: boolean | null
          briefing_padrao: string | null
          cliente_id: string | null
          created_at: string | null
          criado_por_id: string | null
          descricao: string | null
          exige_aprovacao: boolean | null
          frente_id: string | null
          id: string
          links: Json | null
          nome: string
          prazo_dias: number | null
          responsaveis_secundarios_ids: string[] | null
          responsavel_principal_id: string | null
          subtarefas: Json | null
          tags_ids: string[] | null
          tenant_id: string
          tipo_aprovacao: string | null
          titulo_padrao: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          briefing_padrao?: string | null
          cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          descricao?: string | null
          exige_aprovacao?: boolean | null
          frente_id?: string | null
          id?: string
          links?: Json | null
          nome: string
          prazo_dias?: number | null
          responsaveis_secundarios_ids?: string[] | null
          responsavel_principal_id?: string | null
          subtarefas?: Json | null
          tags_ids?: string[] | null
          tenant_id: string
          tipo_aprovacao?: string | null
          titulo_padrao?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          briefing_padrao?: string | null
          cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          descricao?: string | null
          exige_aprovacao?: boolean | null
          frente_id?: string | null
          id?: string
          links?: Json | null
          nome?: string
          prazo_dias?: number | null
          responsaveis_secundarios_ids?: string[] | null
          responsavel_principal_id?: string | null
          subtarefas?: Json | null
          tags_ids?: string[] | null
          tenant_id?: string
          tipo_aprovacao?: string | null
          titulo_padrao?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demandas_templates_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandas_templates_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandas_templates_frente_id_fkey"
            columns: ["frente_id"]
            isOneToOne: false
            referencedRelation: "frentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandas_templates_responsavel_principal_id_fkey"
            columns: ["responsavel_principal_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandas_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          cliente_id: string | null
          cor: string
          created_at: string
          criador_id: string
          descricao: string | null
          fim: string
          google_event_id: string | null
          id: string
          inicio: string
          local: string | null
          participantes_ids: string[] | null
          recorrencia: Json | null
          tarefa_id: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at: string
        }
        Insert: {
          cliente_id?: string | null
          cor?: string
          created_at?: string
          criador_id: string
          descricao?: string | null
          fim: string
          google_event_id?: string | null
          id?: string
          inicio: string
          local?: string | null
          participantes_ids?: string[] | null
          recorrencia?: Json | null
          tarefa_id?: string | null
          tenant_id: string
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at?: string
        }
        Update: {
          cliente_id?: string | null
          cor?: string
          created_at?: string
          criador_id?: string
          descricao?: string | null
          fim?: string
          google_event_id?: string | null
          id?: string
          inicio?: string
          local?: string | null
          participantes_ids?: string[] | null
          recorrencia?: Json | null
          tarefa_id?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      faturas: {
        Row: {
          asaas_id: string | null
          cliente_id: string
          contrato_cliente_id: string | null
          created_at: string | null
          data_emissao: string
          data_pagamento: string | null
          data_vencimento: string
          id: string
          link_boleto: string | null
          link_pix: string | null
          nota_fiscal: string | null
          numero_fatura: string
          observacoes: string | null
          status: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id: string
          transacoes_ids: string[] | null
          valor_total: number
        }
        Insert: {
          asaas_id?: string | null
          cliente_id: string
          contrato_cliente_id?: string | null
          created_at?: string | null
          data_emissao: string
          data_pagamento?: string | null
          data_vencimento: string
          id?: string
          link_boleto?: string | null
          link_pix?: string | null
          nota_fiscal?: string | null
          numero_fatura: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id: string
          transacoes_ids?: string[] | null
          valor_total: number
        }
        Update: {
          asaas_id?: string | null
          cliente_id?: string
          contrato_cliente_id?: string | null
          created_at?: string | null
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento?: string
          id?: string
          link_boleto?: string | null
          link_pix?: string | null
          nota_fiscal?: string | null
          numero_fatura?: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id?: string
          transacoes_ids?: string[] | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "faturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_contrato_cliente_id_fkey"
            columns: ["contrato_cliente_id"]
            isOneToOne: false
            referencedRelation: "contratos_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      faturas_geracao_log: {
        Row: {
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string
          detalhes: Json | null
          id: string
          mensagem: string
          tenant_id: string
          tipo: string
        }
        Insert: {
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          detalhes?: Json | null
          id?: string
          mensagem: string
          tenant_id: string
          tipo?: string
        }
        Update: {
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          detalhes?: Json | null
          id?: string
          mensagem?: string
          tenant_id?: string
          tipo?: string
        }
        Relationships: []
      }
      frentes: {
        Row: {
          ativa: boolean | null
          cor: string | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          tenant_id: string
        }
        Insert: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          tenant_id: string
        }
        Update: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "frentes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          campos_extras: Json | null
          created_at: string | null
          data_fechamento: string | null
          data_ultimo_contato: string | null
          email: string | null
          empresa: string | null
          etapa_id: string | null
          fbclid: string | null
          gclid: string | null
          id: string
          meta_lead_id: string | null
          nome: string
          notas: string | null
          origem: Database["public"]["Enums"]["origem_lead"]
          origem_detalhe: Json | null
          responsavel_id: string | null
          tags: string[] | null
          telefone: string | null
          tenant_id: string
          updated_at: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          valor_estimado: number | null
          valor_fechado: number | null
        }
        Insert: {
          campos_extras?: Json | null
          created_at?: string | null
          data_fechamento?: string | null
          data_ultimo_contato?: string | null
          email?: string | null
          empresa?: string | null
          etapa_id?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          meta_lead_id?: string | null
          nome: string
          notas?: string | null
          origem?: Database["public"]["Enums"]["origem_lead"]
          origem_detalhe?: Json | null
          responsavel_id?: string | null
          tags?: string[] | null
          telefone?: string | null
          tenant_id: string
          updated_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_estimado?: number | null
          valor_fechado?: number | null
        }
        Update: {
          campos_extras?: Json | null
          created_at?: string | null
          data_fechamento?: string | null
          data_ultimo_contato?: string | null
          email?: string | null
          empresa?: string | null
          etapa_id?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          meta_lead_id?: string | null
          nome?: string
          notas?: string | null
          origem?: Database["public"]["Enums"]["origem_lead"]
          origem_detalhe?: Json | null
          responsavel_id?: string | null
          tags?: string[] | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_estimado?: number | null
          valor_fechado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "pipeline_etapas"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_config: {
        Row: {
          ai_agent_config: Json | null
          auto_criar_lead_whatsapp: boolean | null
          created_at: string | null
          google_ads_id: string | null
          google_tag_id: string | null
          id: string
          meta_access_token: string | null
          meta_old_page_token: string | null
          meta_page_access_token: string | null
          meta_pixel_id: string | null
          meta_subscribed_page_id: string | null
          meta_subscribed_page_name: string | null
          meta_verify_token: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          ai_agent_config?: Json | null
          auto_criar_lead_whatsapp?: boolean | null
          created_at?: string | null
          google_ads_id?: string | null
          google_tag_id?: string | null
          id?: string
          meta_access_token?: string | null
          meta_old_page_token?: string | null
          meta_page_access_token?: string | null
          meta_pixel_id?: string | null
          meta_subscribed_page_id?: string | null
          meta_subscribed_page_name?: string | null
          meta_verify_token?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          ai_agent_config?: Json | null
          auto_criar_lead_whatsapp?: boolean | null
          created_at?: string | null
          google_ads_id?: string | null
          google_tag_id?: string | null
          id?: string
          meta_access_token?: string | null
          meta_old_page_token?: string | null
          meta_page_access_token?: string | null
          meta_pixel_id?: string | null
          meta_subscribed_page_id?: string | null
          meta_subscribed_page_name?: string | null
          meta_verify_token?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      leads_interacoes: {
        Row: {
          conteudo: string | null
          created_at: string | null
          id: string
          lead_id: string | null
          metadados: Json | null
          tenant_id: string
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          conteudo?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          metadados?: Json | null
          tenant_id: string
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          conteudo?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          metadados?: Json | null
          tenant_id?: string
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_interacoes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      marcos_projeto: {
        Row: {
          cliente_id: string
          contrato_cliente_id: string | null
          created_at: string | null
          data_cobranca: string | null
          data_prevista: string | null
          descricao: string | null
          id: string
          status: Database["public"]["Enums"]["status_marco"] | null
          tenant_id: string
          titulo: string
          transacao_id: string | null
          updated_at: string | null
          valor: number
        }
        Insert: {
          cliente_id: string
          contrato_cliente_id?: string | null
          created_at?: string | null
          data_cobranca?: string | null
          data_prevista?: string | null
          descricao?: string | null
          id?: string
          status?: Database["public"]["Enums"]["status_marco"] | null
          tenant_id: string
          titulo: string
          transacao_id?: string | null
          updated_at?: string | null
          valor: number
        }
        Update: {
          cliente_id?: string
          contrato_cliente_id?: string | null
          created_at?: string | null
          data_cobranca?: string | null
          data_prevista?: string | null
          descricao?: string | null
          id?: string
          status?: Database["public"]["Enums"]["status_marco"] | null
          tenant_id?: string
          titulo?: string
          transacao_id?: string | null
          updated_at?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "marcos_projeto_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marcos_projeto_contrato_cliente_id_fkey"
            columns: ["contrato_cliente_id"]
            isOneToOne: false
            referencedRelation: "contratos_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marcos_projeto_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marcos_projeto_transacao_id_fkey"
            columns: ["transacao_id"]
            isOneToOne: false
            referencedRelation: "transacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens_whatsapp: {
        Row: {
          cliente_id: string | null
          created_at: string
          direcao: string
          id: string
          lida: boolean | null
          mensagem: string
          metadados: Json | null
          status: string | null
          telefone: string
          tenant_id: string
          tipo: string | null
          uazapi_message_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          direcao: string
          id?: string
          lida?: boolean | null
          mensagem: string
          metadados?: Json | null
          status?: string | null
          telefone: string
          tenant_id: string
          tipo?: string | null
          uazapi_message_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          direcao?: string
          id?: string
          lida?: boolean | null
          mensagem?: string
          metadados?: Json | null
          status?: string | null
          telefone?: string
          tenant_id?: string
          tipo?: string | null
          uazapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_whatsapp_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_whatsapp_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metas: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          descricao: string | null
          id: string
          membro_id: string | null
          metrica: string
          periodo_fim: string
          periodo_inicio: string
          tenant_id: string
          tipo: string
          titulo: string
          updated_at: string | null
          valor_atual: number | null
          valor_meta: number
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          membro_id?: string | null
          metrica: string
          periodo_fim: string
          periodo_inicio: string
          tenant_id: string
          tipo: string
          titulo: string
          updated_at?: string | null
          valor_atual?: number | null
          valor_meta: number
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          membro_id?: string | null
          metrica?: string
          periodo_fim?: string
          periodo_inicio?: string
          tenant_id?: string
          tipo?: string
          titulo?: string
          updated_at?: string | null
          valor_atual?: number | null
          valor_meta?: number
        }
        Relationships: [
          {
            foreignKeyName: "metas_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          link: string | null
          mensagem: string | null
          remetente_id: string | null
          tenant_id: string
          tipo: string
          titulo: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          link?: string | null
          mensagem?: string | null
          remetente_id?: string | null
          tenant_id: string
          tipo?: string
          titulo: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          link?: string | null
          mensagem?: string | null
          remetente_id?: string | null
          tenant_id?: string
          tipo?: string
          titulo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_remetente_id_fkey"
            columns: ["remetente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_equipe_enviadas: {
        Row: {
          created_at: string | null
          demanda_id: string | null
          erro: string | null
          id: string
          status: string | null
          subtarefa_id: string | null
          telefone: string
          tenant_id: string
          tipo: string
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          demanda_id?: string | null
          erro?: string | null
          id?: string
          status?: string | null
          subtarefa_id?: string | null
          telefone: string
          tenant_id: string
          tipo: string
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          demanda_id?: string | null
          erro?: string | null
          id?: string
          status?: string | null
          subtarefa_id?: string | null
          telefone?: string
          tenant_id?: string
          tipo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_equipe_enviadas_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_equipe_enviadas_subtarefa_id_fkey"
            columns: ["subtarefa_id"]
            isOneToOne: false
            referencedRelation: "subtarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_equipe_enviadas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_equipe_enviadas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offboarding: {
        Row: {
          aviso_previo_dias: number | null
          checklist: Json | null
          cliente_id: string
          created_at: string | null
          criado_por_id: string | null
          data_finalizacao: string | null
          data_inicio: string
          data_prevista_finalizacao: string | null
          detalhes_motivo: string | null
          feedback_cliente: string | null
          id: string
          ltv: number | null
          meses_ativo: number | null
          motivo_cancelamento: Database["public"]["Enums"]["motivo_cancelamento"]
          responsavel_id: string | null
          status: Database["public"]["Enums"]["status_offboarding"] | null
          tenant_id: string
          ticket_medio: number | null
          total_pago: number | null
          updated_at: string | null
        }
        Insert: {
          aviso_previo_dias?: number | null
          checklist?: Json | null
          cliente_id: string
          created_at?: string | null
          criado_por_id?: string | null
          data_finalizacao?: string | null
          data_inicio?: string
          data_prevista_finalizacao?: string | null
          detalhes_motivo?: string | null
          feedback_cliente?: string | null
          id?: string
          ltv?: number | null
          meses_ativo?: number | null
          motivo_cancelamento: Database["public"]["Enums"]["motivo_cancelamento"]
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["status_offboarding"] | null
          tenant_id: string
          ticket_medio?: number | null
          total_pago?: number | null
          updated_at?: string | null
        }
        Update: {
          aviso_previo_dias?: number | null
          checklist?: Json | null
          cliente_id?: string
          created_at?: string | null
          criado_por_id?: string | null
          data_finalizacao?: string | null
          data_inicio?: string
          data_prevista_finalizacao?: string | null
          detalhes_motivo?: string | null
          feedback_cliente?: string | null
          id?: string
          ltv?: number | null
          meses_ativo?: number | null
          motivo_cancelamento?: Database["public"]["Enums"]["motivo_cancelamento"]
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["status_offboarding"] | null
          tenant_id?: string
          ticket_medio?: number | null
          total_pago?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offboarding_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offboarding_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offboarding_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offboarding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_etapas: {
        Row: {
          ativa: boolean | null
          cor: string | null
          created_at: string | null
          id: string
          is_ganho: boolean | null
          is_perdido: boolean | null
          nome: string
          ordem: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          id?: string
          is_ganho?: boolean | null
          is_perdido?: boolean | null
          nome: string
          ordem?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          ativa?: boolean | null
          cor?: string | null
          created_at?: string | null
          id?: string
          is_ganho?: boolean | null
          is_perdido?: boolean | null
          nome?: string
          ordem?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      playbooks: {
        Row: {
          conteudo: string | null
          created_at: string | null
          criado_por_id: string | null
          icone: string | null
          id: string
          ordem: number | null
          parent_id: string | null
          tenant_id: string
          tipo: string
          titulo: string
          updated_at: string | null
        }
        Insert: {
          conteudo?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          icone?: string | null
          id?: string
          ordem?: number | null
          parent_id?: string | null
          tenant_id: string
          tipo: string
          titulo: string
          updated_at?: string | null
        }
        Update: {
          conteudo?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          icone?: string | null
          id?: string
          ordem?: number | null
          parent_id?: string | null
          tenant_id?: string
          tipo?: string
          titulo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playbooks_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbooks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean | null
          avatar_url: string | null
          cargo: string | null
          created_at: string | null
          email: string
          id: string
          nome: string
          receber_notificacoes_whatsapp: boolean | null
          telefone: string | null
          tenant_id: string | null
          tenant_id_ativo: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string | null
          email: string
          id: string
          nome: string
          receber_notificacoes_whatsapp?: boolean | null
          telefone?: string | null
          tenant_id?: string | null
          tenant_id_ativo?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string | null
          email?: string
          id?: string
          nome?: string
          receber_notificacoes_whatsapp?: boolean | null
          telefone?: string | null
          tenant_id?: string | null
          tenant_id_ativo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_ativo_fkey"
            columns: ["tenant_id_ativo"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      servicos: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number | null
          tenant_id: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number | null
          tenant_id: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subtarefas: {
        Row: {
          concluida: boolean | null
          concluida_por_id: string | null
          created_at: string | null
          data_conclusao: string | null
          data_fim_execucao: string | null
          data_inicio_execucao: string | null
          descricao: string | null
          id: string
          ordem: number | null
          prazo_entrega: string | null
          responsavel_id: string | null
          status: string | null
          tarefa_id: string
          tempo_total_segundos: number | null
          tenant_id: string
          titulo: string
          updated_at: string | null
        }
        Insert: {
          concluida?: boolean | null
          concluida_por_id?: string | null
          created_at?: string | null
          data_conclusao?: string | null
          data_fim_execucao?: string | null
          data_inicio_execucao?: string | null
          descricao?: string | null
          id?: string
          ordem?: number | null
          prazo_entrega?: string | null
          responsavel_id?: string | null
          status?: string | null
          tarefa_id: string
          tempo_total_segundos?: number | null
          tenant_id: string
          titulo: string
          updated_at?: string | null
        }
        Update: {
          concluida?: boolean | null
          concluida_por_id?: string | null
          created_at?: string | null
          data_conclusao?: string | null
          data_fim_execucao?: string | null
          data_inicio_execucao?: string | null
          descricao?: string | null
          id?: string
          ordem?: number | null
          prazo_entrega?: string | null
          responsavel_id?: string | null
          status?: string | null
          tarefa_id?: string
          tempo_total_segundos?: number | null
          tenant_id?: string
          titulo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subtarefas_concluida_por_id_fkey"
            columns: ["concluida_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtarefas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtarefas_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtarefas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_primary: boolean | null
          last_login: string | null
          mfa_enabled: boolean | null
          mfa_verified_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_primary?: boolean | null
          last_login?: string | null
          mfa_enabled?: boolean | null
          mfa_verified_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_primary?: boolean | null
          last_login?: string | null
          mfa_enabled?: boolean | null
          mfa_verified_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_config: {
        Row: {
          description: string | null
          encrypted: boolean | null
          id: string
          key: string
          updated_at: string | null
          updated_by: string | null
          value: string
        }
        Insert: {
          description?: string | null
          encrypted?: boolean | null
          id?: string
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: string
        }
        Update: {
          description?: string | null
          encrypted?: boolean | null
          id?: string
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      tags_demandas: {
        Row: {
          ativa: boolean
          cor: string
          created_at: string
          id: string
          nome: string
          ordem: number
          tenant_id: string
        }
        Insert: {
          ativa?: boolean
          cor?: string
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          tenant_id: string
        }
        Update: {
          ativa?: boolean
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_demandas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          ativa_recorrencia: boolean | null
          atrasada: boolean | null
          checklist: Json | null
          cliente_id: string | null
          created_at: string | null
          criado_por_id: string | null
          data_fim_execucao: string | null
          data_inicio_execucao: string | null
          descricao: string | null
          dias_atraso: number | null
          exige_aprovacao: boolean | null
          frente_id: string | null
          frequencia_recorrencia:
            | Database["public"]["Enums"]["frequencia_recorrencia_tarefa"]
            | null
          id: string
          intervalo_dias: number | null
          links_entrega: Json | null
          origem: Database["public"]["Enums"]["origem_tarefa"] | null
          prazo_entrega: string | null
          proxima_geracao: string | null
          proximo_responsavel_id: string | null
          recorrente: boolean | null
          responsaveis_secundarios_ids: string[] | null
          responsavel_principal_id: string | null
          status: Database["public"]["Enums"]["status_tarefa"] | null
          tags_ids: string[] | null
          tarefa_template_id: string | null
          tempo_total_segundos: number | null
          tenant_id: string
          tipo_aprovacao: Database["public"]["Enums"]["aprovacao_padrao"] | null
          titulo: string
          updated_at: string | null
        }
        Insert: {
          ativa_recorrencia?: boolean | null
          atrasada?: boolean | null
          checklist?: Json | null
          cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          data_fim_execucao?: string | null
          data_inicio_execucao?: string | null
          descricao?: string | null
          dias_atraso?: number | null
          exige_aprovacao?: boolean | null
          frente_id?: string | null
          frequencia_recorrencia?:
            | Database["public"]["Enums"]["frequencia_recorrencia_tarefa"]
            | null
          id?: string
          intervalo_dias?: number | null
          links_entrega?: Json | null
          origem?: Database["public"]["Enums"]["origem_tarefa"] | null
          prazo_entrega?: string | null
          proxima_geracao?: string | null
          proximo_responsavel_id?: string | null
          recorrente?: boolean | null
          responsaveis_secundarios_ids?: string[] | null
          responsavel_principal_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"] | null
          tags_ids?: string[] | null
          tarefa_template_id?: string | null
          tempo_total_segundos?: number | null
          tenant_id: string
          tipo_aprovacao?:
            | Database["public"]["Enums"]["aprovacao_padrao"]
            | null
          titulo: string
          updated_at?: string | null
        }
        Update: {
          ativa_recorrencia?: boolean | null
          atrasada?: boolean | null
          checklist?: Json | null
          cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          data_fim_execucao?: string | null
          data_inicio_execucao?: string | null
          descricao?: string | null
          dias_atraso?: number | null
          exige_aprovacao?: boolean | null
          frente_id?: string | null
          frequencia_recorrencia?:
            | Database["public"]["Enums"]["frequencia_recorrencia_tarefa"]
            | null
          id?: string
          intervalo_dias?: number | null
          links_entrega?: Json | null
          origem?: Database["public"]["Enums"]["origem_tarefa"] | null
          prazo_entrega?: string | null
          proxima_geracao?: string | null
          proximo_responsavel_id?: string | null
          recorrente?: boolean | null
          responsaveis_secundarios_ids?: string[] | null
          responsavel_principal_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"] | null
          tags_ids?: string[] | null
          tarefa_template_id?: string | null
          tempo_total_segundos?: number | null
          tenant_id?: string
          tipo_aprovacao?:
            | Database["public"]["Enums"]["aprovacao_padrao"]
            | null
          titulo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_frente_id_fkey"
            columns: ["frente_id"]
            isOneToOne: false
            referencedRelation: "frentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_proximo_responsavel_id_fkey"
            columns: ["proximo_responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_responsavel_principal_id_fkey"
            columns: ["responsavel_principal_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_tarefa_template_id_fkey"
            columns: ["tarefa_template_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas_historico: {
        Row: {
          campo_alterado: string | null
          created_at: string
          descricao: string | null
          id: string
          tarefa_id: string
          tenant_id: string
          tipo_alteracao: string
          usuario_id: string | null
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          campo_alterado?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          tarefa_id: string
          tenant_id: string
          tipo_alteracao: string
          usuario_id?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          campo_alterado?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          tarefa_id?: string
          tenant_id?: string
          tipo_alteracao?: string
          usuario_id?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_historico_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_historico_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_historico_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ativo: boolean | null
          configuracoes: Json | null
          created_at: string | null
          descricao: string | null
          email_admin: string
          id: string
          limite_clientes: number | null
          limite_usuarios: number | null
          nome: string
          plano: Database["public"]["Enums"]["plano_assinatura"] | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          configuracoes?: Json | null
          created_at?: string | null
          descricao?: string | null
          email_admin: string
          id?: string
          limite_clientes?: number | null
          limite_usuarios?: number | null
          nome: string
          plano?: Database["public"]["Enums"]["plano_assinatura"] | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          configuracoes?: Json | null
          created_at?: string | null
          descricao?: string | null
          email_admin?: string
          id?: string
          limite_clientes?: number | null
          limite_usuarios?: number | null
          nome?: string
          plano?: Database["public"]["Enums"]["plano_assinatura"] | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transacoes: {
        Row: {
          asaas_id: string | null
          categoria_id: string | null
          centro_custo_id: string | null
          cliente_id: string | null
          comprovante: string | null
          contrato_cliente_id: string | null
          created_at: string | null
          criado_por_id: string | null
          data_fim_recorrencia: string | null
          data_pagamento: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          frequencia_recorrencia: string | null
          id: string
          observacoes: string | null
          recorrente: boolean | null
          status: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_transacao"]
          updated_at: string | null
          valor: number
        }
        Insert: {
          asaas_id?: string | null
          categoria_id?: string | null
          centro_custo_id?: string | null
          cliente_id?: string | null
          comprovante?: string | null
          contrato_cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          data_fim_recorrencia?: string | null
          data_pagamento?: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frequencia_recorrencia?: string | null
          id?: string
          observacoes?: string | null
          recorrente?: boolean | null
          status?: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_transacao"]
          updated_at?: string | null
          valor: number
        }
        Update: {
          asaas_id?: string | null
          categoria_id?: string | null
          centro_custo_id?: string | null
          cliente_id?: string | null
          comprovante?: string | null
          contrato_cliente_id?: string | null
          created_at?: string | null
          criado_por_id?: string | null
          data_fim_recorrencia?: string | null
          data_pagamento?: string | null
          data_vencimento?: string
          descricao?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frequencia_recorrencia?: string | null
          id?: string
          observacoes?: string | null
          recorrente?: boolean | null
          status?: Database["public"]["Enums"]["status_pagamento"] | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_transacao"]
          updated_at?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_financeiras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_contrato_cliente_id_fkey"
            columns: ["contrato_cliente_id"]
            isOneToOne: false
            referencedRelation: "contratos_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string | null
          id: string
          pode_concluir_demandas_outros: boolean | null
          pode_excluir_demandas_outros: boolean | null
          tenant_id: string
          updated_at: string | null
          user_id: string
          ver_agenda: boolean | null
          ver_chat: boolean | null
          ver_clientes: boolean | null
          ver_comercial: boolean | null
          ver_configuracoes: boolean | null
          ver_contratos: boolean | null
          ver_dashboard: boolean | null
          ver_equipe: boolean | null
          ver_financeiro: boolean | null
          ver_frentes: boolean | null
          ver_offboarding: boolean | null
          ver_onboarding: boolean | null
          ver_playbooks: boolean | null
          ver_relatorios: boolean | null
          ver_somente_proprias_demandas: boolean | null
          ver_timesheet: boolean | null
          ver_todas_demandas: boolean | null
          ver_whatsapp: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          pode_concluir_demandas_outros?: boolean | null
          pode_excluir_demandas_outros?: boolean | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
          ver_agenda?: boolean | null
          ver_chat?: boolean | null
          ver_clientes?: boolean | null
          ver_comercial?: boolean | null
          ver_configuracoes?: boolean | null
          ver_contratos?: boolean | null
          ver_dashboard?: boolean | null
          ver_equipe?: boolean | null
          ver_financeiro?: boolean | null
          ver_frentes?: boolean | null
          ver_offboarding?: boolean | null
          ver_onboarding?: boolean | null
          ver_playbooks?: boolean | null
          ver_relatorios?: boolean | null
          ver_somente_proprias_demandas?: boolean | null
          ver_timesheet?: boolean | null
          ver_todas_demandas?: boolean | null
          ver_whatsapp?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          pode_concluir_demandas_outros?: boolean | null
          pode_excluir_demandas_outros?: boolean | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
          ver_agenda?: boolean | null
          ver_chat?: boolean | null
          ver_clientes?: boolean | null
          ver_comercial?: boolean | null
          ver_configuracoes?: boolean | null
          ver_contratos?: boolean | null
          ver_dashboard?: boolean | null
          ver_equipe?: boolean | null
          ver_financeiro?: boolean | null
          ver_frentes?: boolean | null
          ver_offboarding?: boolean | null
          ver_onboarding?: boolean | null
          ver_playbooks?: boolean | null
          ver_relatorios?: boolean | null
          ver_somente_proprias_demandas?: boolean | null
          ver_timesheet?: boolean | null
          ver_todas_demandas?: boolean | null
          ver_whatsapp?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string
          evento: string | null
          id: string
          ip_origem: string | null
          mensagem_erro: string | null
          payload: Json | null
          status: string
          tenant_id: string
          tipo: string
        }
        Insert: {
          created_at?: string
          evento?: string | null
          id?: string
          ip_origem?: string | null
          mensagem_erro?: string | null
          payload?: Json | null
          status?: string
          tenant_id: string
          tipo: string
        }
        Update: {
          created_at?: string
          evento?: string | null
          id?: string
          ip_origem?: string | null
          mensagem_erro?: string | null
          payload?: Json | null
          status?: string
          tenant_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_grupos_permitidos: {
        Row: {
          ativo: boolean
          created_at: string
          group_image_url: string | null
          group_jid: string
          group_name: string | null
          id: string
          tenant_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          group_image_url?: string | null
          group_jid: string
          group_name?: string | null
          id?: string
          tenant_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          group_image_url?: string | null
          group_jid?: string
          group_name?: string | null
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_grupos_permitidos_tenant_id_fkey"
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
      aceitar_convite: {
        Args: { p_token: string; p_user_id: string }
        Returns: Json
      }
      adicionar_membro_por_email: {
        Args: {
          p_cargo?: string
          p_email: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: Json
      }
      check_user_permission: {
        Args: { p_permission: string; p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      clean_old_faturas_log: { Args: never; Returns: undefined }
      criar_pipeline_padrao: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      delete_cliente_cascade: {
        Args: { p_cliente_id: string }
        Returns: undefined
      }
      delete_tenant_cascade: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      get_user_permissions: { Args: { p_user_id?: string }; Returns: Json }
      get_user_tenant_id: { Args: never; Returns: string }
      get_user_tenants: {
        Args: never
        Returns: {
          id: string
          is_current: boolean
          nome: string
          slug: string
        }[]
      }
      has_permission: { Args: { _permission: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_chat_participant: { Args: { _canal_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      limpar_mensagens_whatsapp_antigas: { Args: never; Returns: number }
      limpar_webhook_logs_antigos: { Args: never; Returns: number }
      set_user_admin_status: {
        Args: { p_is_admin: boolean; p_user_id: string }
        Returns: Json
      }
      switch_tenant: { Args: { p_tenant_id: string }; Returns: boolean }
      upsert_user_permissions: {
        Args: { p_permissions: Json; p_user_id: string }
        Returns: undefined
      }
      validar_convite: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "gerente" | "cs" | "executor" | "visualizador"
      aprovacao_padrao: "agencia" | "cliente"
      forma_pagamento: "pix" | "boleto" | "cartao" | "transferencia"
      frequencia_recorrencia_tarefa:
        | "diaria"
        | "semanal"
        | "quinzenal"
        | "mensal"
        | "personalizada"
      motivo_cancelamento:
        | "insatisfacao_servico"
        | "problemas_financeiros"
        | "mudanca_estrategia"
        | "concorrencia"
        | "fechou_empresa"
        | "reducao_equipe"
        | "internalizou_servico"
        | "outro"
      origem_lead:
        | "meta_ads"
        | "formulario"
        | "whatsapp"
        | "manual"
        | "indicacao"
        | "site"
      origem_tarefa: "interna" | "cliente" | "webhook"
      plano_assinatura: "starter" | "professional" | "enterprise"
      status_contrato:
        | "ativo"
        | "inadimplente"
        | "cancelado"
        | "em_pausa"
        | "em_cancelamento"
      status_marco: "pendente" | "concluido" | "cobrado" | "pago"
      status_offboarding: "em_andamento" | "concluido" | "cancelado"
      status_pagamento: "pendente" | "pago" | "atrasado" | "cancelado"
      status_tarefa:
        | "nao_iniciada"
        | "em_producao"
        | "em_pausa"
        | "aguardando_aprovacao"
        | "em_ajustes"
        | "entregue"
        | "arquivada"
      tipo_acompanhamento:
        | "reuniao"
        | "ligacao"
        | "email"
        | "nota"
        | "follow_up"
      tipo_canal_chat: "direto" | "grupo"
      tipo_evento: "reuniao" | "tarefa" | "lembrete" | "outro"
      tipo_relacionamento: "contrato" | "projeto"
      tipo_transacao: "receita" | "despesa"
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
      app_role: ["admin", "gerente", "cs", "executor", "visualizador"],
      aprovacao_padrao: ["agencia", "cliente"],
      forma_pagamento: ["pix", "boleto", "cartao", "transferencia"],
      frequencia_recorrencia_tarefa: [
        "diaria",
        "semanal",
        "quinzenal",
        "mensal",
        "personalizada",
      ],
      motivo_cancelamento: [
        "insatisfacao_servico",
        "problemas_financeiros",
        "mudanca_estrategia",
        "concorrencia",
        "fechou_empresa",
        "reducao_equipe",
        "internalizou_servico",
        "outro",
      ],
      origem_lead: [
        "meta_ads",
        "formulario",
        "whatsapp",
        "manual",
        "indicacao",
        "site",
      ],
      origem_tarefa: ["interna", "cliente", "webhook"],
      plano_assinatura: ["starter", "professional", "enterprise"],
      status_contrato: [
        "ativo",
        "inadimplente",
        "cancelado",
        "em_pausa",
        "em_cancelamento",
      ],
      status_marco: ["pendente", "concluido", "cobrado", "pago"],
      status_offboarding: ["em_andamento", "concluido", "cancelado"],
      status_pagamento: ["pendente", "pago", "atrasado", "cancelado"],
      status_tarefa: [
        "nao_iniciada",
        "em_producao",
        "em_pausa",
        "aguardando_aprovacao",
        "em_ajustes",
        "entregue",
        "arquivada",
      ],
      tipo_acompanhamento: ["reuniao", "ligacao", "email", "nota", "follow_up"],
      tipo_canal_chat: ["direto", "grupo"],
      tipo_evento: ["reuniao", "tarefa", "lembrete", "outro"],
      tipo_relacionamento: ["contrato", "projeto"],
      tipo_transacao: ["receita", "despesa"],
    },
  },
} as const
