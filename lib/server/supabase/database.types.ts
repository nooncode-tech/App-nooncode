export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'sales_manager' | 'sales' | 'pm' | 'developer'
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
export type LeadSource = 'website' | 'referral' | 'cold_call' | 'social' | 'event' | 'other'
export type LeadAssignmentStatus = 'owned' | 'proposal_locked' | 'released_no_response'
export type LeadActivityType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'note_added'
  | 'proposal_created'
  | 'proposal_status_changed'
  | 'project_created'
  | 'released_no_response'
  | 'claimed'
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'handoff_ready'
export type ProjectStatus = 'backlog' | 'in_progress' | 'review' | 'delivered' | 'completed'
export type ProjectActivityType = 'status_changed' | 'pm_changed' | 'team_changed' | 'schedule_changed'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskActivityType = 'note_added' | 'status_changed' | 'actual_hours_updated'
export type UserNotificationSourceKind = 'lead_activity' | 'task_activity' | 'project_activity'
export type UserNotificationDomain = 'sales' | 'delivery'
export type WalletEntryType =
  | 'free_grant'
  | 'earnings_credit'
  | 'manual_adjustment'
  | 'prototype_request_debit'
  | 'prototype_continue_debit'
export type WalletBucket = 'free' | 'earned'
export type PrototypeStage = 'sales' | 'delivery'
export type PrototypeWorkspaceStatus = 'pending_generation' | 'ready' | 'delivery_active' | 'archived'
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed'
export type PaymentType = 'full_project' | 'phase'
export type LeadOrigin = 'inbound' | 'outbound'
export type EarningActorRole = 'seller' | 'developer' | 'noon'
export type EarningType = 'activation' | 'monthly'
export type EarningStatus = 'credited' | 'paid_out' | 'cancelled'

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: UserRole
          is_active: boolean
          avatar_url: string | null
          legacy_mock_id: string | null
          locale: string
          timezone: string
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role: UserRole
          is_active?: boolean
          avatar_url?: string | null
          legacy_mock_id?: string | null
          locale?: string
          timezone?: string
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: UserRole
          is_active?: boolean
          avatar_url?: string | null
          legacy_mock_id?: string | null
          locale?: string
          timezone?: string
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          legacy_mock_id: string | null
          name: string
          email: string
          phone: string | null
          company: string | null
          source: LeadSource
          status: LeadStatus
          score: number
          value: number
          assigned_to: string | null
          assignment_status: LeadAssignmentStatus
          locked_by_proposal_id: string | null
          locked_at: string | null
          released_at: string | null
          created_by: string
          notes: string | null
          tags: string[]
          last_contacted_at: string | null
          next_follow_up_at: string | null
          location_text: string | null
          latitude: number | null
          longitude: number | null
          lead_origin: LeadOrigin | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          legacy_mock_id?: string | null
          name: string
          email: string
          phone?: string | null
          company?: string | null
          source: LeadSource
          status?: LeadStatus
          score: number
          value?: number
          assigned_to?: string | null
          assignment_status?: LeadAssignmentStatus
          locked_by_proposal_id?: string | null
          locked_at?: string | null
          released_at?: string | null
          created_by: string
          notes?: string | null
          tags?: string[]
          last_contacted_at?: string | null
          next_follow_up_at?: string | null
          location_text?: string | null
          latitude?: number | null
          longitude?: number | null
          lead_origin?: LeadOrigin | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          legacy_mock_id?: string | null
          name?: string
          email?: string
          phone?: string | null
          company?: string | null
          source?: LeadSource
          status?: LeadStatus
          score?: number
          value?: number
          assigned_to?: string | null
          assignment_status?: LeadAssignmentStatus
          locked_by_proposal_id?: string | null
          locked_at?: string | null
          released_at?: string | null
          created_by?: string
          notes?: string | null
          tags?: string[]
          last_contacted_at?: string | null
          next_follow_up_at?: string | null
          location_text?: string | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'leads_assigned_to_fkey'
            columns: ['assigned_to']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'leads_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          }
        ]
      }
      lead_activities: {
        Row: {
          id: string
          lead_id: string
          activity_type: LeadActivityType
          actor_profile_id: string | null
          note_body: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          activity_type: LeadActivityType
          actor_profile_id?: string | null
          note_body?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          activity_type?: LeadActivityType
          actor_profile_id?: string | null
          note_body?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lead_activities_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lead_activities_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          }
        ]
      }
      lead_proposals: {
        Row: {
          id: string
          lead_id: string
          created_by: string
          title: string
          body: string
          amount: number
          currency: string
          status: ProposalStatus
          sent_at: string | null
          accepted_at: string | null
          handoff_ready_at: string | null
          payment_status: PaymentStatus | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          created_by: string
          title: string
          body: string
          amount?: number
          currency?: string
          status?: ProposalStatus
          sent_at?: string | null
          accepted_at?: string | null
          handoff_ready_at?: string | null
          payment_status?: PaymentStatus | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          created_by?: string
          title?: string
          body?: string
          amount?: number
          currency?: string
          status?: ProposalStatus
          sent_at?: string | null
          accepted_at?: string | null
          handoff_ready_at?: string | null
          payment_status?: PaymentStatus | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lead_proposals_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lead_proposals_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          }
        ]
      }
      projects: {
        Row: {
          id: string
          source_lead_id: string | null
          source_proposal_id: string | null
          created_by: string
          name: string
          description: string | null
          client_name: string
          status: ProjectStatus
          budget: number
          pm_legacy_user_id: string | null
          team_legacy_user_ids: string[]
          handoff_ready_at: string | null
          start_date: string | null
          end_date: string | null
          payment_activated: boolean
          payment_activated_at: string | null
          developer_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_lead_id?: string | null
          source_proposal_id?: string | null
          created_by: string
          name: string
          description?: string | null
          client_name: string
          status?: ProjectStatus
          budget?: number
          pm_legacy_user_id?: string | null
          team_legacy_user_ids?: string[]
          handoff_ready_at?: string | null
          start_date?: string | null
          end_date?: string | null
          payment_activated?: boolean
          payment_activated_at?: string | null
          developer_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_lead_id?: string | null
          source_proposal_id?: string | null
          created_by?: string
          name?: string
          description?: string | null
          client_name?: string
          status?: ProjectStatus
          budget?: number
          pm_legacy_user_id?: string | null
          team_legacy_user_ids?: string[]
          handoff_ready_at?: string | null
          start_date?: string | null
          end_date?: string | null
          payment_activated?: boolean
          payment_activated_at?: string | null
          developer_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_source_lead_id_fkey'
            columns: ['source_lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_source_proposal_id_fkey'
            columns: ['source_proposal_id']
            referencedRelation: 'lead_proposals'
            referencedColumns: ['id']
          }
        ]
      }
      project_activities: {
        Row: {
          id: string
          project_id: string
          activity_type: ProjectActivityType
          actor_profile_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          activity_type: ProjectActivityType
          actor_profile_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          activity_type?: ProjectActivityType
          actor_profile_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_activities_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_activities_project_id_fkey'
            columns: ['project_id']
            referencedRelation: 'projects'
            referencedColumns: ['id']
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          created_by: string
          title: string
          description: string | null
          status: TaskStatus
          priority: TaskPriority
          assigned_legacy_user_id: string | null
          due_date: string | null
          estimated_hours: number | null
          actual_hours: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          created_by: string
          title: string
          description?: string | null
          status?: TaskStatus
          priority?: TaskPriority
          assigned_legacy_user_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          created_by?: string
          title?: string
          description?: string | null
          status?: TaskStatus
          priority?: TaskPriority
          assigned_legacy_user_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_assigned_legacy_user_id_fkey'
            columns: ['assigned_legacy_user_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['legacy_mock_id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            referencedRelation: 'projects'
            referencedColumns: ['id']
          }
        ]
      }
      task_activities: {
        Row: {
          id: string
          task_id: string
          activity_type: TaskActivityType
          actor_profile_id: string | null
          note_body: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          activity_type: TaskActivityType
          actor_profile_id?: string | null
          note_body?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          activity_type?: TaskActivityType
          actor_profile_id?: string | null
          note_body?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_activities_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_activities_task_id_fkey'
            columns: ['task_id']
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          }
        ]
      }
      user_notifications: {
        Row: {
          id: string
          profile_id: string
          source_kind: UserNotificationSourceKind
          source_event_id: string
          domain: UserNotificationDomain
          title: string
          body: string
          href: string
          is_read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          source_kind: UserNotificationSourceKind
          source_event_id: string
          domain: UserNotificationDomain
          title: string
          body: string
          href: string
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          source_kind?: UserNotificationSourceKind
          source_event_id?: string
          domain?: UserNotificationDomain
          title?: string
          body?: string
          href?: string
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_notifications_profile_id_fkey'
            columns: ['profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          }
        ]
      }
      prototype_credit_settings: {
        Row: {
          singleton_key: boolean
          request_cost: number
          updated_by_profile_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          singleton_key?: boolean
          request_cost: number
          updated_by_profile_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          singleton_key?: boolean
          request_cost?: number
          updated_by_profile_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'prototype_credit_settings_updated_by_profile_id_fkey'
            columns: ['updated_by_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          }
        ]
      }
      user_wallets: {
        Row: {
          profile_id: string
          free_credits_balance: number
          earned_credits_balance: number
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          free_credits_balance?: number
          earned_credits_balance?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          free_credits_balance?: number
          earned_credits_balance?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_wallets_profile_id_fkey'
            columns: ['profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          }
        ]
      }
      prototype_workspaces: {
        Row: {
          id: string
          lead_id: string
          project_id: string | null
          requested_by_profile_id: string
          current_stage: PrototypeStage
          status: PrototypeWorkspaceStatus
          last_operation_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          project_id?: string | null
          requested_by_profile_id: string
          current_stage?: PrototypeStage
          status?: PrototypeWorkspaceStatus
          last_operation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          project_id?: string | null
          requested_by_profile_id?: string
          current_stage?: PrototypeStage
          status?: PrototypeWorkspaceStatus
          last_operation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'prototype_workspaces_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'prototype_workspaces_project_id_fkey'
            columns: ['project_id']
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'prototype_workspaces_requested_by_profile_id_fkey'
            columns: ['requested_by_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          }
        ]
      }
      user_wallet_entries: {
        Row: {
          id: string
          profile_id: string
          entry_type: WalletEntryType
          bucket: WalletBucket
          delta_credits: number
          operation_id: string
          actor_profile_id: string | null
          lead_id: string | null
          prototype_workspace_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          entry_type: WalletEntryType
          bucket: WalletBucket
          delta_credits: number
          operation_id: string
          actor_profile_id?: string | null
          lead_id?: string | null
          prototype_workspace_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          entry_type?: WalletEntryType
          bucket?: WalletBucket
          delta_credits?: number
          operation_id?: string
          actor_profile_id?: string | null
          lead_id?: string | null
          prototype_workspace_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_wallet_entries_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_wallet_entries_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_wallet_entries_profile_id_fkey'
            columns: ['profile_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_wallet_entries_prototype_workspace_id_fkey'
            columns: ['prototype_workspace_id']
            referencedRelation: 'prototype_workspaces'
            referencedColumns: ['id']
          }
        ]
      }
      stripe_customers: {
        Row: {
          id: string
          lead_id: string
          stripe_customer_id: string
          email: string | null
          name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          stripe_customer_id: string
          email?: string | null
          name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          stripe_customer_id?: string
          email?: string | null
          name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stripe_customers_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          }
        ]
      }
      payments: {
        Row: {
          id: string
          proposal_id: string
          project_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_checkout_session_id: string | null
          payment_type: PaymentType
          amount: number
          currency: string
          status: PaymentStatus
          paid_at: string | null
          refunded_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proposal_id: string
          project_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_checkout_session_id?: string | null
          payment_type?: PaymentType
          amount: number
          currency?: string
          status?: PaymentStatus
          paid_at?: string | null
          refunded_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proposal_id?: string
          project_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_checkout_session_id?: string | null
          payment_type?: PaymentType
          amount?: number
          currency?: string
          status?: PaymentStatus
          paid_at?: string | null
          refunded_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payments_proposal_id_fkey'
            columns: ['proposal_id']
            referencedRelation: 'lead_proposals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_project_id_fkey'
            columns: ['project_id']
            referencedRelation: 'projects'
            referencedColumns: ['id']
          }
        ]
      }
      earnings_ledger: {
        Row: {
          id: string
          actor_id: string | null
          actor_role: EarningActorRole
          earning_type: EarningType
          amount: number
          currency: string
          lead_id: string | null
          proposal_id: string | null
          payment_id: string | null
          status: EarningStatus
          credited_at: string
          paid_out_at: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_role: EarningActorRole
          earning_type: EarningType
          amount: number
          currency?: string
          lead_id?: string | null
          proposal_id?: string | null
          payment_id?: string | null
          status?: EarningStatus
          credited_at?: string
          paid_out_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          actor_role?: EarningActorRole
          earning_type?: EarningType
          amount?: number
          currency?: string
          lead_id?: string | null
          proposal_id?: string | null
          payment_id?: string | null
          status?: EarningStatus
          credited_at?: string
          paid_out_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'earnings_ledger_actor_id_fkey'
            columns: ['actor_id']
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'earnings_ledger_lead_id_fkey'
            columns: ['lead_id']
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'earnings_ledger_proposal_id_fkey'
            columns: ['proposal_id']
            referencedRelation: 'lead_proposals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'earnings_ledger_payment_id_fkey'
            columns: ['payment_id']
            referencedRelation: 'payments'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      ensure_current_user_wallet: {
        Args: Record<PropertyKey, never>
        Returns: Database['public']['Tables']['user_wallets']['Row']
      }
      handoff_prototype_workspace_to_delivery: {
        Args: {
          target_workspace_id: string
        }
        Returns: Database['public']['Tables']['prototype_workspaces']['Row']
      }
      link_lead_prototype_workspace_to_project: {
        Args: {
          target_lead_id: string
          target_project_id: string
        }
        Returns: {
          prototype_workspace_id: string | null
          linked_project_id: string | null
          link_status: string
        }[]
      }
      claim_released_lead: {
        Args: {
          target_lead_id: string
        }
        Returns: string
      }
      request_lead_prototype: {
        Args: {
          target_lead_id: string
        }
        Returns: {
          prototype_workspace_id: string
          consumed_free: number
          consumed_earned: number
          free_balance: number
          earned_balance: number
        }[]
      }
      release_lead_as_no_response: {
        Args: {
          target_lead_id: string
        }
        Returns: string
      }
    }
    Enums: {
      user_role: UserRole
      lead_status: LeadStatus
      lead_source: LeadSource
      lead_assignment_status: LeadAssignmentStatus
      lead_activity_type: LeadActivityType
      proposal_status: ProposalStatus
      project_status: ProjectStatus
      project_activity_type: ProjectActivityType
      task_status: TaskStatus
      task_priority: TaskPriority
      task_activity_type: TaskActivityType
      wallet_entry_type: WalletEntryType
      wallet_bucket: WalletBucket
      prototype_stage: PrototypeStage
      prototype_workspace_status: PrototypeWorkspaceStatus
      lead_origin: LeadOrigin
      earning_actor_role: EarningActorRole
      earning_type: EarningType
      earning_status: EarningStatus
    }
    CompositeTypes: Record<string, never>
  }
}
