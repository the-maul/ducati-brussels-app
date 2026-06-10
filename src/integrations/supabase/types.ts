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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      article_barcodes: {
        Row: {
          article_id: string
          barcode: string
          created_at: string
          id: string
          is_primary: boolean
        }
        Insert: {
          article_id: string
          barcode: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          article_id?: string
          barcode?: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "article_barcodes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "article_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      article_kit_items: {
        Row: {
          component_id: string
          created_at: string
          id: string
          kit_id: string
          quantity: number
        }
        Insert: {
          component_id: string
          created_at?: string
          id?: string
          kit_id: string
          quantity?: number
        }
        Update: {
          component_id?: string
          created_at?: string
          id?: string
          kit_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "article_kit_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_suppliers: {
        Row: {
          article_id: string
          created_at: string
          id: string
          purchase_price: number | null
          supplier_id: string
          supplier_ref: string | null
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          purchase_price?: number | null
          supplier_id: string
          supplier_ref?: string | null
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          purchase_price?: number | null
          supplier_id?: string
          supplier_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_suppliers_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          bin_location: string | null
          brand: string | null
          category_id: string | null
          category_path: string | null
          coefficient: number | null
          company_id: string
          created_at: string
          created_by: string | null
          designation: string
          equivalence_group: string | null
          id: string
          is_active: boolean
          is_library: boolean
          main_supplier_id: string | null
          mgmt_type: Database["public"]["Enums"]["article_mgmt_type"]
          pack_qty: number
          pamp: number
          publishable: boolean
          purchase_price: number
          reference: string
          sale_price_ttc: number
          stock_max: number
          stock_min: number
          superseded_by_id: string | null
          supplier_ref: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          bin_location?: string | null
          brand?: string | null
          category_id?: string | null
          category_path?: string | null
          coefficient?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          designation: string
          equivalence_group?: string | null
          id?: string
          is_active?: boolean
          is_library?: boolean
          main_supplier_id?: string | null
          mgmt_type?: Database["public"]["Enums"]["article_mgmt_type"]
          pack_qty?: number
          pamp?: number
          publishable?: boolean
          purchase_price?: number
          reference: string
          sale_price_ttc?: number
          stock_max?: number
          stock_min?: number
          superseded_by_id?: string | null
          supplier_ref?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          bin_location?: string | null
          brand?: string | null
          category_id?: string | null
          category_path?: string | null
          coefficient?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          designation?: string
          equivalence_group?: string | null
          id?: string
          is_active?: boolean
          is_library?: boolean
          main_supplier_id?: string | null
          mgmt_type?: Database["public"]["Enums"]["article_mgmt_type"]
          pack_qty?: number
          pamp?: number
          publishable?: boolean
          purchase_price?: number
          reference?: string
          sale_price_ttc?: number
          stock_max?: number
          stock_min?: number
          superseded_by_id?: string | null
          supplier_ref?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "article_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_main_supplier_id_fkey"
            columns: ["main_supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          code: string
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          updated_at: string
          vat_number: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          updated_at?: string
          vat_number?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          updated_at?: string
          vat_number?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address: string | null
          birth_date: string | null
          city: string | null
          civility: string | null
          company_id: string
          company_name: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          email: string | null
          first_name: string | null
          iban: string | null
          id: string
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_detaxe: boolean
          is_vip: boolean
          is_watch: boolean
          last_name: string | null
          license_category:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date: string | null
          license_number: string | null
          license_place: string | null
          mobile: string | null
          national_id: string | null
          national_register: string | null
          notes: string | null
          payment_terms: string | null
          phone: string | null
          segment: Database["public"]["Enums"]["customer_segment"]
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          civility?: string | null
          company_id: string
          company_name?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          first_name?: string | null
          iban?: string | null
          id?: string
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_detaxe?: boolean
          is_vip?: boolean
          is_watch?: boolean
          last_name?: string | null
          license_category?:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date?: string | null
          license_number?: string | null
          license_place?: string | null
          mobile?: string | null
          national_id?: string | null
          national_register?: string | null
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          segment?: Database["public"]["Enums"]["customer_segment"]
          type?: Database["public"]["Enums"]["contact_type"]
          updated_at?: string
          vat_number?: string | null
          vies_checked_at?: string | null
          vies_valid?: boolean | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          civility?: string | null
          company_id?: string
          company_name?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          first_name?: string | null
          iban?: string | null
          id?: string
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_detaxe?: boolean
          is_vip?: boolean
          is_watch?: boolean
          last_name?: string | null
          license_category?:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date?: string | null
          license_number?: string | null
          license_place?: string | null
          mobile?: string | null
          national_id?: string | null
          national_register?: string | null
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          segment?: Database["public"]["Enums"]["customer_segment"]
          type?: Database["public"]["Enums"]["contact_type"]
          updated_at?: string
          vat_number?: string | null
          vies_checked_at?: string | null
          vies_valid?: boolean | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          company_id: string
          current_year: number | null
          doc_type: string
          id: string
          label: string
          next_value: number
          padding: number
          prefix: string
          reset_yearly: boolean
          separator: string
          suffix: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          current_year?: number | null
          doc_type: string
          id?: string
          label: string
          next_value?: number
          padding?: number
          prefix: string
          reset_yearly?: boolean
          separator?: string
          suffix?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          current_year?: number | null
          doc_type?: string
          id?: string
          label?: string
          next_value?: number
          padding?: number
          prefix?: string
          reset_yearly?: boolean
          separator?: string
          suffix?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string | null
          entity_id: string | null
          entity_type: string
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          origin: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          origin?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_company_id: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_company_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_company_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_company_id_fkey"
            columns: ["default_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _company: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      is_admin: { Args: { _company: string }; Returns: boolean }
      is_member: { Args: { _company: string }; Returns: boolean }
      next_document_number: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "vendeur"
        | "magasinier"
        | "mecanicien"
        | "chef_atelier"
        | "comptable"
        | "marketing"
      article_mgmt_type: "A" | "M" | "F" | "N" | "V" | "O" | "P" | "D" | "R"
      contact_type:
        | "particulier"
        | "professionnel"
        | "banque_leasing"
        | "fournisseur"
      customer_segment: "standard" | "vip"
      license_category: "AM" | "A1" | "A2" | "A" | "B" | "autre"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "vendeur",
        "magasinier",
        "mecanicien",
        "chef_atelier",
        "comptable",
        "marketing",
      ],
      article_mgmt_type: ["A", "M", "F", "N", "V", "O", "P", "D", "R"],
      contact_type: [
        "particulier",
        "professionnel",
        "banque_leasing",
        "fournisseur",
      ],
      customer_segment: ["standard", "vip"],
      license_category: ["AM", "A1", "A2", "A", "B", "autre"],
    },
  },
} as const
