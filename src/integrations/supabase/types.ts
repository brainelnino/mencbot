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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          member_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          member_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_accounts: {
        Row: {
          admin_slot: number | null
          created_at: string
          display_label: string
          id: string
          is_active: boolean
          is_owner: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_slot?: number | null
          created_at?: string
          display_label: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_slot?: number | null
          created_at?: string
          display_label?: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_permission_grants: {
        Row: {
          admin_id: string
          granted_at: string
          id: string
          permission: Database["public"]["Enums"]["admin_permission"]
        }
        Insert: {
          admin_id: string
          granted_at?: string
          id?: string
          permission: Database["public"]["Enums"]["admin_permission"]
        }
        Update: {
          admin_id?: string
          granted_at?: string
          id?: string
          permission?: Database["public"]["Enums"]["admin_permission"]
        }
        Relationships: [
          {
            foreignKeyName: "admin_permission_grants_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_admin_id: string | null
          created_at: string
          details: Json
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_admin_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_admin_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_admin_id_fkey"
            columns: ["actor_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_terms: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          severity: string
          term: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          severity?: string
          term: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          severity?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_terms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_insights: {
        Row: {
          created_at: string
          distinct_members: number
          evidence: Json
          id: string
          limitations: string | null
          mention_count: number
          period_end: string | null
          period_start: string | null
          status: string
          topic: string
        }
        Insert: {
          created_at?: string
          distinct_members?: number
          evidence?: Json
          id?: string
          limitations?: string | null
          mention_count?: number
          period_end?: string | null
          period_start?: string | null
          status?: string
          topic: string
        }
        Update: {
          created_at?: string
          distinct_members?: number
          evidence?: Json
          id?: string
          limitations?: string | null
          mention_count?: number
          period_end?: string | null
          period_start?: string | null
          status?: string
          topic?: string
        }
        Relationships: []
      }
      identity_generations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["generation_kind"]
          label: string
          range_end: number | null
          range_start: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["generation_kind"]
          label: string
          range_end?: number | null
          range_start?: number | null
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["generation_kind"]
          label?: string
          range_end?: number | null
          range_start?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      image_reviews: {
        Row: {
          created_at: string
          decided_by: string | null
          decision: Database["public"]["Enums"]["moderation_status"]
          id: string
          reason: string | null
          submission_id: string
        }
        Insert: {
          created_at?: string
          decided_by?: string | null
          decision: Database["public"]["Enums"]["moderation_status"]
          id?: string
          reason?: string | null
          submission_id: string
        }
        Update: {
          created_at?: string
          decided_by?: string | null
          decision?: Database["public"]["Enums"]["moderation_status"]
          id?: string
          reason?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_reviews_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_reviews_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "image_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      image_submissions: {
        Row: {
          created_at: string
          id: string
          member_id: string | null
          message_id: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id?: string | null
          message_id?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string | null
          message_id?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_submissions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_submissions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      image_votes: {
        Row: {
          admin_id: string
          approve: boolean
          created_at: string
          id: string
          submission_id: string
        }
        Insert: {
          admin_id: string
          approve: boolean
          created_at?: string
          id?: string
          submission_id: string
        }
        Update: {
          admin_id?: string
          approve?: boolean
          created_at?: string
          id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_votes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_votes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "image_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          id: string
          last_active_at: string | null
          registered_at: string
          status: Database["public"]["Enums"]["member_status"]
          telegram_user_id: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          last_active_at?: string | null
          registered_at?: string
          status?: Database["public"]["Enums"]["member_status"]
          telegram_user_id?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          last_active_at?: string | null
          registered_at?: string
          status?: Database["public"]["Enums"]["member_status"]
          telegram_user_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_path: string | null
          kind: Database["public"]["Enums"]["message_kind"]
          member_id: string | null
          moderation_reason: string | null
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          processing_status: string
          publication_error: string | null
          publication_status: Database["public"]["Enums"]["publication_status"]
          publish_attempts: number
          published_at: string | null
          reply_to_id: string | null
          sender_label: string
          source_update_id: number | null
          telegram_chat_message_ref: Json | null
          telegram_message_id: number | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          kind?: Database["public"]["Enums"]["message_kind"]
          member_id?: string | null
          moderation_reason?: string | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          processing_status?: string
          publication_error?: string | null
          publication_status?: Database["public"]["Enums"]["publication_status"]
          publish_attempts?: number
          published_at?: string | null
          reply_to_id?: string | null
          sender_label: string
          source_update_id?: number | null
          telegram_chat_message_ref?: Json | null
          telegram_message_id?: number | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          kind?: Database["public"]["Enums"]["message_kind"]
          member_id?: string | null
          moderation_reason?: string | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          processing_status?: string
          publication_error?: string | null
          publication_status?: Database["public"]["Enums"]["publication_status"]
          publish_attempts?: number
          published_at?: string | null
          reply_to_id?: string | null
          sender_label?: string
          source_update_id?: number | null
          telegram_chat_message_ref?: Json | null
          telegram_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_events: {
        Row: {
          automated: boolean
          created_at: string
          decided_by_admin: string | null
          decision: Database["public"]["Enums"]["moderation_status"]
          id: string
          message_id: string | null
          reason: string | null
        }
        Insert: {
          automated?: boolean
          created_at?: string
          decided_by_admin?: string | null
          decision: Database["public"]["Enums"]["moderation_status"]
          id?: string
          message_id?: string | null
          reason?: string | null
        }
        Update: {
          automated?: boolean
          created_at?: string
          decided_by_admin?: string | null
          decision?: Database["public"]["Enums"]["moderation_status"]
          id?: string
          message_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_events_decided_by_admin_fkey"
            columns: ["decided_by_admin"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_rules: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_enabled: boolean
          name: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          name: string
          rule_type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          name?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_identities: {
        Row: {
          created_at: string
          generation_id: string
          id: string
          label: string
          member_id: string
          numeric_value: number | null
        }
        Insert: {
          created_at?: string
          generation_id: string
          id?: string
          label: string
          member_id: string
          numeric_value?: number | null
        }
        Update: {
          created_at?: string
          generation_id?: string
          id?: string
          label?: string
          member_id?: string
          numeric_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "public_identities_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "identity_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_identities_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      telegram_admins: {
        Row: {
          admin_slot: number
          appointed_at: string
          id: string
          is_active: boolean
          member_id: string
        }
        Insert: {
          admin_slot: number
          appointed_at?: string
          id?: string
          is_active?: boolean
          member_id: string
        }
        Update: {
          admin_slot?: number
          appointed_at?: string
          id?: string
          is_active?: boolean
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_admins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_config: {
        Row: {
          bot_username: string | null
          group_link_code: string | null
          group_link_expires_at: string | null
          group_title: string | null
          group_verified_at: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          last_update_at: string | null
          public_group_chat_id: number | null
          updated_at: string
          webhook_registered: boolean
          webhook_url: string | null
        }
        Insert: {
          bot_username?: string | null
          group_link_code?: string | null
          group_link_expires_at?: string | null
          group_title?: string | null
          group_verified_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_update_at?: string | null
          public_group_chat_id?: number | null
          updated_at?: string
          webhook_registered?: boolean
          webhook_url?: string | null
        }
        Update: {
          bot_username?: string | null
          group_link_code?: string | null
          group_link_expires_at?: string | null
          group_title?: string | null
          group_verified_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_update_at?: string | null
          public_group_chat_id?: number | null
          updated_at?: string
          webhook_registered?: boolean
          webhook_url?: string | null
        }
        Relationships: []
      }
      telegram_deliveries: {
        Row: {
          attempts: number
          claimed_at: string | null
          id: string
          last_error: string | null
          member_id: string
          message_id: string
          sent_at: string | null
          status: string
          telegram_message_id: number | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          id?: string
          last_error?: string | null
          member_id: string
          message_id: string
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          id?: string
          last_error?: string | null
          member_id?: string
          message_id?: string
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_deliveries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_updates: {
        Row: {
          attempts: number
          error: string | null
          processed_at: string | null
          received_at: string
          status: string
          update_id: number
          update_kind: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          update_id: number
          update_kind: string
        }
        Update: {
          attempts?: number
          error?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          update_id?: number
          update_kind?: string
        }
        Relationships: []
      }
      user_restrictions: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["restriction_kind"]
          lifted_at: string | null
          member_id: string
          reason: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["restriction_kind"]
          lifted_at?: string | null
          member_id: string
          reason?: string | null
          starts_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["restriction_kind"]
          lifted_at?: string | null
          member_id?: string
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_restrictions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_restrictions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_identity: { Args: { _member_id: string }; Returns: string }
      appoint_telegram_admin: {
        Args: { _label: string; _slot: number }
        Returns: string
      }
      claim_ownership: { Args: { _display_label: string }; Returns: string }
      claim_private_deliveries: {
        Args: { _message_id: string }
        Returns: {
          body: string
          chat_id: number
          id: string
          sender_label: string
        }[]
      }
      current_admin_id: { Args: never; Returns: string }
      enqueue_private_message: {
        Args: { _message_id: string }
        Returns: undefined
      }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_public_messages: {
        Args: { _limit?: number }
        Returns: {
          body: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          published_at: string
          reply_to_id: string
          sender_label: string
        }[]
      }
      get_telegram_admin_slot: {
        Args: { _tg_user_id: number }
        Returns: number
      }
      has_permission: {
        Args: { _perm: Database["public"]["Enums"]["admin_permission"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      owner_exists: { Args: never; Returns: boolean }
      register_telegram_member: {
        Args: { _tg_user_id: number }
        Returns: {
          is_new: boolean
          label: string
          member_id: string
        }[]
      }
      set_telegram_admin_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      telegram_admin_set_member_status: {
        Args: {
          _label: string
          _status: Database["public"]["Enums"]["member_status"]
          _tg_user_id: number
        }
        Returns: boolean
      }
      write_audit: {
        Args: {
          _action: string
          _details: Json
          _target_id: string
          _target_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      admin_permission:
        | "view_moderation_queue"
        | "review_images"
        | "review_reports"
        | "manage_blocked_terms"
        | "manage_link_rules"
        | "manage_rate_limits"
        | "manage_restrictions"
        | "manage_members"
        | "view_statistics"
        | "view_audit"
        | "manage_admins"
        | "manage_settings"
      generation_kind: "numeric" | "alpha"
      member_status: "active" | "restricted" | "banned"
      message_kind: "text" | "image"
      moderation_status: "pending" | "approved" | "rejected" | "flagged"
      publication_status: "unpublished" | "published" | "withdrawn"
      restriction_kind: "mute" | "ban" | "shadow_ban"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      admin_permission: [
        "view_moderation_queue",
        "review_images",
        "review_reports",
        "manage_blocked_terms",
        "manage_link_rules",
        "manage_rate_limits",
        "manage_restrictions",
        "manage_members",
        "view_statistics",
        "view_audit",
        "manage_admins",
        "manage_settings",
      ],
      generation_kind: ["numeric", "alpha"],
      member_status: ["active", "restricted", "banned"],
      message_kind: ["text", "image"],
      moderation_status: ["pending", "approved", "rejected", "flagged"],
      publication_status: ["unpublished", "published", "withdrawn"],
      restriction_kind: ["mute", "ban", "shadow_ban"],
    },
  },
} as const
