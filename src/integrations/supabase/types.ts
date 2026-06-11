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
      article_bins: {
        Row: {
          article_id: string
          bin_location: string
          created_at: string
          id: string
          is_primary: boolean
        }
        Insert: {
          article_id: string
          bin_location: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          article_id?: string
          bin_location?: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "article_bins_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_categories: {
        Row: {
          code: number | null
          company_id: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
          sales_account: string | null
        }
        Insert: {
          code?: number | null
          company_id: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          sales_account?: string | null
        }
        Update: {
          code?: number | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          sales_account?: string | null
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
          color: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deee: boolean
          descriptif: string | null
          designation: string
          eco_tax_ttc: number
          equivalence_group: string | null
          id: string
          is_active: boolean
          is_library: boolean
          kit_billing_mode:
            | Database["public"]["Enums"]["kit_billing_mode"]
            | null
          last_purchased_at: string | null
          last_sold_at: string | null
          last_tariff_at: string | null
          main_supplier_id: string | null
          measure_unit: string | null
          mgmt_type: Database["public"]["Enums"]["article_mgmt_type"]
          note: string | null
          origin_reference_id: string | null
          pack_qty: number
          pamp: number
          ppc_ht: number | null
          ppc_ttc: number | null
          price_purchase_locked: boolean
          price_sale_locked: boolean
          publishable: boolean
          purchase_account: string | null
          purchase_price: number
          reference: string
          reprise_category_id: string | null
          reprise_prefix: string | null
          reprise_supplier_id: string | null
          sale_price_ht: number | null
          sale_price_ttc: number
          sales_account: string | null
          show_descriptif_on_documents: boolean
          size: string | null
          stock_max: number
          stock_min: number
          superseded_by_id: string | null
          supplier_ref: string | null
          updated_at: string
          vat_rate: number
          weight_volume_length: number | null
        }
        Insert: {
          bin_location?: string | null
          brand?: string | null
          category_id?: string | null
          category_path?: string | null
          coefficient?: number | null
          color?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deee?: boolean
          descriptif?: string | null
          designation: string
          eco_tax_ttc?: number
          equivalence_group?: string | null
          id?: string
          is_active?: boolean
          is_library?: boolean
          kit_billing_mode?:
            | Database["public"]["Enums"]["kit_billing_mode"]
            | null
          last_purchased_at?: string | null
          last_sold_at?: string | null
          last_tariff_at?: string | null
          main_supplier_id?: string | null
          measure_unit?: string | null
          mgmt_type?: Database["public"]["Enums"]["article_mgmt_type"]
          note?: string | null
          origin_reference_id?: string | null
          pack_qty?: number
          pamp?: number
          ppc_ht?: number | null
          ppc_ttc?: number | null
          price_purchase_locked?: boolean
          price_sale_locked?: boolean
          publishable?: boolean
          purchase_account?: string | null
          purchase_price?: number
          reference: string
          reprise_category_id?: string | null
          reprise_prefix?: string | null
          reprise_supplier_id?: string | null
          sale_price_ht?: number | null
          sale_price_ttc?: number
          sales_account?: string | null
          show_descriptif_on_documents?: boolean
          size?: string | null
          stock_max?: number
          stock_min?: number
          superseded_by_id?: string | null
          supplier_ref?: string | null
          updated_at?: string
          vat_rate?: number
          weight_volume_length?: number | null
        }
        Update: {
          bin_location?: string | null
          brand?: string | null
          category_id?: string | null
          category_path?: string | null
          coefficient?: number | null
          color?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deee?: boolean
          descriptif?: string | null
          designation?: string
          eco_tax_ttc?: number
          equivalence_group?: string | null
          id?: string
          is_active?: boolean
          is_library?: boolean
          kit_billing_mode?:
            | Database["public"]["Enums"]["kit_billing_mode"]
            | null
          last_purchased_at?: string | null
          last_sold_at?: string | null
          last_tariff_at?: string | null
          main_supplier_id?: string | null
          measure_unit?: string | null
          mgmt_type?: Database["public"]["Enums"]["article_mgmt_type"]
          note?: string | null
          origin_reference_id?: string | null
          pack_qty?: number
          pamp?: number
          ppc_ht?: number | null
          ppc_ttc?: number | null
          price_purchase_locked?: boolean
          price_sale_locked?: boolean
          publishable?: boolean
          purchase_account?: string | null
          purchase_price?: number
          reference?: string
          reprise_category_id?: string | null
          reprise_prefix?: string | null
          reprise_supplier_id?: string | null
          sale_price_ht?: number | null
          sale_price_ttc?: number
          sales_account?: string | null
          show_descriptif_on_documents?: boolean
          size?: string | null
          stock_max?: number
          stock_min?: number
          superseded_by_id?: string | null
          supplier_ref?: string | null
          updated_at?: string
          vat_rate?: number
          weight_volume_length?: number | null
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
            foreignKeyName: "articles_origin_reference_id_fkey"
            columns: ["origin_reference_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_reprise_category_id_fkey"
            columns: ["reprise_category_id"]
            isOneToOne: false
            referencedRelation: "article_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_reprise_supplier_id_fkey"
            columns: ["reprise_supplier_id"]
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
      cash_movements: {
        Row: {
          amount: number
          company_id: string
          id: string
          kind: string
          method: string
          occurred_at: string
          operator_id: string | null
          reason: string | null
          session_id: string | null
        }
        Insert: {
          amount: number
          company_id: string
          id?: string
          kind: string
          method?: string
          occurred_at?: string
          operator_id?: string | null
          reason?: string | null
          session_id?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          id?: string
          kind?: string
          method?: string
          occurred_at?: string
          operator_id?: string | null
          reason?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          company_id: string
          counted_cash: number | null
          created_at: string
          denominations: Json
          id: string
          note: string | null
          opened_at: string
          opened_by: string | null
          opening_float: number
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          counted_cash?: number | null
          created_at?: string
          denominations?: Json
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          counted_cash?: number | null
          created_at?: string
          denominations?: Json
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_price_rules: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          date_from: string | null
          date_to: string | null
          id: string
          is_promo: boolean
          mode: string
          qty2: number | null
          qty3: number | null
          target_type: string
          target_value: string | null
          value1: number | null
          value2: number | null
          value3: number | null
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          is_promo?: boolean
          mode?: string
          qty2?: number | null
          qty3?: number | null
          target_type?: string
          target_value?: string | null
          value1?: number | null
          value2?: number | null
          value3?: number | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          is_promo?: boolean
          mode?: string
          qty2?: number | null
          qty3?: number | null
          target_type?: string
          target_value?: string | null
          value1?: number | null
          value2?: number | null
          value3?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_price_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_rules_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
      contact_subcontacts: {
        Row: {
          contact_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          role: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_subcontacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          accounting_account: string | null
          address: string | null
          address_complement: string | null
          address_complement2: string | null
          address_mismatch: boolean
          bic: string | null
          birth_date: string | null
          category: string | null
          city: string | null
          civility: string | null
          code: string | null
          company_id: string
          company_name: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          domiciliation: string | null
          email: string | null
          factoring_code: string | null
          first_name: string | null
          gsm: string | null
          iban: string | null
          id: string
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_blocked: boolean
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
          marketing_opt_out: boolean
          mobile: string | null
          mode_ht: boolean
          national_id: string | null
          national_register: string | null
          notes: string | null
          payment_terms: string | null
          phone: string | null
          po_box: string | null
          price_list: string | null
          receipt_copies: number
          sale_vat_type: Database["public"]["Enums"]["sale_vat_type"]
          segment: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos: boolean
          status: Database["public"]["Enums"]["contact_status"]
          supplier_customer_no: string | null
          supplier_franco_min: number | null
          supplier_is_internal: boolean
          supplier_order_min: number | null
          supplier_rfa_rate: number | null
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          zip: string | null
        }
        Insert: {
          accounting_account?: string | null
          address?: string | null
          address_complement?: string | null
          address_complement2?: string | null
          address_mismatch?: boolean
          bic?: string | null
          birth_date?: string | null
          category?: string | null
          city?: string | null
          civility?: string | null
          code?: string | null
          company_id: string
          company_name?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          domiciliation?: string | null
          email?: string | null
          factoring_code?: string | null
          first_name?: string | null
          gsm?: string | null
          iban?: string | null
          id?: string
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_blocked?: boolean
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
          marketing_opt_out?: boolean
          mobile?: string | null
          mode_ht?: boolean
          national_id?: string | null
          national_register?: string | null
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          po_box?: string | null
          price_list?: string | null
          receipt_copies?: number
          sale_vat_type?: Database["public"]["Enums"]["sale_vat_type"]
          segment?: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos?: boolean
          status?: Database["public"]["Enums"]["contact_status"]
          supplier_customer_no?: string | null
          supplier_franco_min?: number | null
          supplier_is_internal?: boolean
          supplier_order_min?: number | null
          supplier_rfa_rate?: number | null
          type?: Database["public"]["Enums"]["contact_type"]
          updated_at?: string
          vat_number?: string | null
          vies_checked_at?: string | null
          vies_valid?: boolean | null
          zip?: string | null
        }
        Update: {
          accounting_account?: string | null
          address?: string | null
          address_complement?: string | null
          address_complement2?: string | null
          address_mismatch?: boolean
          bic?: string | null
          birth_date?: string | null
          category?: string | null
          city?: string | null
          civility?: string | null
          code?: string | null
          company_id?: string
          company_name?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          domiciliation?: string | null
          email?: string | null
          factoring_code?: string | null
          first_name?: string | null
          gsm?: string | null
          iban?: string | null
          id?: string
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_blocked?: boolean
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
          marketing_opt_out?: boolean
          mobile?: string | null
          mode_ht?: boolean
          national_id?: string | null
          national_register?: string | null
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          po_box?: string | null
          price_list?: string | null
          receipt_copies?: number
          sale_vat_type?: Database["public"]["Enums"]["sale_vat_type"]
          segment?: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos?: boolean
          status?: Database["public"]["Enums"]["contact_status"]
          supplier_customer_no?: string | null
          supplier_franco_min?: number | null
          supplier_is_internal?: boolean
          supplier_order_min?: number | null
          supplier_rfa_rate?: number | null
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
      delivery_addresses: {
        Row: {
          address: string | null
          address_complement: string | null
          city: string | null
          contact_id: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          recipient: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          city?: string | null
          contact_id: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          recipient?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          city?: string | null
          contact_id?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          recipient?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_addresses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      document_lines: {
        Row: {
          article_id: string | null
          created_at: string
          designation: string
          discount_pct: number
          document_id: string
          id: string
          line_ht: number
          line_ttc: number
          quantity: number
          sort_order: number
          unit_price_ht: number
          vat_rate: number
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          designation: string
          discount_pct?: number
          document_id: string
          id?: string
          line_ht?: number
          line_ttc?: number
          quantity?: number
          sort_order?: number
          unit_price_ht?: number
          vat_rate?: number
        }
        Update: {
          article_id?: string | null
          created_at?: string
          designation?: string
          discount_pct?: number
          document_id?: string
          id?: string
          line_ht?: number
          line_ttc?: number
          quantity?: number
          sort_order?: number
          unit_price_ht?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_payments: {
        Row: {
          amount: number
          document_id: string
          due_date: string | null
          given_amount: number | null
          id: string
          method: string
          note: string | null
          paid_at: string
          status: string
        }
        Insert: {
          amount: number
          document_id: string
          due_date?: string | null
          given_amount?: number | null
          id?: string
          method?: string
          note?: string | null
          paid_at?: string
          status?: string
        }
        Update: {
          amount?: number
          document_id?: string
          due_date?: string | null
          given_amount?: number | null
          id?: string
          method?: string
          note?: string | null
          paid_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_payments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
      documents: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          doc_type: string
          due_date: string | null
          forced_ttc: number | null
          global_discount_amount: number
          global_discount_pct: number
          id: string
          issue_date: string
          notes: string | null
          number: string | null
          paid_amount: number
          price_mode: string
          shipping_ht: number
          shipping_taxed: boolean
          shipping_vat_rate: number
          source_document_id: string | null
          status: string
          tax_exempt: boolean
          total_ht: number
          total_ttc: number
          total_vat: number
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          doc_type?: string
          due_date?: string | null
          forced_ttc?: number | null
          global_discount_amount?: number
          global_discount_pct?: number
          id?: string
          issue_date?: string
          notes?: string | null
          number?: string | null
          paid_amount?: number
          price_mode?: string
          shipping_ht?: number
          shipping_taxed?: boolean
          shipping_vat_rate?: number
          source_document_id?: string | null
          status?: string
          tax_exempt?: boolean
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          doc_type?: string
          due_date?: string | null
          forced_ttc?: number | null
          global_discount_amount?: number
          global_discount_pct?: number
          id?: string
          issue_date?: string
          notes?: string | null
          number?: string | null
          paid_amount?: number
          price_mode?: string
          shipping_ht?: number
          shipping_taxed?: boolean
          shipping_vat_rate?: number
          source_document_id?: string | null
          status?: string
          tax_exempt?: boolean
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
      inventory_sessions: {
        Row: {
          closed_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          edition_ecarts: boolean
          effacement: boolean
          id: string
          label: string | null
          magasin_ouvert: boolean
          mode: string
          snapshot_id: string | null
          status: string
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          edition_ecarts?: boolean
          effacement?: boolean
          id?: string
          label?: string | null
          magasin_ouvert?: boolean
          mode?: string
          snapshot_id?: string | null
          status?: string
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          edition_ecarts?: boolean
          effacement?: boolean
          id?: string
          label?: string | null
          magasin_ouvert?: boolean
          mode?: string
          snapshot_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_company_id_fkey"
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
      purchase_lines: {
        Row: {
          article_id: string | null
          bin_location: string | null
          created_at: string
          designation: string
          discount_pct: number
          id: string
          labels: number
          line_ht: number
          order_id: string
          quantity: number
          sale_price_ttc: number | null
          sort_order: number
          supplier_ref: string | null
          unit_price_ht: number
          vat_rate: number
        }
        Insert: {
          article_id?: string | null
          bin_location?: string | null
          created_at?: string
          designation: string
          discount_pct?: number
          id?: string
          labels?: number
          line_ht?: number
          order_id: string
          quantity?: number
          sale_price_ttc?: number | null
          sort_order?: number
          supplier_ref?: string | null
          unit_price_ht?: number
          vat_rate?: number
        }
        Update: {
          article_id?: string | null
          bin_location?: string | null
          created_at?: string
          designation?: string
          discount_pct?: number
          id?: string
          labels?: number
          line_ht?: number
          order_id?: string
          quantity?: number
          sale_price_ttc?: number | null
          sort_order?: number
          supplier_ref?: string | null
          unit_price_ht?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          bl_date: string | null
          company_id: string
          created_at: string
          doc_type: string
          expected_date: string | null
          global_discount_pct: number
          id: string
          intranet_no: string | null
          invoice_date: string | null
          notes: string | null
          number: string | null
          order_date: string | null
          receipt_date: string | null
          shipping_ht: number
          shipping_taxed: boolean
          shipping_vat_rate: number
          source_order_id: string | null
          status: string
          supplier_bl_no: string | null
          supplier_id: string | null
          supplier_invoice_no: string | null
          total_ht: number
          total_ttc: number
          total_vat: number
          updated_at: string
          vat_regime: string
        }
        Insert: {
          bl_date?: string | null
          company_id: string
          created_at?: string
          doc_type?: string
          expected_date?: string | null
          global_discount_pct?: number
          id?: string
          intranet_no?: string | null
          invoice_date?: string | null
          notes?: string | null
          number?: string | null
          order_date?: string | null
          receipt_date?: string | null
          shipping_ht?: number
          shipping_taxed?: boolean
          shipping_vat_rate?: number
          source_order_id?: string | null
          status?: string
          supplier_bl_no?: string | null
          supplier_id?: string | null
          supplier_invoice_no?: string | null
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vat_regime?: string
        }
        Update: {
          bl_date?: string | null
          company_id?: string
          created_at?: string
          doc_type?: string
          expected_date?: string | null
          global_discount_pct?: number
          id?: string
          intranet_no?: string | null
          invoice_date?: string | null
          notes?: string | null
          number?: string | null
          order_date?: string | null
          receipt_date?: string | null
          shipping_ht?: number
          shipping_taxed?: boolean
          shipping_vat_rate?: number
          source_order_id?: string | null
          status?: string
          supplier_bl_no?: string | null
          supplier_id?: string | null
          supplier_invoice_no?: string | null
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vat_regime?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_schedules: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          due_date: string | null
          id: string
          note: string | null
          order_id: string
          seq_no: number
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          note?: string | null
          order_id: string
          seq_no?: number
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          note?: string | null
          order_id?: string
          seq_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_values: {
        Row: {
          code: string
          company_id: string
          created_at: string
          extra: Json
          id: string
          is_active: boolean
          label: string
          sort_order: number
          table_key: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          extra?: Json
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          table_key: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          extra?: Json
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          table_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_values_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_moves: {
        Row: {
          article_id: string
          bin_location: string | null
          company_id: string
          id: number
          is_reservation: boolean
          move_type: Database["public"]["Enums"]["stock_move_type"]
          note: string | null
          occurred_at: string
          operator_id: string | null
          origin: string
          qty_delta: number
          ref: string | null
          unit_cost: number | null
        }
        Insert: {
          article_id: string
          bin_location?: string | null
          company_id: string
          id?: never
          is_reservation?: boolean
          move_type: Database["public"]["Enums"]["stock_move_type"]
          note?: string | null
          occurred_at?: string
          operator_id?: string | null
          origin?: string
          qty_delta: number
          ref?: string | null
          unit_cost?: number | null
        }
        Update: {
          article_id?: string
          bin_location?: string | null
          company_id?: string
          id?: never
          is_reservation?: boolean
          move_type?: Database["public"]["Enums"]["stock_move_type"]
          note?: string | null
          occurred_at?: string
          operator_id?: string | null
          origin?: string
          qty_delta?: number
          ref?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_moves_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_snapshot_lines: {
        Row: {
          article_id: string
          id: string
          pamp: number
          qty: number
          snapshot_id: string
        }
        Insert: {
          article_id: string
          id?: string
          pamp?: number
          qty?: number
          snapshot_id: string
        }
        Update: {
          article_id?: string
          id?: string
          pamp?: number
          qty?: number
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_snapshot_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_snapshot_lines_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "stock_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_snapshots: {
        Row: {
          company_id: string
          created_at: string
          id: string
          kind: string
          label: string | null
          reintegrated: boolean
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          reintegrated?: boolean
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          reintegrated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "stock_snapshots_company_id_fkey"
            columns: ["company_id"]
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
      vehicle_owners: {
        Row: {
          contact_id: string
          created_at: string
          from_date: string
          id: string
          is_current: boolean
          to_date: string | null
          vehicle_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          from_date?: string
          id?: string
          is_current?: boolean
          to_date?: string | null
          vehicle_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          from_date?: string
          id?: string
          is_current?: boolean
          to_date?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_owners_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_owners_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          antipollution: string | null
          antitheft_code: string | null
          article_id: string | null
          autonomy: string | null
          battery_number: string | null
          brand: string | null
          category: string | null
          color: string | null
          color_code: string | null
          company_id: string
          cost_price: number | null
          created_at: string
          created_by: string | null
          cylinders: number | null
          displacement: number | null
          display_price: number | null
          energy: string | null
          engine_number: string | null
          exposition_code: string | null
          first_registration_date: string | null
          fiscal_power: number | null
          formula_number: string | null
          genre: string | null
          gps_tracker_id: string | null
          hours_count: number | null
          id: string
          immat_ww: string | null
          insurance: string | null
          is_active: boolean
          is_restricted: boolean
          key_number: string | null
          key_number2: string | null
          marking: string | null
          marking_date: string | null
          mileage: number | null
          mileage_qualif: Database["public"]["Enums"]["mileage_qualif"] | null
          model: string | null
          model_year: number | null
          next_inspection_date: string | null
          notes: string | null
          origin: string | null
          pin_tracker: string | null
          plate: string | null
          police_book_number: string | null
          power_cv: number | null
          power_kw: number | null
          production_code: string | null
          purchase_price: number | null
          reference: string | null
          segment_type: string | null
          status: Database["public"]["Enums"]["vehicle_status"]
          tpms_ar: string | null
          tpms_av: string | null
          type_mine: string | null
          type_variant_version: string | null
          updated_at: string
          vin: string | null
          warranty_end: string | null
          warranty_type: string | null
        }
        Insert: {
          antipollution?: string | null
          antitheft_code?: string | null
          article_id?: string | null
          autonomy?: string | null
          battery_number?: string | null
          brand?: string | null
          category?: string | null
          color?: string | null
          color_code?: string | null
          company_id: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          cylinders?: number | null
          displacement?: number | null
          display_price?: number | null
          energy?: string | null
          engine_number?: string | null
          exposition_code?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          formula_number?: string | null
          genre?: string | null
          gps_tracker_id?: string | null
          hours_count?: number | null
          id?: string
          immat_ww?: string | null
          insurance?: string | null
          is_active?: boolean
          is_restricted?: boolean
          key_number?: string | null
          key_number2?: string | null
          marking?: string | null
          marking_date?: string | null
          mileage?: number | null
          mileage_qualif?: Database["public"]["Enums"]["mileage_qualif"] | null
          model?: string | null
          model_year?: number | null
          next_inspection_date?: string | null
          notes?: string | null
          origin?: string | null
          pin_tracker?: string | null
          plate?: string | null
          police_book_number?: string | null
          power_cv?: number | null
          power_kw?: number | null
          production_code?: string | null
          purchase_price?: number | null
          reference?: string | null
          segment_type?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          tpms_ar?: string | null
          tpms_av?: string | null
          type_mine?: string | null
          type_variant_version?: string | null
          updated_at?: string
          vin?: string | null
          warranty_end?: string | null
          warranty_type?: string | null
        }
        Update: {
          antipollution?: string | null
          antitheft_code?: string | null
          article_id?: string | null
          autonomy?: string | null
          battery_number?: string | null
          brand?: string | null
          category?: string | null
          color?: string | null
          color_code?: string | null
          company_id?: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          cylinders?: number | null
          displacement?: number | null
          display_price?: number | null
          energy?: string | null
          engine_number?: string | null
          exposition_code?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          formula_number?: string | null
          genre?: string | null
          gps_tracker_id?: string | null
          hours_count?: number | null
          id?: string
          immat_ww?: string | null
          insurance?: string | null
          is_active?: boolean
          is_restricted?: boolean
          key_number?: string | null
          key_number2?: string | null
          marking?: string | null
          marking_date?: string | null
          mileage?: number | null
          mileage_qualif?: Database["public"]["Enums"]["mileage_qualif"] | null
          model?: string | null
          model_year?: number | null
          next_inspection_date?: string | null
          notes?: string | null
          origin?: string | null
          pin_tracker?: string | null
          plate?: string | null
          police_book_number?: string | null
          power_cv?: number | null
          power_kw?: number | null
          production_code?: string | null
          purchase_price?: number | null
          reference?: string | null
          segment_type?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          tpms_ar?: string | null
          tpms_av?: string | null
          type_mine?: string | null
          type_variant_version?: string | null
          updated_at?: string
          vin?: string | null
          warranty_end?: string | null
          warranty_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_company_id_fkey"
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
      article_stock: {
        Args: { _article: string }
        Returns: {
          available_qty: number
          real_qty: number
          reserved_qty: number
        }[]
      }
      article_stock_history: {
        Args: { _article: string }
        Returns: {
          article_id: string
          bin_location: string | null
          company_id: string
          id: number
          is_reservation: boolean
          move_type: Database["public"]["Enums"]["stock_move_type"]
          note: string | null
          occurred_at: string
          operator_id: string | null
          origin: string
          qty_delta: number
          ref: string | null
          unit_cost: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_moves"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      article_stock_list: {
        Args: { _company: string }
        Returns: {
          article_id: string
          available_qty: number
          bin_location: string
          category_path: string
          designation: string
          mgmt_type: string
          pamp: number
          real_qty: number
          reference: string
          reserved_qty: number
          stock_min: number
          stock_value: number
          supplier_id: string
        }[]
      }
      cash_z_report: {
        Args: { _company: string; _from: string; _to: string }
        Returns: Json
      }
      contact_encours: {
        Args: { _contact: string }
        Returns: {
          authorized: number
          available: number
          current_due: number
        }[]
      }
      generate_stock_snapshot: {
        Args: { _company: string; _kind?: string; _label: string }
        Returns: string
      }
      has_role: {
        Args: {
          _company: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      inventory_gaps: {
        Args: { _company: string; _snapshot: string }
        Returns: {
          article_id: string
          designation: string
          gap_qty: number
          gap_value: number
          real_qty: number
          reference: string
          snapshot_qty: number
        }[]
      }
      is_admin: { Args: { _company: string }; Returns: boolean }
      is_member: { Args: { _company: string }; Returns: boolean }
      next_document_number: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
      recompute_document_paid: {
        Args: { _document: string }
        Returns: undefined
      }
      record_inventory_count: {
        Args: {
          _article: string
          _bin?: string
          _counted: number
          _mode: string
        }
        Returns: number
      }
      record_stock_move: {
        Args: {
          _article: string
          _bin?: string
          _is_reservation?: boolean
          _note?: string
          _origin?: string
          _qty: number
          _ref?: string
          _type: Database["public"]["Enums"]["stock_move_type"]
          _unit_cost?: number
        }
        Returns: number
      }
      reintegrate_snapshot: { Args: { _snapshot: string }; Returns: number }
      reorder_proposals: {
        Args: { _company: string }
        Returns: {
          article_id: string
          available_qty: number
          designation: string
          pack_qty: number
          real_qty: number
          reference: string
          stock_max: number
          stock_min: number
          suggested_qty: number
          supplier_id: string
        }[]
      }
      reset_real_stock: {
        Args: { _company: string; _keep_vehicles?: boolean }
        Returns: number
      }
      transfer_stock_on_replace: {
        Args: { _from: string; _to: string }
        Returns: undefined
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
      article_mgmt_type:
        | "A"
        | "M"
        | "F"
        | "N"
        | "V"
        | "O"
        | "P"
        | "D"
        | "R"
        | "T"
      contact_status: "prospect" | "client" | "client_piece" | "client_atelier"
      contact_type:
        | "particulier"
        | "professionnel"
        | "banque_leasing"
        | "fournisseur"
      customer_segment: "standard" | "vip"
      kit_billing_mode: "forfait" | "nomenclature"
      license_category: "AM" | "A1" | "A2" | "A" | "B" | "autre"
      mileage_qualif: "nc" | "reel" | "ng"
      sale_vat_type: "national" | "intracom" | "export"
      stock_move_type:
        | "entree"
        | "sortie"
        | "reservation"
        | "liberation"
        | "inventaire"
        | "transfert"
        | "cession"
        | "correction"
      vehicle_status:
        | "en_commande"
        | "stock_vn"
        | "stock_vo"
        | "depot_vente"
        | "reserve"
        | "vendu"
        | "livre"
        | "courtoisie"
        | "demo"
        | "depot_agent"
        | "repris"
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
      article_mgmt_type: ["A", "M", "F", "N", "V", "O", "P", "D", "R", "T"],
      contact_status: ["prospect", "client", "client_piece", "client_atelier"],
      contact_type: [
        "particulier",
        "professionnel",
        "banque_leasing",
        "fournisseur",
      ],
      customer_segment: ["standard", "vip"],
      kit_billing_mode: ["forfait", "nomenclature"],
      license_category: ["AM", "A1", "A2", "A", "B", "autre"],
      mileage_qualif: ["nc", "reel", "ng"],
      sale_vat_type: ["national", "intracom", "export"],
      stock_move_type: [
        "entree",
        "sortie",
        "reservation",
        "liberation",
        "inventaire",
        "transfert",
        "cession",
        "correction",
      ],
      vehicle_status: [
        "en_commande",
        "stock_vn",
        "stock_vo",
        "depot_vente",
        "reserve",
        "vendu",
        "livre",
        "courtoisie",
        "demo",
        "depot_agent",
        "repris",
      ],
    },
  },
} as const
