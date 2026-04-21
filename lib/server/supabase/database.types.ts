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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      client_access_tokens: {
        Row: {
          client_email: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          latest_update_date: string | null
          latest_update_next_step: string | null
          latest_update_text: string | null
          lead_id: string | null
          project_id: string
          token: string
        }
        Insert: {
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          latest_update_date?: string | null
          latest_update_next_step?: string | null
          latest_update_text?: string | null
          lead_id?: string | null
          project_id: string
          token?: string
        }
        Update: {
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          latest_update_date?: string | null
          latest_update_next_step?: string | null
          latest_update_text?: string | null
          lead_id?: string | null
          project_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_access_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_access_tokens_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_access_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          token_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          token_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_comments_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "client_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_ledger: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["earning_actor_role"]
          amount: number
          created_at: string
          credited_at: string
          currency: string
          earning_type: Database["public"]["Enums"]["earning_type"]
          id: string
          lead_id: string | null
          notes: string | null
          paid_out_at: string | null
          payment_id: string | null
          proposal_id: string | null
          status: Database["public"]["Enums"]["earning_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_role: Database["public"]["Enums"]["earning_actor_role"]
          amount: number
          created_at?: string
          credited_at?: string
          currency?: string
          earning_type: Database["public"]["Enums"]["earning_type"]
          id?: string
          lead_id?: string | null
          notes?: string | null
          paid_out_at?: string | null
          payment_id?: string | null
          proposal_id?: string | null
          status?: Database["public"]["Enums"]["earning_status"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["earning_actor_role"]
          amount?: number
          created_at?: string
          credited_at?: string
          currency?: string
          earning_type?: Database["public"]["Enums"]["earning_type"]
          id?: string
          lead_id?: string | null
          notes?: string | null
          paid_out_at?: string | null
          payment_id?: string | null
          proposal_id?: string | null
          status?: Database["public"]["Enums"]["earning_status"]
        }
        Relationships: [
          {
            foreignKeyName: "earnings_ledger_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_ledger_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_ledger_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "lead_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["lead_activity_type"]
          actor_profile_id: string | null
          created_at: string
          id: string
          lead_id: string
          metadata: Json
          note_body: string | null
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["lead_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          metadata?: Json
          note_body?: string | null
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["lead_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          metadata?: Json
          note_body?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_proposals: {
        Row: {
          accepted_at: string | null
          amount: number
          body: string
          created_at: string
          created_by: string
          currency: string
          expires_at: string | null
          first_opened_at: string | null
          handoff_ready_at: string | null
          id: string
          is_special_case: boolean
          lead_id: string
          paid_at: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          review_status: Database["public"]["Enums"]["proposal_review_status"]
          reviewed_at: string | null
          reviewer_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          superseded_by: string | null
          title: string
          updated_at: string
          version_number: number
        }
        Insert: {
          accepted_at?: string | null
          amount?: number
          body: string
          created_at?: string
          created_by: string
          currency?: string
          expires_at?: string | null
          first_opened_at?: string | null
          handoff_ready_at?: string | null
          id?: string
          is_special_case?: boolean
          lead_id: string
          paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          review_status?: Database["public"]["Enums"]["proposal_review_status"]
          reviewed_at?: string | null
          reviewer_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          superseded_by?: string | null
          title: string
          updated_at?: string
          version_number?: number
        }
        Update: {
          accepted_at?: string | null
          amount?: number
          body?: string
          created_at?: string
          created_by?: string
          currency?: string
          expires_at?: string | null
          first_opened_at?: string | null
          handoff_ready_at?: string | null
          id?: string
          is_special_case?: boolean
          lead_id?: string
          paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          review_status?: Database["public"]["Enums"]["proposal_review_status"]
          reviewed_at?: string | null
          reviewer_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          superseded_by?: string | null
          title?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_proposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_proposals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_proposals_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_proposals_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "lead_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          assignment_status: Database["public"]["Enums"]["lead_assignment_status"]
          company: string | null
          created_at: string
          created_by: string
          email: string
          id: string
          last_contacted_at: string | null
          latitude: number | null
          lead_origin: Database["public"]["Enums"]["lead_origin"] | null
          legacy_mock_id: string | null
          location_text: string | null
          locked_at: string | null
          locked_by_proposal_id: string | null
          longitude: number | null
          name: string
          next_follow_up_at: string | null
          notes: string | null
          phone: string | null
          released_at: string | null
          score: number
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          tags: string[]
          updated_at: string
          value: number
          whatsapp: string | null
          auto_followup_enabled: boolean
        }
        Insert: {
          assigned_to?: string | null
          assignment_status?: Database["public"]["Enums"]["lead_assignment_status"]
          company?: string | null
          created_at?: string
          created_by: string
          email: string
          id?: string
          last_contacted_at?: string | null
          latitude?: number | null
          lead_origin?: Database["public"]["Enums"]["lead_origin"] | null
          legacy_mock_id?: string | null
          location_text?: string | null
          locked_at?: string | null
          locked_by_proposal_id?: string | null
          longitude?: number | null
          name: string
          next_follow_up_at?: string | null
          notes?: string | null
          phone?: string | null
          released_at?: string | null
          score: number
          source: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
          value?: number
          whatsapp?: string | null
          auto_followup_enabled?: boolean
        }
        Update: {
          assigned_to?: string | null
          assignment_status?: Database["public"]["Enums"]["lead_assignment_status"]
          company?: string | null
          created_at?: string
          created_by?: string
          email?: string
          id?: string
          last_contacted_at?: string | null
          latitude?: number | null
          lead_origin?: Database["public"]["Enums"]["lead_origin"] | null
          legacy_mock_id?: string | null
          location_text?: string | null
          locked_at?: string | null
          locked_by_proposal_id?: string | null
          longitude?: number | null
          name?: string
          next_follow_up_at?: string | null
          notes?: string | null
          phone?: string | null
          released_at?: string | null
          score?: number
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
          value?: number
          whatsapp?: string | null
          auto_followup_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_locked_by_proposal_id_fkey"
            columns: ["locked_by_proposal_id"]
            isOneToOne: false
            referencedRelation: "lead_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          paid_at: string | null
          payment_type: Database["public"]["Enums"]["payment_type"]
          project_id: string | null
          proposal_id: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_type?: Database["public"]["Enums"]["payment_type"]
          project_id?: string | null
          proposal_id: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_type?: Database["public"]["Enums"]["payment_type"]
          project_id?: string | null
          proposal_id?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "lead_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          currency: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["batch_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["batch_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["batch_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_batches_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_methods: {
        Row: {
          created_at: string
          details: Json
          id: string
          is_active: boolean
          is_primary: boolean
          label: string
          method_type: Database["public"]["Enums"]["payout_method_type"]
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label: string
          method_type: Database["public"]["Enums"]["payout_method_type"]
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string
          method_type?: Database["public"]["Enums"]["payout_method_type"]
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_methods_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          batch_id: string
          created_at: string
          currency: string
          external_reference: string | null
          id: string
          metadata: Json
          payout_method_id: string | null
          profile_id: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          batch_id: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          metadata?: Json
          payout_method_id?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          batch_id?: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          metadata?: Json
          payout_method_id?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_payout_method_id_fkey"
            columns: ["payout_method_id"]
            isOneToOne: false
            referencedRelation: "payout_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      point_redemptions: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          item_id: string
          points_used: number
          status: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          item_id: string
          points_used: number
          status?: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          item_id?: string
          points_used?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_redemptions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "reward_store_items"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          actor_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["points_event_type"]
          id: string
          notes: string | null
          points: number
          reference_id: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_type: Database["public"]["Enums"]["points_event_type"]
          id?: string
          notes?: string | null
          points: number
          reference_id?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["points_event_type"]
          id?: string
          notes?: string | null
          points?: number
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["project_activity_type"]
          actor_profile_id: string | null
          created_at: string
          id: string
          metadata: Json
          project_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["project_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          project_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["project_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activities_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number
          client_name: string
          created_at: string
          created_by: string
          description: string | null
          developer_user_id: string | null
          end_date: string | null
          handoff_ready_at: string | null
          id: string
          name: string
          payment_activated: boolean
          payment_activated_at: string | null
          pm_legacy_user_id: string | null
          source_lead_id: string | null
          source_proposal_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          team_legacy_user_ids: string[]
          updated_at: string
        }
        Insert: {
          budget?: number
          client_name: string
          created_at?: string
          created_by: string
          description?: string | null
          developer_user_id?: string | null
          end_date?: string | null
          handoff_ready_at?: string | null
          id?: string
          name: string
          payment_activated?: boolean
          payment_activated_at?: string | null
          pm_legacy_user_id?: string | null
          source_lead_id?: string | null
          source_proposal_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          team_legacy_user_ids?: string[]
          updated_at?: string
        }
        Update: {
          budget?: number
          client_name?: string
          created_at?: string
          created_by?: string
          description?: string | null
          developer_user_id?: string | null
          end_date?: string | null
          handoff_ready_at?: string | null
          id?: string
          name?: string
          payment_activated?: boolean
          payment_activated_at?: string | null
          pm_legacy_user_id?: string | null
          source_lead_id?: string | null
          source_proposal_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          team_legacy_user_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_developer_user_id_fkey"
            columns: ["developer_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_proposal_id_fkey"
            columns: ["source_proposal_id"]
            isOneToOne: true
            referencedRelation: "lead_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      prototype_credit_settings: {
        Row: {
          created_at: string
          request_cost: number
          singleton_key: boolean
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          created_at?: string
          request_cost: number
          singleton_key?: boolean
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          created_at?: string
          request_cost?: number
          singleton_key?: boolean
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prototype_credit_settings_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prototype_workspaces: {
        Row: {
          created_at: string
          current_stage: Database["public"]["Enums"]["prototype_stage"]
          generated_at: string | null
          generated_content: string | null
          generation_prompt: string | null
          id: string
          last_operation_id: string | null
          lead_id: string
          project_id: string | null
          requested_by_profile_id: string
          status: Database["public"]["Enums"]["prototype_workspace_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_stage?: Database["public"]["Enums"]["prototype_stage"]
          generated_at?: string | null
          generated_content?: string | null
          generation_prompt?: string | null
          id?: string
          last_operation_id?: string | null
          lead_id: string
          project_id?: string | null
          requested_by_profile_id: string
          status?: Database["public"]["Enums"]["prototype_workspace_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_stage?: Database["public"]["Enums"]["prototype_stage"]
          generated_at?: string | null
          generated_content?: string | null
          generation_prompt?: string | null
          id?: string
          last_operation_id?: string | null
          lead_id?: string
          project_id?: string | null
          requested_by_profile_id?: string
          status?: Database["public"]["Enums"]["prototype_workspace_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prototype_workspaces_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prototype_workspaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prototype_workspaces_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          processing_status: Database["public"]["Enums"]["provider_event_status"]
          provider: Database["public"]["Enums"]["provider_name"]
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["provider_event_status"]
          provider: Database["public"]["Enums"]["provider_name"]
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["provider_event_status"]
          provider?: Database["public"]["Enums"]["provider_name"]
        }
        Relationships: []
      }
      reward_store_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          points_cost: number
          stock: number | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          points_cost: number
          stock?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          points_cost?: number
          stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          lead_id: string
          name: string | null
          stripe_customer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          lead_id: string
          name?: string | null
          stripe_customer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          lead_id?: string
          name?: string | null
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["task_activity_type"]
          actor_profile_id: string | null
          created_at: string
          id: string
          metadata: Json
          note_body: string | null
          task_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["task_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note_body?: string | null
          task_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["task_activity_type"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note_body?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activities_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_hours: number | null
          assigned_legacy_user_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          actual_hours?: number | null
          assigned_legacy_user_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          actual_hours?: number | null
          assigned_legacy_user_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_legacy_user_id_fkey"
            columns: ["assigned_legacy_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["legacy_mock_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string
          created_at: string
          domain: string
          href: string
          id: string
          is_read: boolean
          profile_id: string
          read_at: string | null
          source_event_id: string
          source_kind: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          domain: string
          href: string
          id?: string
          is_read?: boolean
          profile_id: string
          read_at?: string | null
          source_event_id: string
          source_kind: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          domain?: string
          href?: string
          id?: string
          is_read?: boolean
          profile_id?: string
          read_at?: string | null
          source_event_id?: string
          source_kind?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          legacy_mock_id: string | null
          locale: string
          notification_preferences: Json
          role: Database["public"]["Enums"]["user_role"]
          stripe_connect_account_id: string | null
          stripe_connect_status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          legacy_mock_id?: string | null
          locale?: string
          notification_preferences?: Json
          role: Database["public"]["Enums"]["user_role"]
          stripe_connect_account_id?: string | null
          stripe_connect_status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          legacy_mock_id?: string | null
          locale?: string
          notification_preferences?: Json
          role?: Database["public"]["Enums"]["user_role"]
          stripe_connect_account_id?: string | null
          stripe_connect_status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_wallet_entries: {
        Row: {
          actor_profile_id: string | null
          bucket: Database["public"]["Enums"]["wallet_bucket"]
          created_at: string
          delta_credits: number
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id: string
          lead_id: string | null
          metadata: Json
          operation_id: string
          profile_id: string
          prototype_workspace_id: string | null
        }
        Insert: {
          actor_profile_id?: string | null
          bucket: Database["public"]["Enums"]["wallet_bucket"]
          created_at?: string
          delta_credits: number
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          lead_id?: string | null
          metadata?: Json
          operation_id: string
          profile_id: string
          prototype_workspace_id?: string | null
        }
        Update: {
          actor_profile_id?: string | null
          bucket?: Database["public"]["Enums"]["wallet_bucket"]
          created_at?: string
          delta_credits?: number
          entry_type?: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          lead_id?: string | null
          metadata?: Json
          operation_id?: string
          profile_id?: string
          prototype_workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_wallet_entries_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_wallet_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_wallet_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_wallet_entries_prototype_workspace_id_fkey"
            columns: ["prototype_workspace_id"]
            isOneToOne: false
            referencedRelation: "prototype_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wallets: {
        Row: {
          created_at: string
          earned_credits_balance: number
          free_credits_balance: number
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          earned_credits_balance?: number
          free_credits_balance?: number
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          earned_credits_balance?: number
          free_credits_balance?: number
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_accounts: {
        Row: {
          available_to_spend: number
          available_to_withdraw: number
          created_at: string
          currency: string
          locked: number
          pending: number
          profile_id: string
          updated_at: string
        }
        Insert: {
          available_to_spend?: number
          available_to_withdraw?: number
          created_at?: string
          currency?: string
          locked?: number
          pending?: number
          profile_id: string
          updated_at?: string
        }
        Update: {
          available_to_spend?: number
          available_to_withdraw?: number
          created_at?: string
          currency?: string
          locked?: number
          pending?: number
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_accounts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_ledger_entries: {
        Row: {
          actor_profile_id: string | null
          amount: number
          balance_bucket: string
          created_at: string
          currency: string
          entry_type: Database["public"]["Enums"]["monetary_entry_type"]
          id: string
          metadata: Json
          profile_id: string
          reference_id: string | null
          reference_type: string | null
          status: string
        }
        Insert: {
          actor_profile_id?: string | null
          amount: number
          balance_bucket: string
          created_at?: string
          currency?: string
          entry_type: Database["public"]["Enums"]["monetary_entry_type"]
          id?: string
          metadata?: Json
          profile_id: string
          reference_id?: string | null
          reference_type?: string | null
          status?: string
        }
        Update: {
          actor_profile_id?: string | null
          amount?: number
          balance_bucket?: string
          created_at?: string
          currency?: string
          entry_type?: Database["public"]["Enums"]["monetary_entry_type"]
          id?: string
          metadata?: Json
          profile_id?: string
          reference_id?: string | null
          reference_type?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_entries_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          actor_id: string
          amount: number
          created_at: string
          currency: string
          id: string
          notes: string | null
          processed_at: string | null
          processed_by_id: string | null
          requested_at: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
        }
        Insert: {
          actor_id: string
          amount: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
        }
        Update: {
          actor_id?: string
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_processed_by_id_fkey"
            columns: ["processed_by_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_credit_earnings: {
        Args: {
          channel: string
          credit_amount: number
          earning_type: string
          p_notes?: string
          p_reference_id?: string
          p_reference_type?: string
          target_profile_id: string
        }
        Returns: {
          actor_profile_id: string | null
          amount: number
          balance_bucket: string
          created_at: string
          currency: string
          entry_type: Database["public"]["Enums"]["monetary_entry_type"]
          id: string
          metadata: Json
          profile_id: string
          reference_id: string | null
          reference_type: string | null
          status: string
        }
      }
      claim_released_lead: { Args: { target_lead_id: string }; Returns: string }
      collect_lead_update_fields: {
        Args: {
          new_row: Database["public"]["Tables"]["leads"]["Row"]
          old_row: Database["public"]["Tables"]["leads"]["Row"]
        }
        Returns: string[]
      }
      collect_profile_names_by_legacy_mock_ids: {
        Args: { target_legacy_mock_ids: string[] }
        Returns: Json
      }
      consolidate_pending_earnings: {
        Args: { consolidate_amount: number; target_profile_id: string }
        Returns: {
          available_to_spend: number
          available_to_withdraw: number
          created_at: string
          currency: string
          locked: number
          pending: number
          profile_id: string
          updated_at: string
        }
      }
      enqueue_user_notification: {
        Args: {
          next_body: string
          next_domain: string
          next_href: string
          next_source_event_id: string
          next_source_kind: string
          next_title: string
          occurred_at?: string
          target_profile_id: string
        }
        Returns: undefined
      }
      ensure_current_user_wallet: {
        Args: never
        Returns: {
          created_at: string
          earned_credits_balance: number
          free_credits_balance: number
          profile_id: string
          updated_at: string
        }
      }
      ensure_monetary_wallet: {
        Args: never
        Returns: {
          available_to_spend: number
          available_to_withdraw: number
          created_at: string
          currency: string
          locked: number
          pending: number
          profile_id: string
          updated_at: string
        }
      }
      find_profile_name_by_legacy_mock_id: {
        Args: { target_legacy_mock_id: string }
        Returns: string
      }
      handoff_prototype_workspace_to_delivery: {
        Args: { target_workspace_id: string }
        Returns: {
          created_at: string
          current_stage: Database["public"]["Enums"]["prototype_stage"]
          generated_at: string | null
          generated_content: string | null
          generation_prompt: string | null
          id: string
          last_operation_id: string | null
          lead_id: string
          project_id: string | null
          requested_by_profile_id: string
          status: Database["public"]["Enums"]["prototype_workspace_status"]
          updated_at: string
        }
      }
      link_lead_prototype_workspace_to_project: {
        Args: { target_lead_id: string; target_project_id: string }
        Returns: {
          link_status: string
          linked_project_id: string
          prototype_workspace_id: string
        }[]
      }
      log_lead_activity: {
        Args: {
          target_activity_type: Database["public"]["Enums"]["lead_activity_type"]
          target_actor_profile_id: string
          target_created_at?: string
          target_lead_id: string
          target_metadata: Json
          target_note_body: string
        }
        Returns: undefined
      }
      log_project_activity: {
        Args: {
          next_activity_type: Database["public"]["Enums"]["project_activity_type"]
          next_actor_profile_id?: string
          next_metadata?: Json
          occurred_at?: string
          target_project_id: string
        }
        Returns: string
      }
      log_task_activity: {
        Args: {
          target_activity_type: Database["public"]["Enums"]["task_activity_type"]
          target_actor_profile_id: string
          target_created_at?: string
          target_metadata: Json
          target_note_body: string
          target_task_id: string
        }
        Returns: undefined
      }
      normalize_legacy_user_ids: {
        Args: { input_ids: string[] }
        Returns: string[]
      }
      notification_format_hours: {
        Args: { hours_value: Json }
        Returns: string
      }
      notification_format_name_list: {
        Args: { input_names: string[] }
        Returns: string
      }
      notification_jsonb_text_array: {
        Args: { input_value: Json }
        Returns: string[]
      }
      notification_label_for_lead_status: {
        Args: { status_value: Database["public"]["Enums"]["lead_status"] }
        Returns: string
      }
      notification_label_for_project_status: {
        Args: { status_value: Database["public"]["Enums"]["project_status"] }
        Returns: string
      }
      notification_label_for_proposal_status: {
        Args: { status_value: Database["public"]["Enums"]["proposal_status"] }
        Returns: string
      }
      notification_label_for_task_status: {
        Args: { status_value: Database["public"]["Enums"]["task_status"] }
        Returns: string
      }
      release_lead_as_no_response: {
        Args: { target_lead_id: string }
        Returns: string
      }
      request_lead_prototype: {
        Args: { target_lead_id: string }
        Returns: {
          consumed_earned: number
          consumed_free: number
          earned_balance: number
          free_balance: number
          prototype_workspace_id: string
        }[]
      }
      resolve_client_token: {
        Args: { p_token: string }
        Returns: {
          client_email: string
          client_name: string
          latest_update_date: string
          latest_update_next_step: string
          latest_update_text: string
          lead_id: string
          payment_activated: boolean
          payment_status: string
          project_id: string
          project_name: string
          project_status: string
          proposal_amount: number
          proposal_id: string
          proposal_title: string
          token_id: string
        }[]
      }
      review_proposal: {
        Args: { p_action: string; p_proposal_id: string }
        Returns: {
          accepted_at: string | null
          amount: number
          body: string
          created_at: string
          created_by: string
          currency: string
          expires_at: string | null
          first_opened_at: string | null
          handoff_ready_at: string | null
          id: string
          is_special_case: boolean
          lead_id: string
          paid_at: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          review_status: Database["public"]["Enums"]["proposal_review_status"]
          reviewed_at: string | null
          reviewer_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          superseded_by: string | null
          title: string
          updated_at: string
          version_number: number
        }
      }
      touch_client_token: { Args: { p_token: string }; Returns: undefined }
    }
    Enums: {
      batch_status: "pending" | "processing" | "completed" | "failed"
      earning_actor_role: "seller" | "developer" | "noon"
      earning_status: "credited" | "paid_out" | "cancelled"
      earning_type: "activation" | "monthly"
      lead_activity_type:
        | "created"
        | "updated"
        | "status_changed"
        | "note_added"
        | "proposal_created"
        | "proposal_status_changed"
        | "project_created"
        | "released_no_response"
        | "claimed"
      lead_assignment_status:
        | "owned"
        | "proposal_locked"
        | "released_no_response"
      lead_origin: "inbound" | "outbound"
      lead_source:
        | "website"
        | "referral"
        | "cold_call"
        | "social"
        | "event"
        | "other"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
      monetary_entry_type:
        | "deposit"
        | "earnings_distribution"
        | "service_debit"
        | "withdrawal_request"
        | "withdrawal_confirmed"
        | "manual_adjustment"
        | "balance_locked"
        | "balance_unlocked"
      payment_status:
        | "pending"
        | "succeeded"
        | "failed"
        | "refunded"
        | "disputed"
      payment_type: "full_project" | "phase"
      payout_method_type: "bank_transfer" | "binance_pay"
      payout_status: "pending" | "processing" | "completed" | "failed"
      points_event_type:
        | "lead_won"
        | "payment_received"
        | "project_milestone"
        | "manual_grant"
        | "redemption"
      project_activity_type:
        | "status_changed"
        | "pm_changed"
        | "team_changed"
        | "schedule_changed"
      project_status:
        | "backlog"
        | "in_progress"
        | "review"
        | "delivered"
        | "completed"
      proposal_review_status:
        | "pending_review"
        | "approved"
        | "rejected"
        | "expired"
        | "cancelled"
      proposal_status:
        | "draft"
        | "sent"
        | "accepted"
        | "rejected"
        | "handoff_ready"
      prototype_stage: "sales" | "delivery"
      prototype_workspace_status:
        | "pending_generation"
        | "ready"
        | "delivery_active"
        | "archived"
      provider_event_status: "pending" | "processed" | "failed" | "ignored"
      provider_name: "stripe" | "binance"
      task_activity_type:
        | "note_added"
        | "status_changed"
        | "actual_hours_updated"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "review" | "done"
      user_role: "admin" | "sales_manager" | "sales" | "pm" | "developer"
      wallet_bucket: "free" | "earned"
      wallet_entry_type:
        | "free_grant"
        | "earnings_credit"
        | "manual_adjustment"
        | "prototype_request_debit"
        | "prototype_continue_debit"
      withdrawal_status: "pending" | "approved" | "rejected" | "completed"
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
      batch_status: ["pending", "processing", "completed", "failed"],
      earning_actor_role: ["seller", "developer", "noon"],
      earning_status: ["credited", "paid_out", "cancelled"],
      earning_type: ["activation", "monthly"],
      lead_activity_type: [
        "created",
        "updated",
        "status_changed",
        "note_added",
        "proposal_created",
        "proposal_status_changed",
        "project_created",
        "released_no_response",
        "claimed",
      ],
      lead_assignment_status: [
        "owned",
        "proposal_locked",
        "released_no_response",
      ],
      lead_origin: ["inbound", "outbound"],
      lead_source: [
        "website",
        "referral",
        "cold_call",
        "social",
        "event",
        "other",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
      monetary_entry_type: [
        "deposit",
        "earnings_distribution",
        "service_debit",
        "withdrawal_request",
        "withdrawal_confirmed",
        "manual_adjustment",
        "balance_locked",
        "balance_unlocked",
      ],
      payment_status: [
        "pending",
        "succeeded",
        "failed",
        "refunded",
        "disputed",
      ],
      payment_type: ["full_project", "phase"],
      payout_method_type: ["bank_transfer", "binance_pay"],
      payout_status: ["pending", "processing", "completed", "failed"],
      points_event_type: [
        "lead_won",
        "payment_received",
        "project_milestone",
        "manual_grant",
        "redemption",
      ],
      project_activity_type: [
        "status_changed",
        "pm_changed",
        "team_changed",
        "schedule_changed",
      ],
      project_status: [
        "backlog",
        "in_progress",
        "review",
        "delivered",
        "completed",
      ],
      proposal_review_status: [
        "pending_review",
        "approved",
        "rejected",
        "expired",
        "cancelled",
      ],
      proposal_status: [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "handoff_ready",
      ],
      prototype_stage: ["sales", "delivery"],
      prototype_workspace_status: [
        "pending_generation",
        "ready",
        "delivery_active",
        "archived",
      ],
      provider_event_status: ["pending", "processed", "failed", "ignored"],
      provider_name: ["stripe", "binance"],
      task_activity_type: [
        "note_added",
        "status_changed",
        "actual_hours_updated",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "review", "done"],
      user_role: ["admin", "sales_manager", "sales", "pm", "developer"],
      wallet_bucket: ["free", "earned"],
      wallet_entry_type: [
        "free_grant",
        "earnings_credit",
        "manual_adjustment",
        "prototype_request_debit",
        "prototype_continue_debit",
      ],
      withdrawal_status: ["pending", "approved", "rejected", "completed"],
    },
  },
} as const
