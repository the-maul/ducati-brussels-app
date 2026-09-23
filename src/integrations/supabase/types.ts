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
  public: {
    Tables: {
      account_mappings: {
        Row: {
          account_code: string
          company_id: string
          dimension: string
          id: string
          journal_code: string | null
          match_key: string
          updated_at: string
        }
        Insert: {
          account_code: string
          company_id: string
          dimension: string
          id?: string
          journal_code?: string | null
          match_key?: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          company_id?: string
          dimension?: string
          id?: string
          journal_code?: string | null
          match_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_entries: {
        Row: {
          company_id: string
          created_at: string
          doc_number: string | null
          doc_type: string | null
          entry_date: string
          id: string
          journal_code: string
          label: string | null
          source: string
          source_id: string
          transferred_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          doc_number?: string | null
          doc_type?: string | null
          entry_date: string
          id?: string
          journal_code: string
          label?: string | null
          source: string
          source_id: string
          transferred_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          doc_number?: string | null
          doc_type?: string | null
          entry_date?: string
          id?: string
          journal_code?: string
          label?: string | null
          source?: string
          source_id?: string
          transferred_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_entry_lines: {
        Row: {
          account_code: string
          account_label: string | null
          analytic_code: string | null
          auxiliary_code: string | null
          credit: number
          debit: number
          entry_id: string
          id: string
          label: string | null
          line_no: number
          vat_rate: number | null
        }
        Insert: {
          account_code: string
          account_label?: string | null
          analytic_code?: string | null
          auxiliary_code?: string | null
          credit?: number
          debit?: number
          entry_id: string
          id?: string
          label?: string | null
          line_no?: number
          vat_rate?: number | null
        }
        Update: {
          account_code?: string
          account_label?: string | null
          analytic_code?: string | null
          auxiliary_code?: string | null
          credit?: number
          debit?: number
          entry_id?: string
          id?: string
          label?: string | null
          line_no?: number
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_exports: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          period_from: string | null
          period_to: string | null
          reference: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          period_from?: string | null
          period_to?: string | null
          reference?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          period_from?: string | null
          period_to?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_exports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      app_client_waitlist: {
        Row: {
          client_hash: string | null
          company_id: string
          consent_at: string
          consent_text: string
          created_at: string
          email: string
          id: string
          notified_at: string | null
          source: string
        }
        Insert: {
          client_hash?: string | null
          company_id: string
          consent_at?: string
          consent_text: string
          created_at?: string
          email: string
          id?: string
          notified_at?: string | null
          source?: string
        }
        Update: {
          client_hash?: string | null
          company_id?: string
          consent_at?: string
          consent_text?: string
          created_at?: string
          email?: string
          id?: string
          notified_at?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_client_waitlist_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      article_applicabilities: {
        Row: {
          article_id: string | null
          company_id: string
          created_at: string
          gamme: string | null
          id: string
          model: string | null
          model_year: number | null
          quantity: number | null
          reference: string
        }
        Insert: {
          article_id?: string | null
          company_id: string
          created_at?: string
          gamme?: string | null
          id?: string
          model?: string | null
          model_year?: number | null
          quantity?: number | null
          reference: string
        }
        Update: {
          article_id?: string | null
          company_id?: string
          created_at?: string
          gamme?: string | null
          id?: string
          model?: string | null
          model_year?: number | null
          quantity?: number | null
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_applicabilities_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_applicabilities_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "article_applicabilities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
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
          {
            foreignKeyName: "article_barcodes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
          {
            foreignKeyName: "article_bins_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
            foreignKeyName: "article_kit_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "article_kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
        ]
      }
      article_links: {
        Row: {
          article_id: string
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          details: Json
          id: string
          is_auto: boolean
          method: string
          reason: string | null
          score: number
          status: string
          target_kind: string
          target_ref: string
          updated_at: string
        }
        Insert: {
          article_id: string
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: Json
          id?: string
          is_auto?: boolean
          method: string
          reason?: string | null
          score?: number
          status: string
          target_kind: string
          target_ref: string
          updated_at?: string
        }
        Update: {
          article_id?: string
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: Json
          id?: string
          is_auto?: boolean
          method?: string
          reason?: string | null
          score?: number
          status?: string
          target_kind?: string
          target_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "article_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
            foreignKeyName: "article_suppliers_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
          bin_location2: string | null
          brand: string | null
          catalog_url: string | null
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
          supplier_availability: string | null
          supplier_ref: string | null
          to_complete: boolean
          to_complete_source: string | null
          updated_at: string
          vat_rate: number
          vehicle_id: string | null
          web_description: string | null
          web_title: string | null
          weight_volume_length: number | null
        }
        Insert: {
          bin_location?: string | null
          bin_location2?: string | null
          brand?: string | null
          catalog_url?: string | null
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
          supplier_availability?: string | null
          supplier_ref?: string | null
          to_complete?: boolean
          to_complete_source?: string | null
          updated_at?: string
          vat_rate?: number
          vehicle_id?: string | null
          web_description?: string | null
          web_title?: string | null
          weight_volume_length?: number | null
        }
        Update: {
          bin_location?: string | null
          bin_location2?: string | null
          brand?: string | null
          catalog_url?: string | null
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
          supplier_availability?: string | null
          supplier_ref?: string | null
          to_complete?: boolean
          to_complete_source?: string | null
          updated_at?: string
          vat_rate?: number
          vehicle_id?: string | null
          web_description?: string | null
          web_title?: string | null
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
            foreignKeyName: "articles_origin_reference_id_fkey"
            columns: ["origin_reference_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
          {
            foreignKeyName: "articles_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "articles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          alt_text: string | null
          company_id: string
          content_hash: string | null
          content_type: string | null
          created_at: string
          entity_id: string
          entity_type: string
          external_id: string | null
          file_name: string
          folder: string | null
          id: string
          note: string | null
          size_bytes: number | null
          sort_order: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          alt_text?: string | null
          company_id: string
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          external_id?: string | null
          file_name: string
          folder?: string | null
          id?: string
          note?: string | null
          size_bytes?: number | null
          sort_order?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          alt_text?: string | null
          company_id?: string
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          external_id?: string | null
          file_name?: string
          folder?: string | null
          id?: string
          note?: string | null
          size_bytes?: number | null
          sort_order?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      be_postal_codes: {
        Row: {
          city: string
          code: string
          province: string | null
        }
        Insert: {
          city: string
          code: string
          province?: string | null
        }
        Update: {
          city?: string
          code?: string
          province?: string | null
        }
        Relationships: []
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
      chart_of_accounts: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          label: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          label: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_company_id_fkey"
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
      communications: {
        Row: {
          body: string | null
          channel: string
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string
          external_id: string | null
          from_address: string | null
          id: string
          lead_id: string | null
          mailbox: string | null
          occurred_at: string
          subject: string | null
          summarized_at: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          external_id?: string | null
          from_address?: string | null
          id?: string
          lead_id?: string | null
          mailbox?: string | null
          occurred_at?: string
          subject?: string | null
          summarized_at?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          external_id?: string | null
          from_address?: string | null
          id?: string
          lead_id?: string | null
          mailbox?: string | null
          occurred_at?: string
          subject?: string | null
          summarized_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          accounting_start_date: string
          address: string | null
          bic: string | null
          cgv_text: string | null
          city: string | null
          code: string
          country: string | null
          created_at: string
          customer_account_default: string
          iban: string | null
          id: string
          inbound_last_check: string | null
          inbound_mailbox: string | null
          invoice_footer: string | null
          is_active: boolean
          legal_name: string | null
          logo_url: string | null
          mail_signature_address: string | null
          mail_signature_brand: string | null
          mail_signature_phone: string | null
          mail_signature_site_label: string | null
          mail_signature_site_url: string | null
          name: string
          peppol_id: string | null
          round_sale_prices_up: boolean
          sales_account_default: string
          sent_last_check: string | null
          sepa_creditor_id: string | null
          updated_at: string
          vat_account_default: string
          vat_number: string | null
          zip: string | null
        }
        Insert: {
          accounting_start_date?: string
          address?: string | null
          bic?: string | null
          cgv_text?: string | null
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          customer_account_default?: string
          iban?: string | null
          id?: string
          inbound_last_check?: string | null
          inbound_mailbox?: string | null
          invoice_footer?: string | null
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          mail_signature_address?: string | null
          mail_signature_brand?: string | null
          mail_signature_phone?: string | null
          mail_signature_site_label?: string | null
          mail_signature_site_url?: string | null
          name: string
          peppol_id?: string | null
          round_sale_prices_up?: boolean
          sales_account_default?: string
          sent_last_check?: string | null
          sepa_creditor_id?: string | null
          updated_at?: string
          vat_account_default?: string
          vat_number?: string | null
          zip?: string | null
        }
        Update: {
          accounting_start_date?: string
          address?: string | null
          bic?: string | null
          cgv_text?: string | null
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          customer_account_default?: string
          iban?: string | null
          id?: string
          inbound_last_check?: string | null
          inbound_mailbox?: string | null
          invoice_footer?: string | null
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          mail_signature_address?: string | null
          mail_signature_brand?: string | null
          mail_signature_phone?: string | null
          mail_signature_site_label?: string | null
          mail_signature_site_url?: string | null
          name?: string
          peppol_id?: string | null
          round_sale_prices_up?: boolean
          sales_account_default?: string
          sent_last_check?: string | null
          sepa_creditor_id?: string | null
          updated_at?: string
          vat_account_default?: string
          vat_number?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      company_mailboxes: {
        Row: {
          address: string
          company_id: string
          created_at: string
          id: string
          inbound_last_check: string | null
          is_active: boolean
          purpose: string
          sent_last_check: string | null
          signature_name: string | null
          updated_at: string
        }
        Insert: {
          address: string
          company_id: string
          created_at?: string
          id?: string
          inbound_last_check?: string | null
          is_active?: boolean
          purpose?: string
          sent_last_check?: string | null
          signature_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          company_id?: string
          created_at?: string
          id?: string
          inbound_last_check?: string | null
          is_active?: boolean
          purpose?: string
          sent_last_check?: string | null
          signature_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_mailboxes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      consignments: {
        Row: {
          agreed_price: number
          article_id: string | null
          commission_amount: number | null
          commission_pct: number
          company_id: string
          created_at: string
          depositor_id: string | null
          id: string
          notes: string | null
          number: string | null
          sale_document_id: string | null
          sold_at: string | null
          sold_commission: number | null
          sold_reversal: number | null
          status: string
          vehicle_id: string | null
        }
        Insert: {
          agreed_price?: number
          article_id?: string | null
          commission_amount?: number | null
          commission_pct?: number
          company_id: string
          created_at?: string
          depositor_id?: string | null
          id?: string
          notes?: string | null
          number?: string | null
          sale_document_id?: string | null
          sold_at?: string | null
          sold_commission?: number | null
          sold_reversal?: number | null
          status?: string
          vehicle_id?: string | null
        }
        Update: {
          agreed_price?: number
          article_id?: string | null
          commission_amount?: number | null
          commission_pct?: number
          company_id?: string
          created_at?: string
          depositor_id?: string | null
          id?: string
          notes?: string | null
          number?: string | null
          sale_document_id?: string | null
          sold_at?: string | null
          sold_commission?: number | null
          sold_reversal?: number | null
          status?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consignments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "consignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignments_depositor_id_fkey"
            columns: ["depositor_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignments_sale_document_id_fkey"
            columns: ["sale_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_accounts: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          created_by: string | null
          first_portal_visit_at: string | null
          last_portal_visit_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          first_portal_visit_at?: string | null
          last_portal_visit_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          first_portal_visit_at?: string | null
          last_portal_visit_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_accounts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_declared_vehicles: {
        Row: {
          brand: string | null
          company_id: string
          contact_id: string
          created_at: string
          family: string | null
          id: string
          kind: string
          model: string | null
          model_year: number | null
          plate: string | null
          registration_upload_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          brand?: string | null
          company_id: string
          contact_id: string
          created_at?: string
          family?: string | null
          id?: string
          kind: string
          model?: string | null
          model_year?: number | null
          plate?: string | null
          registration_upload_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          status?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          brand?: string | null
          company_id?: string
          contact_id?: string
          created_at?: string
          family?: string | null
          id?: string
          kind?: string
          model?: string | null
          model_year?: number | null
          plate?: string | null
          registration_upload_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_declared_vehicles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_declared_vehicles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_declared_vehicles_registration_upload_id_fkey"
            columns: ["registration_upload_id"]
            isOneToOne: false
            referencedRelation: "portal_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_declared_vehicles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_invitations: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          token: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          token: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          token?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_links: {
        Row: {
          company_id: string
          contact_a: string
          contact_b: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          company_id: string
          contact_a: string
          contact_b: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          company_id?: string
          contact_a?: string
          contact_b?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_links_contact_a_fkey"
            columns: ["contact_a"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_links_contact_b_fkey"
            columns: ["contact_b"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merge_candidates: {
        Row: {
          candidate_id: string
          company_id: string
          contact_id: string
          created_at: string
          id: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          company_id: string
          contact_id: string
          created_at?: string
          id?: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          company_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_merge_candidates_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_merge_candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_merge_candidates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
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
          account_code: string | null
          accounting_account: string | null
          address: string | null
          address_complement: string | null
          address_complement2: string | null
          address_mismatch: boolean
          bic: string | null
          birth_date: string | null
          birth_place: string | null
          category: string | null
          city: string | null
          civility: string | null
          code: string | null
          company_id: string
          company_name: string | null
          contact_name: string | null
          contact_preference: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          delivery_address: string | null
          domiciliation: string | null
          dou: string | null
          ducati_code: string | null
          ducati_url: string | null
          email: string | null
          email_pro: string | null
          external_ref: string | null
          factoring_code: string | null
          fax: string | null
          first_name: string | null
          gsm: string | null
          iban: string | null
          id: string
          imported_from: string | null
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_blocked: boolean
          is_detaxe: boolean
          is_vip: boolean
          is_watch: boolean
          last_name: string | null
          legacy_code: string | null
          legal_form: string | null
          license_category:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date: string | null
          license_number: string | null
          license_place: string | null
          license_scan_path: string | null
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          marketing_opt_out: boolean
          mobile: string | null
          mobile_pro: string | null
          mode_ht: boolean
          model_interests: string[] | null
          my_ducati_city: string | null
          my_ducati_country: string | null
          my_ducati_data: Json | null
          my_ducati_email: string | null
          my_ducati_first_name: string | null
          my_ducati_is_current_owner: boolean | null
          my_ducati_last_name: string | null
          my_ducati_marketing: boolean | null
          my_ducati_phone: string | null
          my_ducati_profiling: boolean | null
          my_ducati_score: number | null
          my_ducati_synced_at: string | null
          national_id: string | null
          national_id_scan_path: string | null
          national_register: string | null
          notes: string | null
          notify_model_stock: boolean | null
          opening_balance: number
          origin: string | null
          payment_terms: string | null
          phone: string | null
          phone_pro: string | null
          po_box: string | null
          price_list: string | null
          receipt_copies: number
          sale_vat_type: Database["public"]["Enums"]["sale_vat_type"]
          segment: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos: boolean
          status: Database["public"]["Enums"]["contact_status"]
          street_number: string | null
          supplier_customer_no: string | null
          supplier_franco_min: number | null
          supplier_is_dcs: boolean
          supplier_is_internal: boolean
          supplier_order_min: number | null
          supplier_order_min_qty: number | null
          supplier_rfa_rate: number | null
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vehicle_preference: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          watch_note: string | null
          zip: string | null
        }
        Insert: {
          account_code?: string | null
          accounting_account?: string | null
          address?: string | null
          address_complement?: string | null
          address_complement2?: string | null
          address_mismatch?: boolean
          bic?: string | null
          birth_date?: string | null
          birth_place?: string | null
          category?: string | null
          city?: string | null
          civility?: string | null
          code?: string | null
          company_id: string
          company_name?: string | null
          contact_name?: string | null
          contact_preference?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          delivery_address?: string | null
          domiciliation?: string | null
          dou?: string | null
          ducati_code?: string | null
          ducati_url?: string | null
          email?: string | null
          email_pro?: string | null
          external_ref?: string | null
          factoring_code?: string | null
          fax?: string | null
          first_name?: string | null
          gsm?: string | null
          iban?: string | null
          id?: string
          imported_from?: string | null
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_blocked?: boolean
          is_detaxe?: boolean
          is_vip?: boolean
          is_watch?: boolean
          last_name?: string | null
          legacy_code?: string | null
          legal_form?: string | null
          license_category?:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date?: string | null
          license_number?: string | null
          license_place?: string | null
          license_scan_path?: string | null
          marketing_consent_at?: string | null
          marketing_consent_source?: string | null
          marketing_opt_out?: boolean
          mobile?: string | null
          mobile_pro?: string | null
          mode_ht?: boolean
          model_interests?: string[] | null
          my_ducati_city?: string | null
          my_ducati_country?: string | null
          my_ducati_data?: Json | null
          my_ducati_email?: string | null
          my_ducati_first_name?: string | null
          my_ducati_is_current_owner?: boolean | null
          my_ducati_last_name?: string | null
          my_ducati_marketing?: boolean | null
          my_ducati_phone?: string | null
          my_ducati_profiling?: boolean | null
          my_ducati_score?: number | null
          my_ducati_synced_at?: string | null
          national_id?: string | null
          national_id_scan_path?: string | null
          national_register?: string | null
          notes?: string | null
          notify_model_stock?: boolean | null
          opening_balance?: number
          origin?: string | null
          payment_terms?: string | null
          phone?: string | null
          phone_pro?: string | null
          po_box?: string | null
          price_list?: string | null
          receipt_copies?: number
          sale_vat_type?: Database["public"]["Enums"]["sale_vat_type"]
          segment?: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos?: boolean
          status?: Database["public"]["Enums"]["contact_status"]
          street_number?: string | null
          supplier_customer_no?: string | null
          supplier_franco_min?: number | null
          supplier_is_dcs?: boolean
          supplier_is_internal?: boolean
          supplier_order_min?: number | null
          supplier_order_min_qty?: number | null
          supplier_rfa_rate?: number | null
          type?: Database["public"]["Enums"]["contact_type"]
          updated_at?: string
          vat_number?: string | null
          vehicle_preference?: string | null
          vies_checked_at?: string | null
          vies_valid?: boolean | null
          watch_note?: string | null
          zip?: string | null
        }
        Update: {
          account_code?: string | null
          accounting_account?: string | null
          address?: string | null
          address_complement?: string | null
          address_complement2?: string | null
          address_mismatch?: boolean
          bic?: string | null
          birth_date?: string | null
          birth_place?: string | null
          category?: string | null
          city?: string | null
          civility?: string | null
          code?: string | null
          company_id?: string
          company_name?: string | null
          contact_name?: string | null
          contact_preference?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          delivery_address?: string | null
          domiciliation?: string | null
          dou?: string | null
          ducati_code?: string | null
          ducati_url?: string | null
          email?: string | null
          email_pro?: string | null
          external_ref?: string | null
          factoring_code?: string | null
          fax?: string | null
          first_name?: string | null
          gsm?: string | null
          iban?: string | null
          id?: string
          imported_from?: string | null
          interests?: string[]
          is_account?: boolean
          is_active?: boolean
          is_blocked?: boolean
          is_detaxe?: boolean
          is_vip?: boolean
          is_watch?: boolean
          last_name?: string | null
          legacy_code?: string | null
          legal_form?: string | null
          license_category?:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date?: string | null
          license_number?: string | null
          license_place?: string | null
          license_scan_path?: string | null
          marketing_consent_at?: string | null
          marketing_consent_source?: string | null
          marketing_opt_out?: boolean
          mobile?: string | null
          mobile_pro?: string | null
          mode_ht?: boolean
          model_interests?: string[] | null
          my_ducati_city?: string | null
          my_ducati_country?: string | null
          my_ducati_data?: Json | null
          my_ducati_email?: string | null
          my_ducati_first_name?: string | null
          my_ducati_is_current_owner?: boolean | null
          my_ducati_last_name?: string | null
          my_ducati_marketing?: boolean | null
          my_ducati_phone?: string | null
          my_ducati_profiling?: boolean | null
          my_ducati_score?: number | null
          my_ducati_synced_at?: string | null
          national_id?: string | null
          national_id_scan_path?: string | null
          national_register?: string | null
          notes?: string | null
          notify_model_stock?: boolean | null
          opening_balance?: number
          origin?: string | null
          payment_terms?: string | null
          phone?: string | null
          phone_pro?: string | null
          po_box?: string | null
          price_list?: string | null
          receipt_copies?: number
          sale_vat_type?: Database["public"]["Enums"]["sale_vat_type"]
          segment?: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos?: boolean
          status?: Database["public"]["Enums"]["contact_status"]
          street_number?: string | null
          supplier_customer_no?: string | null
          supplier_franco_min?: number | null
          supplier_is_dcs?: boolean
          supplier_is_internal?: boolean
          supplier_order_min?: number | null
          supplier_order_min_qty?: number | null
          supplier_rfa_rate?: number | null
          type?: Database["public"]["Enums"]["contact_type"]
          updated_at?: string
          vat_number?: string | null
          vehicle_preference?: string | null
          vies_checked_at?: string | null
          vies_valid?: boolean | null
          watch_note?: string | null
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
      counter_displays: {
        Row: {
          company_id: string
          id: string
          payment_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          id?: string
          payment_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          id?: string
          payment_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counter_displays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_displays_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "document_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_price_rules: {
        Row: {
          article_id: string | null
          category_id: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          label: string | null
          tiers: Json | null
          value: number
        }
        Insert: {
          article_id?: string | null
          category_id?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          label?: string | null
          tiers?: Json | null
          value?: number
        }
        Update: {
          article_id?: string | null
          category_id?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          label?: string | null
          tiers?: Json | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_price_rules_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_price_rules_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "customer_price_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "article_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_price_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_price_rules_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
      document_comment_templates: {
        Row: {
          body: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_comment_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          line_type: string
          quantity: number
          reference: string | null
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
          line_type?: string
          quantity?: number
          reference?: string | null
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
          line_type?: string
          quantity?: number
          reference?: string | null
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
            foreignKeyName: "document_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
          from_financing: boolean
          given_amount: number | null
          id: string
          method: string
          note: string | null
          paid_at: string
          qr_reference: string | null
          received_at: string | null
          received_by: string | null
          status: string
        }
        Insert: {
          amount: number
          document_id: string
          due_date?: string | null
          from_financing?: boolean
          given_amount?: number | null
          id?: string
          method?: string
          note?: string | null
          paid_at?: string
          qr_reference?: string | null
          received_at?: string | null
          received_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          document_id?: string
          due_date?: string | null
          from_financing?: boolean
          given_amount?: number | null
          id?: string
          method?: string
          note?: string | null
          paid_at?: string
          qr_reference?: string | null
          received_at?: string | null
          received_by?: string | null
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
      document_signatures: {
        Row: {
          company_id: string
          document_id: string | null
          id: string
          repair_order_id: string | null
          signature_data: string | null
          signed_at: string
          signed_ip: string | null
          signer_name: string | null
        }
        Insert: {
          company_id: string
          document_id?: string | null
          id?: string
          repair_order_id?: string | null
          signature_data?: string | null
          signed_at?: string
          signed_ip?: string | null
          signer_name?: string | null
        }
        Update: {
          company_id?: string
          document_id?: string | null
          id?: string
          repair_order_id?: string | null
          signature_data?: string | null
          signed_at?: string
          signed_ip?: string | null
          signer_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_signatures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signatures_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signatures_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          code_client_legacy: string | null
          company_id: string
          compta_transferred: boolean
          condition_reglement: string | null
          contact_id: string | null
          created_at: string
          date_transfert: string | null
          doc_type: string
          due_date: string | null
          financing_amount: number
          financing_org_id: string | null
          financing_status: string | null
          forced_ttc: number | null
          global_discount_amount: number
          global_discount_pct: number
          id: string
          imported_from: string | null
          issue_date: string
          legacy_number: string | null
          marge: number | null
          marge_pct: number | null
          notes: string | null
          number: string | null
          operator: string | null
          operator_user_id: string | null
          paid_amount: number
          price_mode: string
          remise_ttc: number | null
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
          code_client_legacy?: string | null
          company_id: string
          compta_transferred?: boolean
          condition_reglement?: string | null
          contact_id?: string | null
          created_at?: string
          date_transfert?: string | null
          doc_type?: string
          due_date?: string | null
          financing_amount?: number
          financing_org_id?: string | null
          financing_status?: string | null
          forced_ttc?: number | null
          global_discount_amount?: number
          global_discount_pct?: number
          id?: string
          imported_from?: string | null
          issue_date?: string
          legacy_number?: string | null
          marge?: number | null
          marge_pct?: number | null
          notes?: string | null
          number?: string | null
          operator?: string | null
          operator_user_id?: string | null
          paid_amount?: number
          price_mode?: string
          remise_ttc?: number | null
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
          code_client_legacy?: string | null
          company_id?: string
          compta_transferred?: boolean
          condition_reglement?: string | null
          contact_id?: string | null
          created_at?: string
          date_transfert?: string | null
          doc_type?: string
          due_date?: string | null
          financing_amount?: number
          financing_org_id?: string | null
          financing_status?: string | null
          forced_ttc?: number | null
          global_discount_amount?: number
          global_discount_pct?: number
          id?: string
          imported_from?: string | null
          issue_date?: string
          legacy_number?: string | null
          marge?: number | null
          marge_pct?: number | null
          notes?: string | null
          number?: string | null
          operator?: string | null
          operator_user_id?: string | null
          paid_amount?: number
          price_mode?: string
          remise_ttc?: number | null
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
            foreignKeyName: "documents_financing_org_id_fkey"
            columns: ["financing_org_id"]
            isOneToOne: false
            referencedRelation: "reference_values"
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
      ducati_catalog_drawing_lines: {
        Row: {
          description: string | null
          drawing_id: string
          end_date: string | null
          has_tempario: boolean | null
          id: number
          item_id: string | null
          line_no: number
          notes: string | null
          part_notes: string | null
          position: string | null
          quantity: number | null
          reference: string | null
          reference_norm: string | null
          replaced: boolean | null
          replaced_part: string | null
          start_date: string | null
          validities: Json | null
        }
        Insert: {
          description?: string | null
          drawing_id: string
          end_date?: string | null
          has_tempario?: boolean | null
          id?: never
          item_id?: string | null
          line_no: number
          notes?: string | null
          part_notes?: string | null
          position?: string | null
          quantity?: number | null
          reference?: string | null
          reference_norm?: string | null
          replaced?: boolean | null
          replaced_part?: string | null
          start_date?: string | null
          validities?: Json | null
        }
        Update: {
          description?: string | null
          drawing_id?: string
          end_date?: string | null
          has_tempario?: boolean | null
          id?: never
          item_id?: string | null
          line_no?: number
          notes?: string | null
          part_notes?: string | null
          position?: string | null
          quantity?: number | null
          reference?: string | null
          reference_norm?: string | null
          replaced?: boolean | null
          replaced_part?: string | null
          start_date?: string | null
          validities?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_drawing_lines_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_drawings"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_catalog_drawings: {
        Row: {
          code: string | null
          description: string | null
          hotspots: Json
          id: string
          image_url: string | null
          original_image_url: string | null
          parts_count: number | null
          parts_loaded_at: string | null
          source_model_year_id: string | null
          thumbnail_url: string | null
          updated_at: string
          validities: Json | null
        }
        Insert: {
          code?: string | null
          description?: string | null
          hotspots?: Json
          id: string
          image_url?: string | null
          original_image_url?: string | null
          parts_count?: number | null
          parts_loaded_at?: string | null
          source_model_year_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          validities?: Json | null
        }
        Update: {
          code?: string | null
          description?: string | null
          hotspots?: Json
          id?: string
          image_url?: string | null
          original_image_url?: string | null
          parts_count?: number | null
          parts_loaded_at?: string | null
          source_model_year_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          validities?: Json | null
        }
        Relationships: []
      }
      ducati_catalog_families: {
        Row: {
          description: string
          id: string
          sort: number | null
          updated_at: string
        }
        Insert: {
          description: string
          id: string
          sort?: number | null
          updated_at?: string
        }
        Update: {
          description?: string
          id?: string
          sort?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ducati_catalog_groups: {
        Row: {
          code: string | null
          description: string | null
          id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          description?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          description?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ducati_catalog_import_batches: {
        Row: {
          company_id: string | null
          drawings_imported: number
          drawings_skipped: number
          finished_at: string | null
          id: string
          last_error: string | null
          last_position: Json | null
          lines_imported: number
          model_years_done: number
          model_years_total: number
          products_imported: number
          products_skipped: number
          requests_count: number
          scope: Json
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
          variants_imported: number
        }
        Insert: {
          company_id?: string | null
          drawings_imported?: number
          drawings_skipped?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_position?: Json | null
          lines_imported?: number
          model_years_done?: number
          model_years_total?: number
          products_imported?: number
          products_skipped?: number
          requests_count?: number
          scope?: Json
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          variants_imported?: number
        }
        Update: {
          company_id?: string | null
          drawings_imported?: number
          drawings_skipped?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_position?: Json | null
          lines_imported?: number
          model_years_done?: number
          model_years_total?: number
          products_imported?: number
          products_skipped?: number
          requests_count?: number
          scope?: Json
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          variants_imported?: number
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_catalog_model_year_drawings: {
        Row: {
          drawing_id: string
          group_id: string
          group_sort: number | null
          model_year_id: string
          sort: number | null
        }
        Insert: {
          drawing_id: string
          group_id: string
          group_sort?: number | null
          model_year_id: string
          sort?: number | null
        }
        Update: {
          drawing_id?: string
          group_id?: string
          group_sort?: number | null
          model_year_id?: string
          sort?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_model_year_drawings_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ducati_catalog_model_year_drawings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ducati_catalog_model_year_drawings_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_catalog_model_years: {
        Row: {
          code: string | null
          complete_at: string | null
          drawings_count: number | null
          groups_loaded_at: string | null
          id: string
          model_id: string
          name: string | null
          path: string | null
          sort: number | null
          updated_at: string
          year: number | null
        }
        Insert: {
          code?: string | null
          complete_at?: string | null
          drawings_count?: number | null
          groups_loaded_at?: string | null
          id: string
          model_id: string
          name?: string | null
          path?: string | null
          sort?: number | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          code?: string | null
          complete_at?: string | null
          drawings_count?: number | null
          groups_loaded_at?: string | null
          id?: string
          model_id?: string
          name?: string | null
          path?: string | null
          sort?: number | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_model_years_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_models"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_catalog_models: {
        Row: {
          description: string
          family_id: string
          id: string
          is_europe: boolean
          market: string
          sort: number | null
          supermodel_id: string
          updated_at: string
        }
        Insert: {
          description: string
          family_id: string
          id: string
          is_europe?: boolean
          market?: string
          sort?: number | null
          supermodel_id: string
          updated_at?: string
        }
        Update: {
          description?: string
          family_id?: string
          id?: string
          is_europe?: boolean
          market?: string
          sort?: number | null
          supermodel_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_models_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ducati_catalog_models_supermodel_id_fkey"
            columns: ["supermodel_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_supermodels"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_catalog_parts: {
        Row: {
          catalog_price_ht: number | null
          catalog_price_ttc: number | null
          description: string | null
          discount_group: string | null
          ean_code: string | null
          has_tempario: boolean | null
          min_quantity: number | null
          price_seen_at: string | null
          reference: string
          reference_norm: string
          replaced: boolean | null
          replaced_part: string | null
          replacement_tree: Json | null
          updated_at: string
        }
        Insert: {
          catalog_price_ht?: number | null
          catalog_price_ttc?: number | null
          description?: string | null
          discount_group?: string | null
          ean_code?: string | null
          has_tempario?: boolean | null
          min_quantity?: number | null
          price_seen_at?: string | null
          reference: string
          reference_norm: string
          replaced?: boolean | null
          replaced_part?: string | null
          replacement_tree?: Json | null
          updated_at?: string
        }
        Update: {
          catalog_price_ht?: number | null
          catalog_price_ttc?: number | null
          description?: string | null
          discount_group?: string | null
          ean_code?: string | null
          has_tempario?: boolean | null
          min_quantity?: number | null
          price_seen_at?: string | null
          reference?: string
          reference_norm?: string
          replaced?: boolean | null
          replaced_part?: string | null
          replacement_tree?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      ducati_catalog_product_applicabilities: {
        Row: {
          family: string | null
          hierarchy_path: string
          is_europe: boolean
          model: string | null
          model_year: number | null
          product_code: string
          sku_norm: string
          supermodel: string | null
        }
        Insert: {
          family?: string | null
          hierarchy_path: string
          is_europe?: boolean
          model?: string | null
          model_year?: number | null
          product_code: string
          sku_norm: string
          supermodel?: string | null
        }
        Update: {
          family?: string | null
          hierarchy_path?: string
          is_europe?: boolean
          model?: string | null
          model_year?: number | null
          product_code?: string
          sku_norm?: string
          supermodel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_product_applicabilities_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_products"
            referencedColumns: ["code"]
          },
        ]
      }
      ducati_catalog_product_variants: {
        Row: {
          archived: boolean | null
          attributes: Json
          collection_year: number | null
          color: string | null
          description: string | null
          images: Json
          is_kit: boolean | null
          mother_code: string | null
          name: string | null
          price_ht: number | null
          price_seen_at: string | null
          price_ttc: number | null
          product_code: string
          replaced: boolean | null
          size: string | null
          sku: string
          sku_norm: string
          updated_at: string
          variant_code: string | null
        }
        Insert: {
          archived?: boolean | null
          attributes?: Json
          collection_year?: number | null
          color?: string | null
          description?: string | null
          images?: Json
          is_kit?: boolean | null
          mother_code?: string | null
          name?: string | null
          price_ht?: number | null
          price_seen_at?: string | null
          price_ttc?: number | null
          product_code: string
          replaced?: boolean | null
          size?: string | null
          sku: string
          sku_norm: string
          updated_at?: string
          variant_code?: string | null
        }
        Update: {
          archived?: boolean | null
          attributes?: Json
          collection_year?: number | null
          color?: string | null
          description?: string | null
          images?: Json
          is_kit?: boolean | null
          mother_code?: string | null
          name?: string | null
          price_ht?: number | null
          price_seen_at?: string | null
          price_ttc?: number | null
          product_code?: string
          replaced?: boolean | null
          size?: string | null
          sku?: string
          sku_norm?: string
          updated_at?: string
          variant_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_product_variants_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_products"
            referencedColumns: ["code"]
          },
        ]
      }
      ducati_catalog_products: {
        Row: {
          archived: boolean | null
          attributes: Json
          category_label: string | null
          category_path: string | null
          code: string
          description: string | null
          detail_loaded_at: string | null
          discount_group: string | null
          ducati_id: string | null
          family_codes: string[]
          gender: string | null
          image_url: string | null
          images: Json
          kind: string
          last_chance: boolean | null
          name: string | null
          price_ht: number | null
          price_seen_at: string | null
          price_ttc: number | null
          updated_at: string
        }
        Insert: {
          archived?: boolean | null
          attributes?: Json
          category_label?: string | null
          category_path?: string | null
          code: string
          description?: string | null
          detail_loaded_at?: string | null
          discount_group?: string | null
          ducati_id?: string | null
          family_codes?: string[]
          gender?: string | null
          image_url?: string | null
          images?: Json
          kind: string
          last_chance?: boolean | null
          name?: string | null
          price_ht?: number | null
          price_seen_at?: string | null
          price_ttc?: number | null
          updated_at?: string
        }
        Update: {
          archived?: boolean | null
          attributes?: Json
          category_label?: string | null
          category_path?: string | null
          code?: string
          description?: string | null
          detail_loaded_at?: string | null
          discount_group?: string | null
          ducati_id?: string | null
          family_codes?: string[]
          gender?: string | null
          image_url?: string | null
          images?: Json
          kind?: string
          last_chance?: boolean | null
          name?: string | null
          price_ht?: number | null
          price_seen_at?: string | null
          price_ttc?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ducati_catalog_supermodels: {
        Row: {
          description: string
          family_id: string
          id: string
          sort: number | null
          updated_at: string
        }
        Insert: {
          description: string
          family_id: string
          id: string
          sort?: number | null
          updated_at?: string
        }
        Update: {
          description?: string
          family_id?: string
          id?: string
          sort?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ducati_catalog_supermodels_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_families"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_vds: {
        Row: {
          displacement_cc: number | null
          euro: string | null
          model: string | null
          power_cv: number | null
          samples: number
          source: string
          updated_at: string
          vds: string
        }
        Insert: {
          displacement_cc?: number | null
          euro?: string | null
          model?: string | null
          power_cv?: number | null
          samples?: number
          source?: string
          updated_at?: string
          vds: string
        }
        Update: {
          displacement_cc?: number | null
          euro?: string | null
          model?: string | null
          power_cv?: number | null
          samples?: number
          source?: string
          updated_at?: string
          vds?: string
        }
        Relationships: []
      }
      ducati_vin_facts: {
        Row: {
          antipollution: string | null
          category: string | null
          color: string | null
          cylinders: number | null
          displacement: number | null
          engine_number: string | null
          first_registration_date: string | null
          mileage: number | null
          model: string | null
          model_year: number | null
          origin: string | null
          plate: string | null
          power_cv: number | null
          reference: string | null
          source: string
          updated_at: string
          vin: string
          warranty_end: string | null
        }
        Insert: {
          antipollution?: string | null
          category?: string | null
          color?: string | null
          cylinders?: number | null
          displacement?: number | null
          engine_number?: string | null
          first_registration_date?: string | null
          mileage?: number | null
          model?: string | null
          model_year?: number | null
          origin?: string | null
          plate?: string | null
          power_cv?: number | null
          reference?: string | null
          source?: string
          updated_at?: string
          vin: string
          warranty_end?: string | null
        }
        Update: {
          antipollution?: string | null
          category?: string | null
          color?: string | null
          cylinders?: number | null
          displacement?: number | null
          engine_number?: string | null
          first_registration_date?: string | null
          mileage?: number | null
          model?: string | null
          model_year?: number | null
          origin?: string | null
          plate?: string | null
          power_cv?: number | null
          reference?: string | null
          source?: string
          updated_at?: string
          vin?: string
          warranty_end?: string | null
        }
        Relationships: []
      }
      ducati_vin_model_specs: {
        Row: {
          cylinders: number | null
          displacement_cc: number | null
          euro: string | null
          model_year_id: string
          power_cv: number | null
          power_kw: number | null
          samples: number
          updated_at: string
        }
        Insert: {
          cylinders?: number | null
          displacement_cc?: number | null
          euro?: string | null
          model_year_id: string
          power_cv?: number | null
          power_kw?: number | null
          samples?: number
          updated_at?: string
        }
        Update: {
          cylinders?: number | null
          displacement_cc?: number | null
          euro?: string | null
          model_year_id?: string
          power_cv?: number | null
          power_kw?: number | null
          samples?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ducati_vin_model_specs_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: true
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_vin_patterns: {
        Row: {
          model_year_id: string
          pattern: string
          samples: number
          serial_from: number
          serial_to: number
          updated_at: string
        }
        Insert: {
          model_year_id: string
          pattern: string
          samples?: number
          serial_from?: number
          serial_to?: number
          updated_at?: string
        }
        Update: {
          model_year_id?: string
          pattern?: string
          samples?: number
          serial_from?: number
          serial_to?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ducati_vin_patterns_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
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
      excel_catalog: {
        Row: {
          availability: string | null
          category: string | null
          company_id: string
          created_at: string
          description: string | null
          discount_class: string | null
          family: string | null
          id: string
          models: string | null
          price_dealer: number | null
          price_public_ht: number | null
          reference: string
        }
        Insert: {
          availability?: string | null
          category?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          discount_class?: string | null
          family?: string | null
          id?: string
          models?: string | null
          price_dealer?: number | null
          price_public_ht?: number | null
          reference: string
        }
        Update: {
          availability?: string | null
          category?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          discount_class?: string | null
          family?: string | null
          id?: string
          models?: string | null
          price_dealer?: number | null
          price_public_ht?: number | null
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "excel_catalog_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      excel_order_lines: {
        Row: {
          catalog_id: string | null
          contact_id: string | null
          created_at: string
          description: string | null
          excel_order_id: string
          extra_discount: number
          id: string
          moto_label: string | null
          moto_vin: string | null
          part_order_id: string | null
          part_order_line_id: string | null
          price_dealer: number
          qty: number
          reference: string
          sort_order: number
          tab: string
        }
        Insert: {
          catalog_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          excel_order_id: string
          extra_discount?: number
          id?: string
          moto_label?: string | null
          moto_vin?: string | null
          part_order_id?: string | null
          part_order_line_id?: string | null
          price_dealer?: number
          qty?: number
          reference: string
          sort_order?: number
          tab?: string
        }
        Update: {
          catalog_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          excel_order_id?: string
          extra_discount?: number
          id?: string
          moto_label?: string | null
          moto_vin?: string | null
          part_order_id?: string | null
          part_order_line_id?: string | null
          price_dealer?: number
          qty?: number
          reference?: string
          sort_order?: number
          tab?: string
        }
        Relationships: [
          {
            foreignKeyName: "excel_order_lines_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "excel_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_order_lines_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_order_lines_excel_order_id_fkey"
            columns: ["excel_order_id"]
            isOneToOne: false
            referencedRelation: "excel_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_order_lines_part_order_id_fkey"
            columns: ["part_order_id"]
            isOneToOne: false
            referencedRelation: "part_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_order_lines_part_order_line_id_fkey"
            columns: ["part_order_line_id"]
            isOneToOne: false
            referencedRelation: "part_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      excel_orders: {
        Row: {
          archive_attachment_id: string | null
          archive_path: string | null
          archived_at: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          dealer_code: string | null
          dealer_name: string | null
          download_count: number
          downloaded_at: string | null
          id: string
          notes: string | null
          number: string | null
          part_order_id: string | null
          status: string
          tab_totals: Json | null
          updated_at: string
        }
        Insert: {
          archive_attachment_id?: string | null
          archive_path?: string | null
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          dealer_code?: string | null
          dealer_name?: string | null
          download_count?: number
          downloaded_at?: string | null
          id?: string
          notes?: string | null
          number?: string | null
          part_order_id?: string | null
          status?: string
          tab_totals?: Json | null
          updated_at?: string
        }
        Update: {
          archive_attachment_id?: string | null
          archive_path?: string | null
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          dealer_code?: string | null
          dealer_name?: string | null
          download_count?: number
          downloaded_at?: string | null
          id?: string
          notes?: string | null
          number?: string | null
          part_order_id?: string | null
          status?: string
          tab_totals?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "excel_orders_archive_attachment_id_fkey"
            columns: ["archive_attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_orders_part_order_id_fkey"
            columns: ["part_order_id"]
            isOneToOne: false
            referencedRelation: "part_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_closures: {
        Row: {
          closed_at: string
          closed_by: string | null
          company_id: string
          id: string
          label: string | null
          period_from: string
          period_to: string
          snapshot_id: string | null
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          company_id: string
          id?: string
          label?: string | null
          period_from: string
          period_to: string
          snapshot_id?: string | null
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          company_id?: string
          id?: string
          label?: string | null
          period_from?: string
          period_to?: string
          snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_closures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_closures_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "stock_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_import_lines: {
        Row: {
          applied_delta: number | null
          article_id: string | null
          avail_qty: number | null
          barcode: string | null
          bin_location: string | null
          categorie: string | null
          designation: string | null
          id: number
          import_id: string
          last_in: string | null
          last_out: string | null
          line_no: number
          match_kind: string | null
          message: string | null
          move_id: number | null
          pamp: number | null
          rayon: string | null
          real_qty: number
          reference: string
          reference_norm: string
          sous_rayon: string | null
          state: string
          stock_value: number | null
          supplier: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          applied_delta?: number | null
          article_id?: string | null
          avail_qty?: number | null
          barcode?: string | null
          bin_location?: string | null
          categorie?: string | null
          designation?: string | null
          id?: never
          import_id: string
          last_in?: string | null
          last_out?: string | null
          line_no: number
          match_kind?: string | null
          message?: string | null
          move_id?: number | null
          pamp?: number | null
          rayon?: string | null
          real_qty: number
          reference: string
          reference_norm: string
          sous_rayon?: string | null
          state?: string
          stock_value?: number | null
          supplier?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          applied_delta?: number | null
          article_id?: string | null
          avail_qty?: number | null
          barcode?: string | null
          bin_location?: string | null
          categorie?: string | null
          designation?: string | null
          id?: never
          import_id?: string
          last_in?: string | null
          last_out?: string | null
          line_no?: number
          match_kind?: string | null
          message?: string | null
          move_id?: number | null
          pamp?: number | null
          rayon?: string | null
          real_qty?: number
          reference?: string
          reference_norm?: string
          sous_rayon?: string | null
          state?: string
          stock_value?: number | null
          supplier?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_import_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_import_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "inventory_import_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "inventory_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_import_lines_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_imports: {
        Row: {
          applied_at: string | null
          company_id: string
          counted_at: string
          created_at: string
          created_by: string | null
          id: string
          origin: string
          ref: string | null
          source_file: string | null
          stats: Json | null
        }
        Insert: {
          applied_at?: string | null
          company_id: string
          counted_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          origin: string
          ref?: string | null
          source_file?: string | null
          stats?: Json | null
        }
        Update: {
          applied_at?: string | null
          company_id?: string
          counted_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          origin?: string
          ref?: string | null
          source_file?: string | null
          stats?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_imports_company_id_fkey"
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
      label_queue: {
        Row: {
          article_id: string
          company_id: string
          created_at: string
          id: number
          operator_id: string | null
          printed: boolean
          qty: number
          with_barcode: boolean
          with_price: boolean
        }
        Insert: {
          article_id: string
          company_id: string
          created_at?: string
          id?: never
          operator_id?: string | null
          printed?: boolean
          qty?: number
          with_barcode?: boolean
          with_price?: boolean
        }
        Update: {
          article_id?: string
          company_id?: string
          created_at?: string
          id?: never
          operator_id?: string | null
          printed?: boolean
          qty?: number
          with_barcode?: boolean
          with_price?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "label_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "label_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      label_templates: {
        Row: {
          company_id: string
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
        }
        Insert: {
          company_id: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
        }
        Update: {
          company_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tasks: {
        Row: {
          assigned_to: string
          company_id: string
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          due_at: string
          id: string
          lead_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          company_id: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_at: string
          id?: string
          lead_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_at?: string
          id?: string
          lead_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_to: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          due_at: string | null
          email: string | null
          estimated_value: number | null
          id: string
          last_activity_at: string | null
          name: string
          notes: string | null
          phone: string | null
          pipeline: string
          source: string | null
          stage: string
          updated_at: string
          vehicle_interest: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_to?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          due_at?: string | null
          email?: string | null
          estimated_value?: number | null
          id?: string
          last_activity_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          pipeline?: string
          source?: string | null
          stage?: string
          updated_at?: string
          vehicle_interest?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_to?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          due_at?: string | null
          email?: string | null
          estimated_value?: number | null
          id?: string
          last_activity_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          pipeline?: string
          source?: string | null
          stage?: string
          updated_at?: string
          vehicle_interest?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_checklists: {
        Row: {
          columns: Json
          footnotes: Json
          id: string
          note: string | null
          source_edition: string | null
          source_file: string | null
          source_page: number | null
          title: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          footnotes?: Json
          id: string
          note?: string | null
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          footnotes?: Json
          id?: string
          note?: string | null
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_fluid_articles: {
        Row: {
          article_id: string
          company_id: string
          family_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          article_id: string
          company_id: string
          family_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          article_id?: string
          company_id?: string
          family_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_fluid_articles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_fluid_articles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "maintenance_fluid_articles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_fluid_articles_family_code_fkey"
            columns: ["family_code"]
            isOneToOne: false
            referencedRelation: "maintenance_part_families"
            referencedColumns: ["code"]
          },
        ]
      }
      maintenance_fluid_rules: {
        Row: {
          element_re: string
          family_code: string
          id: string
          sort: number
        }
        Insert: {
          element_re: string
          family_code: string
          id?: string
          sort?: number
        }
        Update: {
          element_re?: string
          family_code?: string
          id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_fluid_rules_family_code_fkey"
            columns: ["family_code"]
            isOneToOne: false
            referencedRelation: "maintenance_part_families"
            referencedColumns: ["code"]
          },
        ]
      }
      maintenance_kit_items: {
        Row: {
          article_id: string | null
          company_id: string
          confidence: string
          created_at: string
          designation: string
          family_code: string | null
          fluid_product: string | null
          fluid_spec: string | null
          id: string
          kind: string
          kit_id: string
          note: string | null
          origin: string
          quantity: number
          reference: string | null
          sort_order: number
          unit: string | null
        }
        Insert: {
          article_id?: string | null
          company_id: string
          confidence?: string
          created_at?: string
          designation: string
          family_code?: string | null
          fluid_product?: string | null
          fluid_spec?: string | null
          id?: string
          kind?: string
          kit_id: string
          note?: string | null
          origin?: string
          quantity?: number
          reference?: string | null
          sort_order?: number
          unit?: string | null
        }
        Update: {
          article_id?: string | null
          company_id?: string
          confidence?: string
          created_at?: string
          designation?: string
          family_code?: string | null
          fluid_product?: string | null
          fluid_spec?: string | null
          id?: string
          kind?: string
          kit_id?: string
          note?: string | null
          origin?: string
          quantity?: number
          reference?: string | null
          sort_order?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_kit_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_kit_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "maintenance_kit_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_kit_items_family_code_fkey"
            columns: ["family_code"]
            isOneToOne: false
            referencedRelation: "maintenance_part_families"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "maintenance_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_kit_model_years: {
        Row: {
          kit_id: string
          model_year_id: string
        }
        Insert: {
          kit_id: string
          model_year_id: string
        }
        Update: {
          kit_id?: string
          model_year_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_kit_model_years_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "maintenance_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_kit_model_years_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_kit_versions: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          id: string
          items: Json
          kit_id: string
          reason: string | null
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          id?: string
          items: Json
          kit_id: string
          reason?: string | null
          version: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          id?: string
          items?: Json
          kit_id?: string
          reason?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_kit_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_kit_versions_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "maintenance_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_kits: {
        Row: {
          company_id: string
          content_hash: string
          created_at: string
          edited_at: string | null
          edited_by: string | null
          engine_family_key: string
          engine_family_label: string
          generated_at: string
          id: string
          note: string | null
          service_code: string
          service_label: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          company_id: string
          content_hash: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          engine_family_key: string
          engine_family_label: string
          generated_at?: string
          id?: string
          note?: string | null
          service_code: string
          service_label: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string
          content_hash?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          engine_family_key?: string
          engine_family_label?: string
          generated_at?: string
          id?: string
          note?: string | null
          service_code?: string
          service_label?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_kits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_part_catalog_rules: {
        Row: {
          drawing_exclude_re: string | null
          drawing_re: string | null
          exclude_re: string | null
          family_code: string
          id: string
          include_re: string
          sort: number
          take_all: boolean
        }
        Insert: {
          drawing_exclude_re?: string | null
          drawing_re?: string | null
          exclude_re?: string | null
          family_code: string
          id?: string
          include_re: string
          sort?: number
          take_all?: boolean
        }
        Update: {
          drawing_exclude_re?: string | null
          drawing_re?: string | null
          exclude_re?: string | null
          family_code?: string
          id?: string
          include_re?: string
          sort?: number
          take_all?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_part_catalog_rules_family_code_fkey"
            columns: ["family_code"]
            isOneToOne: false
            referencedRelation: "maintenance_part_families"
            referencedColumns: ["code"]
          },
        ]
      }
      maintenance_part_families: {
        Row: {
          code: string
          kind: string
          label: string
          optional: boolean
          sort: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          code: string
          kind: string
          label: string
          optional?: boolean
          sort?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          kind?: string
          label?: string
          optional?: boolean
          sort?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_part_need_rules: {
        Row: {
          family_code: string
          id: string
          note: string | null
          pattern: string
          sort: number
        }
        Insert: {
          family_code: string
          id?: string
          note?: string | null
          pattern: string
          sort?: number
        }
        Update: {
          family_code?: string
          id?: string
          note?: string | null
          pattern?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_part_need_rules_family_code_fkey"
            columns: ["family_code"]
            isOneToOne: false
            referencedRelation: "maintenance_part_families"
            referencedColumns: ["code"]
          },
        ]
      }
      maintenance_plan_catalog_links: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          id: string
          model_year_id: string
          origin: string
          plan_id: string
          proposed_at: string
          reason: string | null
          status: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          model_year_id: string
          origin?: string
          plan_id: string
          proposed_at?: string
          reason?: string | null
          status: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          model_year_id?: string
          origin?: string
          plan_id?: string
          proposed_at?: string
          reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_plan_catalog_links_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_plan_catalog_links_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_plan_services: {
        Row: {
          code: string
          doc_names: string[]
          id: string
          name: string
          operations_note: string | null
          plan_id: string
          sort: number
          updated_at: string
        }
        Insert: {
          code: string
          doc_names?: string[]
          id?: string
          name: string
          operations_note?: string | null
          plan_id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          code?: string
          doc_names?: string[]
          id?: string
          name?: string
          operations_note?: string | null
          plan_id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_plan_services_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_plans: {
        Row: {
          checklist_history: Json
          checklist_id: string | null
          content_hash: string
          family: string
          id: string
          loaded_at: string
          match_names: string[]
          model_text: string
          notes: Json
          own_interval_operations: Json
          source_files: string[]
          updated_at: string
          usage: string
          variants: string[]
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          checklist_history?: Json
          checklist_id?: string | null
          content_hash: string
          family: string
          id: string
          loaded_at?: string
          match_names?: string[]
          model_text: string
          notes?: Json
          own_interval_operations?: Json
          source_files?: string[]
          updated_at?: string
          usage?: string
          variants?: string[]
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          checklist_history?: Json
          checklist_id?: string | null
          content_hash?: string
          family?: string
          id?: string
          loaded_at?: string
          match_names?: string[]
          model_text?: string
          notes?: Json
          own_interval_operations?: Json
          source_files?: string[]
          updated_at?: string
          usage?: string
          variants?: string[]
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_plans_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "maintenance_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_intervals: {
        Row: {
          deduced: string | null
          first_reached: boolean
          first_reached_origin: string | null
          id: string
          km_column: number | null
          km_first: number | null
          km_interval: number | null
          months: number | null
          replaced_by: string | null
          row_key: string
          same_value: boolean | null
          service_id: string
          sort: number
          source_edition: string | null
          source_file: string | null
          source_page: number | null
          source_sort: string | null
          status: string
          text: string | null
          years_doc: string | null
        }
        Insert: {
          deduced?: string | null
          first_reached?: boolean
          first_reached_origin?: string | null
          id?: string
          km_column?: number | null
          km_first?: number | null
          km_interval?: number | null
          months?: number | null
          replaced_by?: string | null
          row_key: string
          same_value?: boolean | null
          service_id: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          source_sort?: string | null
          status: string
          text?: string | null
          years_doc?: string | null
        }
        Update: {
          deduced?: string | null
          first_reached?: boolean
          first_reached_origin?: string | null
          id?: string
          km_column?: number | null
          km_first?: number | null
          km_interval?: number | null
          months?: number | null
          replaced_by?: string | null
          row_key?: string
          same_value?: boolean | null
          service_id?: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          source_sort?: string | null
          status?: string
          text?: string | null
          years_doc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_intervals_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plan_services"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_operations: {
        Row: {
          id: string
          n: number | null
          parts_cited: Json
          periodicity_deduced: string | null
          periodicity_months: number | null
          reference_mark: string | null
          remark: string | null
          row_key: string
          service_id: string
          sort: number
          source_edition: string | null
          source_file: string | null
          source_page: number | null
          text: string
        }
        Insert: {
          id?: string
          n?: number | null
          parts_cited?: Json
          periodicity_deduced?: string | null
          periodicity_months?: number | null
          reference_mark?: string | null
          remark?: string | null
          row_key: string
          service_id: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          text: string
        }
        Update: {
          id?: string
          n?: number | null
          parts_cited?: Json
          periodicity_deduced?: string | null
          periodicity_months?: number | null
          reference_mark?: string | null
          remark?: string | null
          row_key?: string
          service_id?: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_operations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plan_services"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_times: {
        Row: {
          deduced: string | null
          hours: number | null
          id: string
          interval_doc: string | null
          model_doc: string | null
          note: string | null
          replaced_by: string | null
          row_key: string
          same_value: boolean | null
          service_doc: string | null
          service_id: string
          sort: number
          source_edition: string | null
          source_file: string | null
          source_page: number | null
          source_sort: string | null
          status: string
          time_text: string | null
          ut: number | null
          years_doc: string | null
        }
        Insert: {
          deduced?: string | null
          hours?: number | null
          id?: string
          interval_doc?: string | null
          model_doc?: string | null
          note?: string | null
          replaced_by?: string | null
          row_key: string
          same_value?: boolean | null
          service_doc?: string | null
          service_id: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          source_sort?: string | null
          status: string
          time_text?: string | null
          ut?: number | null
          years_doc?: string | null
        }
        Update: {
          deduced?: string | null
          hours?: number | null
          id?: string
          interval_doc?: string | null
          model_doc?: string | null
          note?: string | null
          replaced_by?: string | null
          row_key?: string
          same_value?: boolean | null
          service_doc?: string | null
          service_id?: string
          sort?: number
          source_edition?: string | null
          source_file?: string | null
          source_page?: number | null
          source_sort?: string | null
          status?: string
          time_text?: string | null
          ut?: number | null
          years_doc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_times_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plan_services"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_sources: {
        Row: {
          edition: string | null
          file_name: string
          id: string
          pages: number | null
          sort_key: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          edition?: string | null
          file_name: string
          id: string
          pages?: number | null
          sort_key?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          edition?: string | null
          file_name?: string
          id?: string
          pages?: number | null
          sort_key?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          company_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error: string | null
          id: number
          scheduled_at: string
          sent_at: string | null
          status: string
          subject: string | null
          template: string | null
          to_address: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          company_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: never
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template?: string | null
          to_address?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          company_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: never
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template?: string | null
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      oro: {
        Row: {
          closed_at: string | null
          company_id: string
          created_at: string
          id: string
          notes: string | null
          number: string | null
          status: string
          total_cost: number
          vehicle_id: string | null
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          number?: string | null
          status?: string
          total_cost?: number
          vehicle_id?: string | null
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          number?: string | null
          status?: string
          total_cost?: number
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oro_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      oro_lines: {
        Row: {
          article_id: string | null
          created_at: string
          designation: string
          id: string
          kind: string
          line_cost: number
          oro_id: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          designation: string
          id?: string
          kind?: string
          line_cost?: number
          oro_id: string
          quantity?: number
          unit_cost?: number
        }
        Update: {
          article_id?: string | null
          created_at?: string
          designation?: string
          id?: string
          kind?: string
          line_cost?: number
          oro_id?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "oro_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oro_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "oro_lines_oro_id_fkey"
            columns: ["oro_id"]
            isOneToOne: false
            referencedRelation: "oro"
            referencedColumns: ["id"]
          },
        ]
      }
      part_order_allocations: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          contact_id: string
          created_at: string
          created_by: string | null
          document_id: string | null
          id: string
          note: string | null
          part_order_line_id: string
          qty: number
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          note?: string | null
          part_order_line_id: string
          qty: number
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          note?: string | null
          part_order_line_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "part_order_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_allocations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_allocations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_allocations_part_order_line_id_fkey"
            columns: ["part_order_line_id"]
            isOneToOne: false
            referencedRelation: "part_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      part_order_lines: {
        Row: {
          article_id: string | null
          created_at: string
          designation: string
          id: string
          line_ht: number
          order_id: string
          purchase_line_id: string | null
          qty_client: number
          qty_shop: number
          reference: string | null
          sort_order: number
          supplier_id: string | null
          unit_price_ht: number
          vat_rate: number
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          designation: string
          id?: string
          line_ht?: number
          order_id: string
          purchase_line_id?: string | null
          qty_client?: number
          qty_shop?: number
          reference?: string | null
          sort_order?: number
          supplier_id?: string | null
          unit_price_ht?: number
          vat_rate?: number
        }
        Update: {
          article_id?: string | null
          created_at?: string
          designation?: string
          id?: string
          line_ht?: number
          order_id?: string
          purchase_line_id?: string | null
          qty_client?: number
          qty_shop?: number
          reference?: string | null
          sort_order?: number
          supplier_id?: string | null
          unit_price_ht?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "part_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "part_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "part_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_lines_purchase_line_id_fkey"
            columns: ["purchase_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      part_order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          from_status:
            | Database["public"]["Enums"]["order_dispatch_status"]
            | null
          id: number
          note: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_dispatch_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          from_status?:
            | Database["public"]["Enums"]["order_dispatch_status"]
            | null
          id?: never
          note?: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_dispatch_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          from_status?:
            | Database["public"]["Enums"]["order_dispatch_status"]
            | null
          id?: never
          note?: string | null
          order_id?: string
          to_status?: Database["public"]["Enums"]["order_dispatch_status"]
        }
        Relationships: [
          {
            foreignKeyName: "part_order_status_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "part_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      part_orders: {
        Row: {
          channel: string
          claim_ref: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          dispatch_status: Database["public"]["Enums"]["order_dispatch_status"]
          id: string
          is_accident: boolean
          notes: string | null
          number: string | null
          order_kind: Database["public"]["Enums"]["order_kind"]
          paid: boolean
          paid_at: string | null
          payment_method: string | null
          repair_order_id: string | null
          sent_at: string | null
          source_document_id: string | null
          status_changed_at: string | null
          surcharge_pct: number
          total_ht: number
          total_ttc: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          channel?: string
          claim_ref?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          dispatch_status?: Database["public"]["Enums"]["order_dispatch_status"]
          id?: string
          is_accident?: boolean
          notes?: string | null
          number?: string | null
          order_kind?: Database["public"]["Enums"]["order_kind"]
          paid?: boolean
          paid_at?: string | null
          payment_method?: string | null
          repair_order_id?: string | null
          sent_at?: string | null
          source_document_id?: string | null
          status_changed_at?: string | null
          surcharge_pct?: number
          total_ht?: number
          total_ttc?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          channel?: string
          claim_ref?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          dispatch_status?: Database["public"]["Enums"]["order_dispatch_status"]
          id?: string
          is_accident?: boolean
          notes?: string | null
          number?: string | null
          order_kind?: Database["public"]["Enums"]["order_kind"]
          paid?: boolean
          paid_at?: string | null
          payment_method?: string | null
          repair_order_id?: string | null
          sent_at?: string | null
          source_document_id?: string | null
          status_changed_at?: string | null
          surcharge_pct?: number
          total_ht?: number
          total_ttc?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_orders_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_orders_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_requests: {
        Row: {
          created_at: string
          email_hash: string
          id: number
          ip_hash: string | null
        }
        Insert: {
          created_at?: string
          email_hash: string
          id?: never
          ip_hash?: string | null
        }
        Update: {
          created_at?: string
          email_hash?: string
          id?: never
          ip_hash?: string | null
        }
        Relationships: []
      }
      picking_list_items: {
        Row: {
          article_id: string | null
          company_id: string
          created_at: string
          designation: string | null
          document_line_id: string | null
          id: string
          kit_item_id: string | null
          origin: string | null
          picking_id: string
          prep_step: string | null
          prep_step_at: string | null
          prep_step_by: string | null
          qty_ordered: number
          qty_picked: number
          reference: string | null
          removed_at: string | null
          sort_order: number
          status: string
          unit: string | null
        }
        Insert: {
          article_id?: string | null
          company_id: string
          created_at?: string
          designation?: string | null
          document_line_id?: string | null
          id?: string
          kit_item_id?: string | null
          origin?: string | null
          picking_id: string
          prep_step?: string | null
          prep_step_at?: string | null
          prep_step_by?: string | null
          qty_ordered?: number
          qty_picked?: number
          reference?: string | null
          removed_at?: string | null
          sort_order?: number
          status?: string
          unit?: string | null
        }
        Update: {
          article_id?: string | null
          company_id?: string
          created_at?: string
          designation?: string | null
          document_line_id?: string | null
          id?: string
          kit_item_id?: string | null
          origin?: string | null
          picking_id?: string
          prep_step?: string | null
          prep_step_at?: string | null
          prep_step_by?: string | null
          qty_ordered?: number
          qty_picked?: number
          reference?: string | null
          removed_at?: string | null
          sort_order?: number
          status?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picking_list_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "picking_list_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_document_line_id_fkey"
            columns: ["document_line_id"]
            isOneToOne: false
            referencedRelation: "document_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_kit_item_id_fkey"
            columns: ["kit_item_id"]
            isOneToOne: false
            referencedRelation: "maintenance_kit_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "picking_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_lists: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          id: string
          location: string | null
          note: string | null
          repair_order_id: string | null
          service_label: string | null
          status: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          location?: string | null
          note?: string | null
          repair_order_id?: string | null
          service_label?: string | null
          status?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          location?: string | null
          note?: string | null
          repair_order_id?: string | null
          service_label?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_lists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_lists_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_lists_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_uploads: {
        Row: {
          attachment_id: string | null
          company_id: string
          completed_at: string | null
          contact_id: string
          content_type: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          id: string
          kind: string
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          attachment_id?: string | null
          company_id: string
          completed_at?: string | null
          contact_id: string
          content_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          id?: string
          kind: string
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          attachment_id?: string | null
          company_id?: string
          completed_at?: string | null
          contact_id?: string
          content_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          id?: string
          kind?: string
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_uploads_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_uploads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_uploads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      price_changes: {
        Row: {
          article_id: string
          company_id: string
          id: number
          new_coef: number | null
          new_purchase: number | null
          new_sale_ht: number | null
          new_sale_ttc: number | null
          occurred_at: string
          old_coef: number | null
          old_purchase: number | null
          old_sale_ht: number | null
          old_sale_ttc: number | null
          operator_id: string | null
          origin: string
        }
        Insert: {
          article_id: string
          company_id: string
          id?: never
          new_coef?: number | null
          new_purchase?: number | null
          new_sale_ht?: number | null
          new_sale_ttc?: number | null
          occurred_at?: string
          old_coef?: number | null
          old_purchase?: number | null
          old_sale_ht?: number | null
          old_sale_ttc?: number | null
          operator_id?: string | null
          origin?: string
        }
        Update: {
          article_id?: string
          company_id?: string
          id?: never
          new_coef?: number | null
          new_purchase?: number | null
          new_sale_ht?: number | null
          new_sale_ttc?: number | null
          occurred_at?: string
          old_coef?: number | null
          old_purchase?: number | null
          old_sale_ht?: number | null
          old_sale_ttc?: number | null
          operator_id?: string | null
          origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_changes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_changes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "price_changes_company_id_fkey"
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
          job_title: string | null
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
          job_title?: string | null
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
          job_title?: string | null
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
            foreignKeyName: "purchase_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
          dcs_kind: string | null
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
          dcs_kind?: string | null
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
          dcs_kind?: string | null
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
      repair_order_lines: {
        Row: {
          article_id: string | null
          created_at: string
          designation: string
          discount_pct: number
          id: string
          is_warranty: boolean
          kind: string
          line_ht: number
          line_ttc: number
          or_id: string
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
          id?: string
          is_warranty?: boolean
          kind?: string
          line_ht?: number
          line_ttc?: number
          or_id: string
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
          id?: string
          is_warranty?: boolean
          kind?: string
          line_ht?: number
          line_ttc?: number
          or_id?: string
          quantity?: number
          sort_order?: number
          unit_price_ht?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "repair_order_lines_or_id_fkey"
            columns: ["or_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_order_operations: {
        Row: {
          created_at: string
          done: boolean
          id: string
          operation_id: string
          or_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          id?: string
          operation_id: string
          or_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          id?: string
          operation_id?: string
          or_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_order_operations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "workshop_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_order_operations_or_id_fkey"
            columns: ["or_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_orders: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          expert_date: string | null
          expert_name: string | null
          id: string
          invoice_document_id: string | null
          mileage: number | null
          notes: string | null
          number: string | null
          operator: string | null
          price_mode: string
          reception_notes: string | null
          repair_type: string | null
          status: string
          total_ht: number
          total_ttc: number
          total_vat: number
          updated_at: string
          vehicle_id: string | null
          warranty_status: string
          work_description: string | null
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          expert_date?: string | null
          expert_name?: string | null
          id?: string
          invoice_document_id?: string | null
          mileage?: number | null
          notes?: string | null
          number?: string | null
          operator?: string | null
          price_mode?: string
          reception_notes?: string | null
          repair_type?: string | null
          status?: string
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vehicle_id?: string | null
          warranty_status?: string
          work_description?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          expert_date?: string | null
          expert_name?: string | null
          id?: string
          invoice_document_id?: string | null
          mileage?: number | null
          notes?: string | null
          number?: string | null
          operator?: string | null
          price_mode?: string
          reception_notes?: string | null
          repair_type?: string | null
          status?: string
          total_ht?: number
          total_ttc?: number
          total_vat?: number
          updated_at?: string
          vehicle_id?: string | null
          warranty_status?: string
          work_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_invoice_document_id_fkey"
            columns: ["invoice_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      sepa_mandates: {
        Row: {
          bic: string | null
          company_id: string
          contact_id: string
          created_at: string
          iban: string
          id: string
          mandate_ref: string
          scheme: string
          seq_type: string
          signature_date: string
          status: string
        }
        Insert: {
          bic?: string | null
          company_id: string
          contact_id: string
          created_at?: string
          iban: string
          id?: string
          mandate_ref: string
          scheme?: string
          seq_type?: string
          signature_date?: string
          status?: string
        }
        Update: {
          bic?: string | null
          company_id?: string
          contact_id?: string
          created_at?: string
          iban?: string
          id?: string
          mandate_ref?: string
          scheme?: string
          seq_type?: string
          signature_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sepa_mandates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_mandates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_content_imports: {
        Row: {
          article_id: string
          company_id: string
          description_applied: boolean
          dms_text_kept: boolean
          error: string | null
          first_imported_at: string
          id: string
          images_added: number
          images_found: number
          images_total: number
          imported_at: string
          imported_by: string | null
          shopify_description: string | null
          shopify_product_id: string
          shopify_title: string | null
          status: string
          title_applied: boolean
        }
        Insert: {
          article_id: string
          company_id: string
          description_applied?: boolean
          dms_text_kept?: boolean
          error?: string | null
          first_imported_at?: string
          id?: string
          images_added?: number
          images_found?: number
          images_total?: number
          imported_at?: string
          imported_by?: string | null
          shopify_description?: string | null
          shopify_product_id: string
          shopify_title?: string | null
          status: string
          title_applied?: boolean
        }
        Update: {
          article_id?: string
          company_id?: string
          description_applied?: boolean
          dms_text_kept?: boolean
          error?: string | null
          first_imported_at?: string
          id?: string
          images_added?: number
          images_found?: number
          images_total?: number
          imported_at?: string
          imported_by?: string | null
          shopify_description?: string | null
          shopify_product_id?: string
          shopify_title?: string | null
          status?: string
          title_applied?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shopify_content_imports_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_content_imports_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_content_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_links: {
        Row: {
          article_id: string | null
          company_id: string
          created_at: string
          decided_at: string
          decided_by: string | null
          id: string
          match_via: string | null
          shopify_variant_id: string
          status: string
        }
        Insert: {
          article_id?: string | null
          company_id: string
          created_at?: string
          decided_at?: string
          decided_by?: string | null
          id?: string
          match_via?: string | null
          shopify_variant_id: string
          status: string
        }
        Update: {
          article_id?: string | null
          company_id?: string
          created_at?: string
          decided_at?: string
          decided_by?: string | null
          id?: string
          match_via?: string | null
          shopify_variant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_moto_annonces: {
        Row: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          reason: string | null
          shopify_variant_id: string
          state: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason?: string | null
          shopify_variant_id: string
          state: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason?: string | null
          shopify_variant_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_moto_annonces_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_order_lines: {
        Row: {
          article_id: string | null
          company_id: string
          created_at: string
          document_line_id: string | null
          id: string
          linked_at: string | null
          quantity: number
          shopify_line_id: string
          shopify_order_id: string
          sku: string | null
          stock_moved: boolean
          title: string | null
          variant_id: string | null
        }
        Insert: {
          article_id?: string | null
          company_id: string
          created_at?: string
          document_line_id?: string | null
          id?: string
          linked_at?: string | null
          quantity: number
          shopify_line_id: string
          shopify_order_id: string
          sku?: string | null
          stock_moved?: boolean
          title?: string | null
          variant_id?: string | null
        }
        Update: {
          article_id?: string | null
          company_id?: string
          created_at?: string
          document_line_id?: string | null
          id?: string
          linked_at?: string | null
          quantity?: number
          shopify_line_id?: string
          shopify_order_id?: string
          sku?: string | null
          stock_moved?: boolean
          title?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_lines_document_line_id_fkey"
            columns: ["document_line_id"]
            isOneToOne: false
            referencedRelation: "document_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_lines_order_fk"
            columns: ["company_id", "shopify_order_id"]
            isOneToOne: false
            referencedRelation: "shopify_orders"
            referencedColumns: ["company_id", "shopify_order_id"]
          },
        ]
      }
      shopify_order_refunds: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          credit_note_id: string | null
          id: string
          shopify_order_id: string
          shopify_refund_id: string
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          credit_note_id?: string | null
          id?: string
          shopify_order_id: string
          shopify_refund_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          credit_note_id?: string | null
          id?: string
          shopify_order_id?: string
          shopify_refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_order_refunds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_refunds_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_refunds_order_fk"
            columns: ["company_id", "shopify_order_id"]
            isOneToOne: false
            referencedRelation: "shopify_orders"
            referencedColumns: ["company_id", "shopify_order_id"]
          },
        ]
      }
      shopify_order_reservations: {
        Row: {
          article_id: string
          company_id: string
          contact_id: string | null
          document_id: string | null
          id: string
          order_name: string | null
          release_reason: string | null
          released_at: string | null
          reserved_at: string
          reserved_qty: number
          shopify_line_id: string
          shopify_order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          article_id: string
          company_id: string
          contact_id?: string | null
          document_id?: string | null
          id?: string
          order_name?: string | null
          release_reason?: string | null
          released_at?: string | null
          reserved_at?: string
          reserved_qty?: number
          shopify_line_id: string
          shopify_order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          article_id?: string
          company_id?: string
          contact_id?: string | null
          document_id?: string | null
          id?: string
          order_name?: string | null
          release_reason?: string | null
          released_at?: string | null
          reserved_at?: string
          reserved_qty?: number
          shopify_line_id?: string
          shopify_order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_order_reservations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_reservations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_order_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_reservations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_reservations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_order_reservations_order_fk"
            columns: ["company_id", "shopify_order_id"]
            isOneToOne: false
            referencedRelation: "shopify_orders"
            referencedColumns: ["company_id", "shopify_order_id"]
          },
        ]
      }
      shopify_order_settings: {
        Row: {
          company_id: string
          enabled_at: string | null
          import_enabled: boolean
          last_catchup: Json | null
          last_catchup_at: string | null
          reservation_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          enabled_at?: string | null
          import_enabled?: boolean
          last_catchup?: Json | null
          last_catchup_at?: string | null
          reservation_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          enabled_at?: string | null
          import_enabled?: boolean
          last_catchup?: Json | null
          last_catchup_at?: string | null
          reservation_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_order_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_orders: {
        Row: {
          attempts: number
          cancelled_at: string | null
          check_reason: string | null
          company_id: string
          contact_created: boolean
          contact_id: string | null
          created_at: string
          currency: string | null
          document_id: string | null
          email: string | null
          error_message: string | null
          financial_status: string | null
          first_via: string | null
          id: string
          import_status: string
          imported_at: string | null
          last_attempt_at: string | null
          last_via: string | null
          needs_check: boolean
          order_name: string | null
          shopify_created_at: string | null
          shopify_order_id: string
          total_ttc: number | null
          updated_at: string
          warnings: Json | null
        }
        Insert: {
          attempts?: number
          cancelled_at?: string | null
          check_reason?: string | null
          company_id: string
          contact_created?: boolean
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          document_id?: string | null
          email?: string | null
          error_message?: string | null
          financial_status?: string | null
          first_via?: string | null
          id?: string
          import_status?: string
          imported_at?: string | null
          last_attempt_at?: string | null
          last_via?: string | null
          needs_check?: boolean
          order_name?: string | null
          shopify_created_at?: string | null
          shopify_order_id: string
          total_ttc?: number | null
          updated_at?: string
          warnings?: Json | null
        }
        Update: {
          attempts?: number
          cancelled_at?: string | null
          check_reason?: string | null
          company_id?: string
          contact_created?: boolean
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          document_id?: string | null
          email?: string | null
          error_message?: string | null
          financial_status?: string | null
          first_via?: string | null
          id?: string
          import_status?: string
          imported_at?: string | null
          last_attempt_at?: string | null
          last_via?: string | null
          needs_check?: boolean
          order_name?: string | null
          shopify_created_at?: string | null
          shopify_order_id?: string
          total_ttc?: number | null
          updated_at?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_orders_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_products: {
        Row: {
          barcode: string | null
          company_id: string
          first_seen_at: string
          handle: string | null
          id: string
          image_url: string | null
          inventory_quantity: number | null
          price: number | null
          product_title: string | null
          product_type: string | null
          removed_at: string | null
          shopify_product_id: string
          shopify_updated_at: string | null
          shopify_variant_id: string
          sku: string | null
          status: string | null
          synced_at: string
          variant_title: string | null
          vendor: string | null
        }
        Insert: {
          barcode?: string | null
          company_id: string
          first_seen_at?: string
          handle?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          price?: number | null
          product_title?: string | null
          product_type?: string | null
          removed_at?: string | null
          shopify_product_id: string
          shopify_updated_at?: string | null
          shopify_variant_id: string
          sku?: string | null
          status?: string | null
          synced_at?: string
          variant_title?: string | null
          vendor?: string | null
        }
        Update: {
          barcode?: string | null
          company_id?: string
          first_seen_at?: string
          handle?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          price?: number | null
          product_title?: string | null
          product_type?: string | null
          removed_at?: string | null
          shopify_product_id?: string
          shopify_updated_at?: string | null
          shopify_variant_id?: string
          sku?: string | null
          status?: string | null
          synced_at?: string
          variant_title?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_published_media: {
        Row: {
          article_id: string | null
          attachment_id: string
          company_id: string
          pushed_at: string
          shopify_product_id: string
        }
        Insert: {
          article_id?: string | null
          attachment_id: string
          company_id: string
          pushed_at?: string
          shopify_product_id: string
        }
        Update: {
          article_id?: string | null
          attachment_id?: string
          company_id?: string
          pushed_at?: string
          shopify_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_published_media_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_published_media_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_published_media_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_published_media_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_log: {
        Row: {
          actor_id: string | null
          article_id: string | null
          company_id: string
          created_at: string
          detail: string | null
          id: number
          kind: string
          price_before: number | null
          price_sent: number | null
          qty_before: number | null
          qty_sent: number | null
          shopify_product_id: string | null
          shopify_variant_id: string | null
          status: string
        }
        Insert: {
          actor_id?: string | null
          article_id?: string | null
          company_id: string
          created_at?: string
          detail?: string | null
          id?: number
          kind: string
          price_before?: number | null
          price_sent?: number | null
          qty_before?: number | null
          qty_sent?: number | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          status: string
        }
        Update: {
          actor_id?: string | null
          article_id?: string | null
          company_id?: string
          created_at?: string
          detail?: string | null
          id?: number
          kind?: string
          price_before?: number | null
          price_sent?: number | null
          qty_before?: number | null
          qty_sent?: number | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_log_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_sync_log_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_queue: {
        Row: {
          article_id: string
          attempts: number
          company_id: string
          id: number
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          reasons: string[]
          requested_at: string
        }
        Insert: {
          article_id: string
          attempts?: number
          company_id: string
          id?: number
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          reasons?: string[]
          requested_at?: string
        }
        Update: {
          article_id?: string
          attempts?: number
          company_id?: string
          id?: number
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          reasons?: string[]
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_sync_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_sync_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_settings: {
        Row: {
          company_id: string
          mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_trial: {
        Row: {
          added_at: string
          added_by: string | null
          article_id: string
          company_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          article_id: string
          company_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          article_id?: string
          company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_trial_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_sync_trial_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "shopify_sync_trial_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_vehicle_links: {
        Row: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          is_auto: boolean
          method: string
          reason: string | null
          score: number
          shopify_variant_id: string
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          is_auto?: boolean
          method: string
          reason?: string | null
          score?: number
          shopify_variant_id: string
          status: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          is_auto?: boolean
          method?: string
          reason?: string | null
          score?: number
          shopify_variant_id?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_vehicle_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_settings: {
        Row: {
          client_app_open: boolean
          company_id: string
          id: boolean
          is_open: boolean
          kiosk_configurator_url: string | null
          kiosk_used_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_app_open?: boolean
          company_id: string
          id?: boolean
          is_open?: boolean
          kiosk_configurator_url?: string | null
          kiosk_used_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_app_open?: boolean
          company_id?: string
          id?: boolean
          is_open?: boolean
          kiosk_configurator_url?: string | null
          kiosk_used_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_depreciations: {
        Row: {
          article_id: string
          base_value: number | null
          company_id: string
          created_at: string
          created_by: string | null
          depreciated_value: number
          id: string
          is_active: boolean
          rate: number
          reason: string | null
        }
        Insert: {
          article_id: string
          base_value?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          depreciated_value: number
          id?: string
          is_active?: boolean
          rate: number
          reason?: string | null
        }
        Update: {
          article_id?: string
          base_value?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          depreciated_value?: number
          id?: string
          is_active?: boolean
          rate?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_depreciations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_depreciations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "stock_depreciations_company_id_fkey"
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
            foreignKeyName: "stock_moves_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
            foreignKeyName: "stock_snapshot_lines_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
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
      team_notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id?: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "team_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      team_notifications: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          dedupe_key: string | null
          document_id: string | null
          id: string
          kind: string
          origin: string | null
          payload: Json | null
          resolved_at: string | null
          target_user_id: string | null
          title: string
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          document_id?: string | null
          id?: string
          kind: string
          origin?: string | null
          payload?: Json | null
          resolved_at?: string | null
          target_user_id?: string | null
          title: string
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          document_id?: string | null
          id?: string
          kind?: string
          origin?: string | null
          payload?: Json | null
          resolved_at?: string | null
          target_user_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_notifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
      vehicle_bulletins: {
        Row: {
          bulletin_id: string | null
          company_id: string
          created_at: string
          id: string
          number: string | null
          published_at: string | null
          storage_path: string | null
          title: string | null
          url: string | null
          vehicle_id: string
        }
        Insert: {
          bulletin_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          number?: string | null
          published_at?: string | null
          storage_path?: string | null
          title?: string | null
          url?: string | null
          vehicle_id: string
        }
        Update: {
          bulletin_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          number?: string | null
          published_at?: string | null
          storage_path?: string | null
          title?: string | null
          url?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_bulletins_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_bulletins_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance: {
        Row: {
          company_id: string
          created_at: string
          dealer: string | null
          ducati_event_id: string | null
          due_date: string | null
          event_date: string | null
          id: string
          kind: string | null
          km: number | null
          service_type: string | null
          state: string | null
          vehicle_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dealer?: string | null
          ducati_event_id?: string | null
          due_date?: string | null
          event_date?: string | null
          id?: string
          kind?: string | null
          km?: number | null
          service_type?: string | null
          state?: string | null
          vehicle_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dealer?: string | null
          ducati_event_id?: string | null
          due_date?: string | null
          event_date?: string | null
          id?: string
          kind?: string | null
          km?: number | null
          service_type?: string | null
          state?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
          ducati_model_year_id: string | null
          ducati_state: string | null
          ducati_usage: string | null
          energy: string | null
          engine_number: string | null
          entry_date: string | null
          exposition_code: string | null
          first_registration_date: string | null
          fiscal_power: number | null
          formula_number: string | null
          genre: string | null
          gps_tracker_id: string | null
          hours_count: number | null
          id: string
          immat_ww: string | null
          imported_from: string | null
          insurance: string | null
          invoiced_to: string | null
          is_active: boolean
          is_restricted: boolean
          key_number: string | null
          key_number2: string | null
          legacy_state: string | null
          maintenance_usage: string | null
          marking: string | null
          marking_date: string | null
          mileage: number | null
          mileage_qualif: Database["public"]["Enums"]["mileage_qualif"] | null
          model: string | null
          model_year: number | null
          my_ducati_data: Json | null
          my_ducati_synced_at: string | null
          mymeca_qr: string | null
          next_inspection_date: string | null
          notes: string | null
          origin: string | null
          pin_tracker: string | null
          plate: string | null
          police_book_number: string | null
          power_cv: number | null
          power_kw: number | null
          production_code: string | null
          production_date: string | null
          purchase_invoice_number: string | null
          purchase_price: number | null
          reference: string | null
          segment_type: string | null
          ship_date: string | null
          sold_date: string | null
          status: Database["public"]["Enums"]["vehicle_status"]
          to_complete: boolean
          to_complete_reason: string | null
          tpms_ar: string | null
          tpms_av: string | null
          type_mine: string | null
          type_variant_version: string | null
          updated_at: string
          vin: string | null
          warranty_activated_by: string | null
          warranty_end: string | null
          warranty_start: string | null
          warranty_state: string | null
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
          ducati_model_year_id?: string | null
          ducati_state?: string | null
          ducati_usage?: string | null
          energy?: string | null
          engine_number?: string | null
          entry_date?: string | null
          exposition_code?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          formula_number?: string | null
          genre?: string | null
          gps_tracker_id?: string | null
          hours_count?: number | null
          id?: string
          immat_ww?: string | null
          imported_from?: string | null
          insurance?: string | null
          invoiced_to?: string | null
          is_active?: boolean
          is_restricted?: boolean
          key_number?: string | null
          key_number2?: string | null
          legacy_state?: string | null
          maintenance_usage?: string | null
          marking?: string | null
          marking_date?: string | null
          mileage?: number | null
          mileage_qualif?: Database["public"]["Enums"]["mileage_qualif"] | null
          model?: string | null
          model_year?: number | null
          my_ducati_data?: Json | null
          my_ducati_synced_at?: string | null
          mymeca_qr?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          origin?: string | null
          pin_tracker?: string | null
          plate?: string | null
          police_book_number?: string | null
          power_cv?: number | null
          power_kw?: number | null
          production_code?: string | null
          production_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          reference?: string | null
          segment_type?: string | null
          ship_date?: string | null
          sold_date?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          to_complete?: boolean
          to_complete_reason?: string | null
          tpms_ar?: string | null
          tpms_av?: string | null
          type_mine?: string | null
          type_variant_version?: string | null
          updated_at?: string
          vin?: string | null
          warranty_activated_by?: string | null
          warranty_end?: string | null
          warranty_start?: string | null
          warranty_state?: string | null
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
          ducati_model_year_id?: string | null
          ducati_state?: string | null
          ducati_usage?: string | null
          energy?: string | null
          engine_number?: string | null
          entry_date?: string | null
          exposition_code?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          formula_number?: string | null
          genre?: string | null
          gps_tracker_id?: string | null
          hours_count?: number | null
          id?: string
          immat_ww?: string | null
          imported_from?: string | null
          insurance?: string | null
          invoiced_to?: string | null
          is_active?: boolean
          is_restricted?: boolean
          key_number?: string | null
          key_number2?: string | null
          legacy_state?: string | null
          maintenance_usage?: string | null
          marking?: string | null
          marking_date?: string | null
          mileage?: number | null
          mileage_qualif?: Database["public"]["Enums"]["mileage_qualif"] | null
          model?: string | null
          model_year?: number | null
          my_ducati_data?: Json | null
          my_ducati_synced_at?: string | null
          mymeca_qr?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          origin?: string | null
          pin_tracker?: string | null
          plate?: string | null
          police_book_number?: string | null
          power_cv?: number | null
          power_kw?: number | null
          production_code?: string | null
          production_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          reference?: string | null
          segment_type?: string | null
          ship_date?: string | null
          sold_date?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          to_complete?: boolean
          to_complete_reason?: string | null
          tpms_ar?: string | null
          tpms_av?: string | null
          type_mine?: string | null
          type_variant_version?: string | null
          updated_at?: string
          vin?: string | null
          warranty_activated_by?: string | null
          warranty_end?: string | null
          warranty_start?: string | null
          warranty_state?: string | null
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
            foreignKeyName: "vehicles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_article_links"
            referencedColumns: ["article_id"]
          },
          {
            foreignKeyName: "vehicles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_ducati_model_year_id_fkey"
            columns: ["ducati_model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_appointments: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          id: string
          loaner_vehicle: string | null
          mechanic_name: string | null
          notify_sms: boolean
          or_id: string | null
          planned_minutes: number
          reception_notes: string | null
          requested_slot: string | null
          source: string | null
          starts_at: string
          status: string
          updated_at: string
          vehicle_id: string | null
          work_description: string | null
          workshop: string | null
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          loaner_vehicle?: string | null
          mechanic_name?: string | null
          notify_sms?: boolean
          or_id?: string | null
          planned_minutes?: number
          reception_notes?: string | null
          requested_slot?: string | null
          source?: string | null
          starts_at: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          work_description?: string | null
          workshop?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          loaner_vehicle?: string | null
          mechanic_name?: string | null
          notify_sms?: boolean
          or_id?: string | null
          planned_minutes?: number
          reception_notes?: string | null
          requested_slot?: string | null
          source?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          work_description?: string | null
          workshop?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workshop_appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_appointments_or_id_fkey"
            columns: ["or_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_appointments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_journeys: {
        Row: {
          company_id: string
          created_at: string
          finished_at: string | null
          id: string
          model_year_id: string | null
          or_id: string
          reported_to_or: boolean
          service_label: string
          started_at: string
          state: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          model_year_id?: string | null
          or_id: string
          reported_to_or?: boolean
          service_label: string
          started_at?: string
          state?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          model_year_id?: string | null
          or_id?: string
          reported_to_or?: boolean
          service_label?: string
          started_at?: string
          state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_journeys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_journeys_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_journeys_or_id_fkey"
            columns: ["or_id"]
            isOneToOne: true
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_operations: {
        Row: {
          code: string
          company_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          company_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          company_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "workshop_operations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_tasks: {
        Row: {
          company_id: string
          id: string
          mechanic: string | null
          minutes: number
          notes: string | null
          occurred_at: string
          task_type: string
        }
        Insert: {
          company_id: string
          id?: string
          mechanic?: string | null
          minutes?: number
          notes?: string | null
          occurred_at?: string
          task_type: string
        }
        Update: {
          company_id?: string
          id?: string
          mechanic?: string | null
          minutes?: number
          notes?: string | null
          occurred_at?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_time_entries: {
        Row: {
          company_id: string
          created_at: string
          ended_at: string | null
          id: string
          journey_operation: string | null
          kind: string
          mechanic_id: string | null
          mechanic_name: string | null
          minutes: number | null
          note: string | null
          or_id: string | null
          started_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          journey_operation?: string | null
          kind?: string
          mechanic_id?: string | null
          mechanic_name?: string | null
          minutes?: number | null
          note?: string | null
          or_id?: string | null
          started_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          journey_operation?: string | null
          kind?: string
          mechanic_id?: string | null
          mechanic_name?: string | null
          minutes?: number | null
          note?: string | null
          or_id?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_time_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_time_entries_or_id_fkey"
            columns: ["or_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_fluid_tables: {
        Row: {
          id: string
          lines: Json
          lines_count: number
          manual_id: string
          notes: Json
          row_key: string
          sort: number
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_updated_at: string | null
          source_version: string | null
          title: string | null
          warnings: Json
        }
        Insert: {
          id?: string
          lines?: Json
          lines_count?: number
          manual_id: string
          notes?: Json
          row_key: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string | null
          warnings?: Json
        }
        Update: {
          id?: string
          lines?: Json
          lines_count?: number
          manual_id?: string
          notes?: Json
          row_key?: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wsm_fluid_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_fluid_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_images: {
        Row: {
          bytes: number | null
          kind: string
          path: string
          sha256: string | null
          storage_path: string | null
          updated_at: string
          uploaded_at: string | null
          used_count: number
        }
        Insert: {
          bytes?: number | null
          kind?: string
          path: string
          sha256?: string | null
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string | null
          used_count?: number
        }
        Update: {
          bytes?: number | null
          kind?: string
          path?: string
          sha256?: string | null
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string | null
          used_count?: number
        }
        Relationships: []
      }
      wsm_manual_catalog_links: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          id: string
          manual_id: string
          model_year_id: string
          origin: string
          proposed_at: string
          reason: string | null
          status: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          manual_id: string
          model_year_id: string
          origin?: string
          proposed_at?: string
          reason?: string | null
          status: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          manual_id?: string
          model_year_id?: string
          origin?: string
          proposed_at?: string
          reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wsm_manual_catalog_links_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_manual_catalog_links_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_manual_catalog_links_model_year_id_fkey"
            columns: ["model_year_id"]
            isOneToOne: false
            referencedRelation: "ducati_catalog_model_years"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_manuals: {
        Row: {
          content_hash: string
          covers_model_year_ids: string[]
          dm_family_id: string | null
          dm_model_id: string | null
          dm_supermodel_id: string | null
          extracted_at: string | null
          family: string
          gaps: Json
          id: string
          loaded_at: string
          manual_root: string | null
          model: string
          model_year: number
          nodes_count: number | null
          operations_count: number
          procedures_count: number
          section: string | null
          services_count: number
          source_file: string | null
          supermodel: string | null
          times_count: number
          updated_at: string
        }
        Insert: {
          content_hash: string
          covers_model_year_ids?: string[]
          dm_family_id?: string | null
          dm_model_id?: string | null
          dm_supermodel_id?: string | null
          extracted_at?: string | null
          family: string
          gaps?: Json
          id: string
          loaded_at?: string
          manual_root?: string | null
          model: string
          model_year: number
          nodes_count?: number | null
          operations_count?: number
          procedures_count?: number
          section?: string | null
          services_count?: number
          source_file?: string | null
          supermodel?: string | null
          times_count?: number
          updated_at?: string
        }
        Update: {
          content_hash?: string
          covers_model_year_ids?: string[]
          dm_family_id?: string | null
          dm_model_id?: string | null
          dm_supermodel_id?: string | null
          extracted_at?: string | null
          family?: string
          gaps?: Json
          id?: string
          loaded_at?: string
          manual_root?: string | null
          model?: string
          model_year?: number
          nodes_count?: number | null
          operations_count?: number
          procedures_count?: number
          section?: string | null
          services_count?: number
          source_file?: string | null
          supermodel?: string | null
          times_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      wsm_operations: {
        Row: {
          group_label: string | null
          id: string
          label: string
          manual_id: string
          n: number | null
          periodicity_km: number | null
          periodicity_months: number | null
          row_key: string
          scope: string
          service_codes: string[]
          sort: number
        }
        Insert: {
          group_label?: string | null
          id?: string
          label: string
          manual_id: string
          n?: number | null
          periodicity_km?: number | null
          periodicity_months?: number | null
          row_key: string
          scope?: string
          service_codes?: string[]
          sort?: number
        }
        Update: {
          group_label?: string | null
          id?: string
          label?: string
          manual_id?: string
          n?: number | null
          periodicity_km?: number | null
          periodicity_months?: number | null
          row_key?: string
          scope?: string
          service_codes?: string[]
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "wsm_operations_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_operations_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_procedure_steps: {
        Row: {
          figures: Json
          id: string
          links: Json
          marks: Json
          n: number
          phase: string | null
          procedure_id: string
          products: Json
          sub_phase: string | null
          sub_steps: Json
          symbols: Json
          tables: Json
          text: string | null
          tools: Json
          torques: Json
          videos: Json
          warnings: Json
        }
        Insert: {
          figures?: Json
          id?: string
          links?: Json
          marks?: Json
          n: number
          phase?: string | null
          procedure_id: string
          products?: Json
          sub_phase?: string | null
          sub_steps?: Json
          symbols?: Json
          tables?: Json
          text?: string | null
          tools?: Json
          torques?: Json
          videos?: Json
          warnings?: Json
        }
        Update: {
          figures?: Json
          id?: string
          links?: Json
          marks?: Json
          n?: number
          phase?: string | null
          procedure_id?: string
          products?: Json
          sub_phase?: string | null
          sub_steps?: Json
          symbols?: Json
          tables?: Json
          text?: string | null
          tools?: Json
          torques?: Json
          videos?: Json
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wsm_procedure_steps_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_procedure_steps_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "wsm_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_procedure_torques: {
        Row: {
          id: string
          marks: string[]
          max_nm: number | null
          min_nm: number | null
          procedure_id: string
          row_key: string
          sort: number
          step_n: number | null
          text: string | null
          tolerance: string | null
          value_nm: number | null
        }
        Insert: {
          id?: string
          marks?: string[]
          max_nm?: number | null
          min_nm?: number | null
          procedure_id: string
          row_key: string
          sort?: number
          step_n?: number | null
          text?: string | null
          tolerance?: string | null
          value_nm?: number | null
        }
        Update: {
          id?: string
          marks?: string[]
          max_nm?: number | null
          min_nm?: number | null
          procedure_id?: string
          row_key?: string
          sort?: number
          step_n?: number | null
          text?: string | null
          tolerance?: string | null
          value_nm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wsm_procedure_torques_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_procedure_torques_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "wsm_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_procedure_usages: {
        Row: {
          dm_id: string | null
          dm_path: string | null
          manual_id: string
          operation: string | null
          procedure_id: string
          role: string
          sort: number
          source_updated_at: string | null
          version: string | null
        }
        Insert: {
          dm_id?: string | null
          dm_path?: string | null
          manual_id: string
          operation?: string | null
          procedure_id: string
          role?: string
          sort?: number
          source_updated_at?: string | null
          version?: string | null
        }
        Update: {
          dm_id?: string | null
          dm_path?: string | null
          manual_id?: string
          operation?: string | null
          procedure_id?: string
          role?: string
          sort?: number
          source_updated_at?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wsm_procedure_usages_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_procedure_usages_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_procedure_usages_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_procedure_usages_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "wsm_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_procedures: {
        Row: {
          content_hash: string
          figures_count: number
          id: string
          intervention: Json | null
          intro_figures: Json
          loaded_at: string
          products: Json
          roles: string[]
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_title: string | null
          source_updated_at: string | null
          source_version: string | null
          steps_count: number
          times: Json
          title: string
          tools: Json
          torques_count: number
          updated_at: string
          usages_count: number
          warnings: Json
        }
        Insert: {
          content_hash: string
          figures_count?: number
          id: string
          intervention?: Json | null
          intro_figures?: Json
          loaded_at?: string
          products?: Json
          roles?: string[]
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_title?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          steps_count?: number
          times?: Json
          title: string
          tools?: Json
          torques_count?: number
          updated_at?: string
          usages_count?: number
          warnings?: Json
        }
        Update: {
          content_hash?: string
          figures_count?: number
          id?: string
          intervention?: Json | null
          intro_figures?: Json
          loaded_at?: string
          products?: Json
          roles?: string[]
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_title?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          steps_count?: number
          times?: Json
          title?: string
          tools?: Json
          torques_count?: number
          updated_at?: string
          usages_count?: number
          warnings?: Json
        }
        Relationships: []
      }
      wsm_product_tables: {
        Row: {
          id: string
          manual_id: string
          products: Json
          products_count: number
          row_key: string
          sort: number
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_updated_at: string | null
          source_version: string | null
          title: string | null
        }
        Insert: {
          id?: string
          manual_id: string
          products?: Json
          products_count?: number
          row_key: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string | null
        }
        Update: {
          id?: string
          manual_id?: string
          products?: Json
          products_count?: number
          row_key?: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wsm_product_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_product_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_service_procedures: {
        Row: {
          id: string
          manual_id: string
          operation: string | null
          procedure_id: string
          service_code: string
          sort: number
        }
        Insert: {
          id?: string
          manual_id: string
          operation?: string | null
          procedure_id: string
          service_code: string
          sort?: number
        }
        Update: {
          id?: string
          manual_id?: string
          operation?: string | null
          procedure_id?: string
          service_code?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "wsm_service_procedures_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_service_procedures_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_service_procedures_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_service_procedures_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "wsm_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_services: {
        Row: {
          code: string
          definition: string | null
          first_reached: boolean
          first_service: boolean
          id: string
          km: number | null
          manual_id: string
          mi: number | null
          months: number | null
          name: string
          sort: number
          text: string | null
        }
        Insert: {
          code: string
          definition?: string | null
          first_reached?: boolean
          first_service?: boolean
          id?: string
          km?: number | null
          manual_id: string
          mi?: number | null
          months?: number | null
          name: string
          sort?: number
          text?: string | null
        }
        Update: {
          code?: string
          definition?: string | null
          first_reached?: boolean
          first_service?: boolean
          id?: string
          km?: number | null
          manual_id?: string
          mi?: number | null
          months?: number | null
          name?: string
          sort?: number
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wsm_services_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_services_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_times: {
        Row: {
          id: string
          label: string
          manual_id: string
          minutes: number | null
          row_key: string
          service_code: string | null
          sort: number
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_updated_at: string | null
          source_version: string | null
          time_text: string | null
          ut: number | null
          values_doc: string[]
        }
        Insert: {
          id?: string
          label: string
          manual_id: string
          minutes?: number | null
          row_key: string
          service_code?: string | null
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          time_text?: string | null
          ut?: number | null
          values_doc?: string[]
        }
        Update: {
          id?: string
          label?: string
          manual_id?: string
          minutes?: number | null
          row_key?: string
          service_code?: string | null
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          time_text?: string | null
          ut?: number | null
          values_doc?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "wsm_times_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_times_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_tool_sets: {
        Row: {
          id: string
          manual_id: string
          row_key: string
          sort: number
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_updated_at: string | null
          source_version: string | null
          title: string
          tools: Json
          tools_count: number
        }
        Insert: {
          id?: string
          manual_id: string
          row_key: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title: string
          tools?: Json
          tools_count?: number
        }
        Update: {
          id?: string
          manual_id?: string
          row_key?: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string
          tools?: Json
          tools_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wsm_tool_sets_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_tool_sets_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      wsm_torque_tables: {
        Row: {
          id: string
          lines: Json
          lines_count: number
          manual_id: string
          row_key: string
          sort: number
          source_code: string | null
          source_dm_id: string | null
          source_dm_path: string | null
          source_manual_root: string | null
          source_updated_at: string | null
          source_version: string | null
          title: string
        }
        Insert: {
          id?: string
          lines?: Json
          lines_count?: number
          manual_id: string
          row_key: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title: string
        }
        Update: {
          id?: string
          lines?: Json
          lines_count?: number
          manual_id?: string
          row_key?: string
          sort?: number
          source_code?: string | null
          source_dm_id?: string | null
          source_dm_path?: string | null
          source_manual_root?: string | null
          source_updated_at?: string | null
          source_version?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "wsm_torque_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_programs"
            referencedColumns: ["manual_id"]
          },
          {
            foreignKeyName: "wsm_torque_tables_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "wsm_manuals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ducati_catalog_article_links: {
        Row: {
          article_id: string | null
          article_reference: string | null
          catalog_description: string | null
          catalog_reference: string | null
          company_id: string | null
          reference_norm: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_manual_procedure_steps: {
        Row: {
          avertissements: Json | null
          couples: Json | null
          figures: Json | null
          liens: Json | null
          n: number | null
          outils: Json | null
          phase: string | null
          procedure_id: string | null
          produits: Json | null
          reperes: Json | null
          sousEtapes: Json | null
          sousPhase: string | null
          texte: string | null
        }
        Insert: {
          avertissements?: Json | null
          couples?: Json | null
          figures?: never
          liens?: Json | null
          n?: number | null
          outils?: Json | null
          phase?: string | null
          procedure_id?: string | null
          produits?: Json | null
          reperes?: Json | null
          sousEtapes?: Json | null
          sousPhase?: string | null
          texte?: string | null
        }
        Update: {
          avertissements?: Json | null
          couples?: Json | null
          figures?: never
          liens?: Json | null
          n?: number | null
          outils?: Json | null
          phase?: string | null
          procedure_id?: string | null
          produits?: Json | null
          reperes?: Json | null
          sousEtapes?: Json | null
          sousPhase?: string | null
          texte?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wsm_procedure_steps_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "ducati_manual_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wsm_procedure_steps_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "wsm_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      ducati_manual_procedures: {
        Row: {
          avertissements: Json | null
          couples: Json | null
          etapes: Json | null
          figuresIntro: Json | null
          id: string | null
          intervention: Json | null
          nbEtapes: number | null
          nbModelesAnnees: number | null
          outils: Json | null
          produits: Json | null
          source: Json | null
          titre: string | null
        }
        Insert: {
          avertissements?: never
          couples?: never
          etapes?: never
          figuresIntro?: never
          id?: string | null
          intervention?: never
          nbEtapes?: number | null
          nbModelesAnnees?: number | null
          outils?: never
          produits?: never
          source?: never
          titre?: string | null
        }
        Update: {
          avertissements?: never
          couples?: never
          etapes?: never
          figuresIntro?: never
          id?: string | null
          intervention?: never
          nbEtapes?: number | null
          nbModelesAnnees?: number | null
          outils?: never
          produits?: never
          source?: never
          titre?: string | null
        }
        Relationships: []
      }
      ducati_manual_programs: {
        Row: {
          annee: string | null
          echeances: Json | null
          famille: string | null
          manual_id: string | null
          manualRoot: string | null
          model_year_id: string | null
          modele: string | null
          modelYearId: string | null
          proceduresParService: Json | null
          services: Json | null
          superModele: string | null
          temps: Json | null
        }
        Relationships: []
      }
      wsm_service_operation_labels: {
        Row: {
          label: string | null
          manual_id: string | null
          service_code: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _account_label: {
        Args: { _code: string; _company: string }
        Returns: string
      }
      _accounting_cutover: { Args: { _company: string }; Returns: string }
      _al_desig_ratio: { Args: { _a: string; _b: string }; Returns: number }
      _al_first_token: { Args: { _t: string }; Returns: string }
      _al_norm_desig: { Args: { _t: string }; Returns: string }
      _annonce_annee: { Args: { _title: string }; Returns: number }
      _annonce_marque: { Args: { _title: string }; Returns: string }
      _annonce_modele: { Args: { _title: string }; Returns: string }
      _annonce_statut: {
        Args: { _product_type: string; _title: string }
        Returns: Database["public"]["Enums"]["vehicle_status"]
      }
      _article_links_can_write: { Args: { _company: string }; Returns: boolean }
      _article_links_stats: { Args: { _company: string }; Returns: Json }
      _article_on_order_qty: { Args: { _article: string }; Returns: number }
      _article_thumbnail: {
        Args: { _article: string; _company: string }
        Returns: {
          src: string
          url: string
        }[]
      }
      _brussels_today: { Args: never; Returns: string }
      _can_edit_user_signature: { Args: { _user: string }; Returns: boolean }
      _contact_haystack: {
        Args: { c: Database["public"]["Tables"]["contacts"]["Row"] }
        Returns: string
      }
      _cron_appointment_reminders: { Args: never; Returns: number }
      _cron_dormant_alert: { Args: never; Returns: undefined }
      _cron_invoice_reminders: { Args: never; Returns: number }
      _cron_maybe_stock_copy: { Args: never; Returns: undefined }
      _cron_sales_alerts: { Args: never; Returns: Json }
      _cron_shopify_orders_tick: { Args: never; Returns: undefined }
      _cron_stock_copies: { Args: never; Returns: number }
      _dc_batch_guard: {
        Args: { _batch: string }
        Returns: {
          company_id: string | null
          drawings_imported: number
          drawings_skipped: number
          finished_at: string | null
          id: string
          last_error: string | null
          last_position: Json | null
          lines_imported: number
          model_years_done: number
          model_years_total: number
          products_imported: number
          products_skipped: number
          requests_count: number
          scope: Json
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
          variants_imported: number
        }
        SetofOptions: {
          from: "*"
          to: "ducati_catalog_import_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _dc_bool: { Args: { _v: Json }; Returns: boolean }
      _dc_date: { Args: { _v: Json }; Returns: string }
      _dc_int: { Args: { _v: Json }; Returns: number }
      _dc_num: { Args: { _v: Json }; Returns: number }
      _dc_txt: { Args: { _v: Json }; Returns: string }
      _declared_vehicle_copy_scan: {
        Args: {
          _d: Database["public"]["Tables"]["contact_declared_vehicles"]["Row"]
          _vehicle: string
        }
        Returns: undefined
      }
      _declared_vehicle_lock: {
        Args: { _declaration: string }
        Returns: {
          brand: string | null
          company_id: string
          contact_id: string
          created_at: string
          family: string | null
          id: string
          kind: string
          model: string | null
          model_year: number | null
          plate: string | null
          registration_upload_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string | null
          vehicle_id: string | null
          vin: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contact_declared_vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _doc_margin: { Args: { _doc: string }; Returns: number }
      _document_chain: {
        Args: { _document: string }
        Returns: {
          depth: number
          document_id: string
        }[]
      }
      _document_order_needs: {
        Args: { _document: string }
        Returns: {
          article_id: string
          bin_location: string
          designation: string
          draft_qty: number
          free_qty: number
          line_ids: string[]
          mgmt_type: string
          missing_qty: number
          on_order_qty: number
          qty_needed: number
          real_qty: number
          reference: string
          reserved_qty: number
          supplier_id: string
          supplier_name: string
          unit_price_ht: number
          vat_rate: number
        }[]
      }
      _eur_fr: { Args: { _n: number }; Returns: string }
      _jnum: { Args: { _j: Json; _k: string }; Returns: number }
      _maintenance_kit_snapshot: {
        Args: { _kit: string; _reason: string }
        Returns: undefined
      }
      _motos_site_candidats: {
        Args: { _company: string }
        Returns: {
          method: string
          reason: string
          score: number
          sure: boolean
          variant_id: string
          vehicle_id: string
        }[]
      }
      _mp_can_link: { Args: { _company: string }; Returns: boolean }
      _mp_can_write: { Args: never; Returns: boolean }
      _mp_norm: { Args: { _s: string }; Returns: string }
      _next_document_number_unchecked: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
      _part_order_refresh_totals: {
        Args: { _order_id: string }
        Returns: undefined
      }
      _picking_refresh_status: {
        Args: { _picking: string }
        Returns: undefined
      }
      _portal_ctx: { Args: never; Returns: Record<string, unknown> }
      _portal_invoice_pdf: {
        Args: { _company: string; _document: string }
        Returns: string
      }
      _portal_last_upload: {
        Args: { _contact: string; _entity: string; _kind: string }
        Returns: string
      }
      _portal_owns_vehicle: {
        Args: { _company: string; _contact: string; _vehicle: string }
        Returns: boolean
      }
      _portal_vehicle_label: { Args: { _vehicle: string }; Returns: string }
      _recompute_paid_unchecked: {
        Args: { _document: string }
        Returns: undefined
      }
      _repair_order_service: {
        Args: { _or: string }
        Returns: {
          model_year_id: string
          service_code: string
          service_label: string
        }[]
      }
      _resolve_customer_price_unchecked: {
        Args: {
          _article: string
          _company: string
          _contact: string
          _qty?: number
        }
        Returns: {
          discount_pct: number
          rule_kind: string
          unit_price_ht: number
          unit_price_ttc: number
        }[]
      }
      _sales_deposit_alert: { Args: { _document: string }; Returns: boolean }
      _sales_deposit_received: { Args: { _document: string }; Returns: number }
      _sales_doc_balance: {
        Args: { _document: string }
        Returns: {
          client_due: number
          financed: number
          financing_pending: number
          paid: number
          paid_by_org: number
          to_receive_from_org: number
          ttc: number
        }[]
      }
      _sales_resolve_alerts: { Args: { _document: string }; Returns: number }
      _sales_unpaid_alert: { Args: { _document: string }; Returns: boolean }
      _shopify_apply_auto_links: {
        Args: {
          _actor: string
          _company: string
          _links: Json
          _run_started_at: string
          _stats: Json
        }
        Returns: Json
      }
      _shopify_apply_content: {
        Args: {
          _actor: string
          _article: string
          _company: string
          _description: string
          _error: string
          _images: Json
          _images_found: number
          _product: string
          _title: string
        }
        Returns: Json
      }
      _shopify_auto_candidates: {
        Args: { _company: string }
        Returns: {
          barcode: string
          candidates: Json
          sku: string
          variant_id: string
        }[]
      }
      _shopify_content_targets: {
        Args: {
          _before: string
          _company: string
          _limit: number
          _product: string
        }
        Returns: {
          article_designation: string
          article_id: string
          article_reference: string
          existing_photo_count: number
          imported_media_ids: string[]
          shopify_product_id: string
          web_description: string
          web_title: string
        }[]
      }
      _shopify_enqueue: {
        Args: { _article: string; _company: string; _reason: string }
        Returns: boolean
      }
      _shopify_is_moto: {
        Args: { _price: number; _product_type: string; _sku: string }
        Returns: boolean
      }
      _shopify_order_apply: {
        Args: { _company: string; _payload: Json }
        Returns: Json
      }
      _shopify_order_mark_error: {
        Args: {
          _company: string
          _created_at: string
          _email: string
          _message: string
          _order_id: string
          _order_name: string
          _total: number
          _via: string
        }
        Returns: undefined
      }
      _shopify_order_reservations_sync: {
        Args: {
          _action: string
          _company: string
          _doc?: string
          _items: Json
          _oid: string
          _order: Json
          _ref?: string
          _via: string
        }
        Returns: Json
      }
      _shopify_orders_catchup_done: {
        Args: { _at: string; _company: string; _stats: Json }
        Returns: undefined
      }
      _shopify_publish_context: {
        Args: { _article: string; _company: string }
        Returns: Json
      }
      _shopify_publish_record: {
        Args: {
          _action: string
          _actor: string
          _article: string
          _company: string
          _detail: string
          _handle: string
          _media: string[]
          _ok: boolean
          _price: number
          _product: string
          _product_status: string
          _qty: number
          _sku: string
          _title: string
          _variant: string
        }
        Returns: undefined
      }
      _shopify_push_claim: {
        Args: { _articles?: string[]; _company: string; _limit: number }
        Returns: {
          article_id: string
          mgmt_type: string
          queue_id: number
          real_qty: number
          reasons: string[]
          reference: string
          requested_at: string
          reserved_qty: number
          round_up: boolean
          sale_price_ht: number
          sale_price_ttc: number
          shopify_product_id: string
          shopify_variant_id: string
          vat_rate: number
        }[]
      }
      _shopify_push_companies: { Args: never; Returns: string[] }
      _shopify_push_done: {
        Args: { _actor?: string; _company: string; _results: Json }
        Returns: Json
      }
      _shopify_reservations_expire: { Args: never; Returns: number }
      _shopify_sync_mode: { Args: { _company: string }; Returns: string }
      _vehicle_article_reference: {
        Args: {
          _company: string
          _vehicle: Database["public"]["Tables"]["vehicles"]["Row"]
        }
        Returns: string
      }
      _vin_identify_core: { Args: { _vin: string }; Returns: Json }
      _wsm_can_link: { Args: { _company: string }; Returns: boolean }
      _wsm_can_read: { Args: never; Returns: boolean }
      _wsm_can_write: { Args: never; Returns: boolean }
      _wsm_fam: { Args: { _f: string }; Returns: string }
      _wsm_figure: { Args: { _e: Json }; Returns: Json }
      _wsm_figures: { Args: { _a: Json }; Returns: Json }
      _wsm_keys: {
        Args: { _fam: string; _mod: string; _sm: string }
        Returns: string[]
      }
      _wsm_norm: { Args: { _s: string }; Returns: string }
      _wsm_tools: { Args: { _a: Json }; Returns: Json }
      _wsm_up: { Args: { _s: string }; Returns: string }
      append_lead_exchange_note: {
        Args: { _comm: string; _lead: string; _text: string }
        Returns: boolean
      }
      article_links_autoresolve: { Args: { _company: string }; Returns: Json }
      article_links_counts: { Args: { _company: string }; Returns: Json }
      article_links_create_missing: {
        Args: {
          _company: string
          _limit?: number
          _scope?: string
          _variant?: string
        }
        Returns: Json
      }
      article_links_creation_preview: {
        Args: { _company: string; _limit?: number }
        Returns: Json
      }
      article_links_decide: {
        Args: {
          _company: string
          _decision: string
          _ids: string[]
          _note?: string
        }
        Returns: Json
      }
      article_links_for_article: {
        Args: { _article: string; _company: string }
        Returns: {
          decided_at: string
          decision_note: string
          id: string
          info: Json
          is_auto: boolean
          method: string
          reason: string
          score: number
          status: string
          target_kind: string
          target_ref: string
        }[]
      }
      article_links_link_ducati: {
        Args: { _article: string; _company: string; _reference: string }
        Returns: string
      }
      article_links_refresh: { Args: { _company: string }; Returns: Json }
      article_links_review: {
        Args: {
          _company: string
          _kind?: string
          _limit?: number
          _method?: string
          _offset?: number
          _q?: string
          _status?: string
        }
        Returns: {
          article_designation: string
          article_id: string
          article_reference: string
          article_sale_price_ttc: number
          decided_at: string
          decision_note: string
          id: string
          method: string
          reason: string
          score: number
          status: string
          target_extra: Json
          target_kind: string
          target_label: string
          target_ref: string
          total_count: number
        }[]
      }
      article_list_page: {
        Args: {
          _brand?: string
          _categorie?: string
          _color?: string
          _company: string
          _limit?: number
          _links?: string
          _offset?: number
          _pa_locked?: boolean
          _pv_locked?: boolean
          _rayon?: string
          _search?: string
          _size?: string
          _sous_rayon?: string
          _stock?: string
          _supplier?: string
          _to_complete?: boolean
          _year?: number
        }
        Returns: {
          available_qty: number
          bin_location: string
          bin_location2: string
          designation: string
          id: string
          image_source: string
          image_url: string
          link_ducati: boolean
          link_g8: boolean
          link_shopify: boolean
          mgmt_type: string
          real_qty: number
          reference: string
          replacement_reference: string
          reserved_qty: number
          sale_price_ttc: number
          superseded_by_id: string
          supplier_availability: string
          to_complete: boolean
          total_count: number
        }[]
      }
      article_on_order_for: {
        Args: { _article: string; _contact?: string; _document?: string }
        Returns: number
      }
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
        Args: {
          _company: string
          _limit?: number
          _offset?: number
          _search?: string
          _stock?: string
        }
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
      articles_a_completer_controle: {
        Args: { _company: string }
        Returns: Json
      }
      be_structured_ref_ok: { Args: { _ref: string }; Returns: boolean }
      bin_stock: { Args: { _article: string; _bin: string }; Returns: number }
      can_see_team_notification: {
        Args: { _company: string; _kind: string }
        Returns: boolean
      }
      cash_z_report: {
        Args: { _company: string; _from: string; _to: string }
        Returns: Json
      }
      close_fiscal_year: {
        Args: { _company: string; _from: string; _label?: string; _to: string }
        Returns: string
      }
      company_members: {
        Args: { _company: string }
        Returns: {
          name: string
          roles: string
          user_id: string
        }[]
      }
      contact_be_gsm: { Args: { _p: string }; Returns: string }
      contact_delete_safe: { Args: { _id: string }; Returns: undefined }
      contact_dependencies: {
        Args: { _id: string }
        Returns: {
          n: number
          table_name: string
        }[]
      }
      contact_email_in_phone: { Args: { _v: string }; Returns: string }
      contact_encours: {
        Args: { _contact: string }
        Returns: {
          authorized: number
          available: number
          current_due: number
        }[]
      }
      contact_merge: { Args: { _absorb: string; _keep: string }; Returns: Json }
      contact_merge_preview: {
        Args: { _absorb: string; _keep: string }
        Returns: Json
      }
      contact_merge_refs: { Args: { _id: string }; Returns: Json }
      contact_norm_phone: { Args: { _v: string }; Returns: string }
      contact_norm_txt: { Args: { _v: string }; Returns: string }
      contact_phone_key: { Args: { _p: string }; Returns: string }
      contact_use_phone_as_mobile: { Args: { _id: string }; Returns: string }
      contacts_find_by_email_or_mobile: {
        Args: {
          _company: string
          _email: string
          _exclude?: string
          _mobile: string
        }
        Returns: {
          account_code: string | null
          accounting_account: string | null
          address: string | null
          address_complement: string | null
          address_complement2: string | null
          address_mismatch: boolean
          bic: string | null
          birth_date: string | null
          birth_place: string | null
          category: string | null
          city: string | null
          civility: string | null
          code: string | null
          company_id: string
          company_name: string | null
          contact_name: string | null
          contact_preference: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          delivery_address: string | null
          domiciliation: string | null
          dou: string | null
          ducati_code: string | null
          ducati_url: string | null
          email: string | null
          email_pro: string | null
          external_ref: string | null
          factoring_code: string | null
          fax: string | null
          first_name: string | null
          gsm: string | null
          iban: string | null
          id: string
          imported_from: string | null
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_blocked: boolean
          is_detaxe: boolean
          is_vip: boolean
          is_watch: boolean
          last_name: string | null
          legacy_code: string | null
          legal_form: string | null
          license_category:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date: string | null
          license_number: string | null
          license_place: string | null
          license_scan_path: string | null
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          marketing_opt_out: boolean
          mobile: string | null
          mobile_pro: string | null
          mode_ht: boolean
          model_interests: string[] | null
          my_ducati_city: string | null
          my_ducati_country: string | null
          my_ducati_data: Json | null
          my_ducati_email: string | null
          my_ducati_first_name: string | null
          my_ducati_is_current_owner: boolean | null
          my_ducati_last_name: string | null
          my_ducati_marketing: boolean | null
          my_ducati_phone: string | null
          my_ducati_profiling: boolean | null
          my_ducati_score: number | null
          my_ducati_synced_at: string | null
          national_id: string | null
          national_id_scan_path: string | null
          national_register: string | null
          notes: string | null
          notify_model_stock: boolean | null
          opening_balance: number
          origin: string | null
          payment_terms: string | null
          phone: string | null
          phone_pro: string | null
          po_box: string | null
          price_list: string | null
          receipt_copies: number
          sale_vat_type: Database["public"]["Enums"]["sale_vat_type"]
          segment: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos: boolean
          status: Database["public"]["Enums"]["contact_status"]
          street_number: string | null
          supplier_customer_no: string | null
          supplier_franco_min: number | null
          supplier_is_dcs: boolean
          supplier_is_internal: boolean
          supplier_order_min: number | null
          supplier_order_min_qty: number | null
          supplier_rfa_rate: number | null
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vehicle_preference: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          watch_note: string | null
          zip: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      contacts_find_duplicates: {
        Args: {
          _city: string
          _company: string
          _email: string
          _exclude?: string
          _name: string
          _phone: string
        }
        Returns: {
          account_code: string | null
          accounting_account: string | null
          address: string | null
          address_complement: string | null
          address_complement2: string | null
          address_mismatch: boolean
          bic: string | null
          birth_date: string | null
          birth_place: string | null
          category: string | null
          city: string | null
          civility: string | null
          code: string | null
          company_id: string
          company_name: string | null
          contact_name: string | null
          contact_preference: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          delivery_address: string | null
          domiciliation: string | null
          dou: string | null
          ducati_code: string | null
          ducati_url: string | null
          email: string | null
          email_pro: string | null
          external_ref: string | null
          factoring_code: string | null
          fax: string | null
          first_name: string | null
          gsm: string | null
          iban: string | null
          id: string
          imported_from: string | null
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_blocked: boolean
          is_detaxe: boolean
          is_vip: boolean
          is_watch: boolean
          last_name: string | null
          legacy_code: string | null
          legal_form: string | null
          license_category:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date: string | null
          license_number: string | null
          license_place: string | null
          license_scan_path: string | null
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          marketing_opt_out: boolean
          mobile: string | null
          mobile_pro: string | null
          mode_ht: boolean
          model_interests: string[] | null
          my_ducati_city: string | null
          my_ducati_country: string | null
          my_ducati_data: Json | null
          my_ducati_email: string | null
          my_ducati_first_name: string | null
          my_ducati_is_current_owner: boolean | null
          my_ducati_last_name: string | null
          my_ducati_marketing: boolean | null
          my_ducati_phone: string | null
          my_ducati_profiling: boolean | null
          my_ducati_score: number | null
          my_ducati_synced_at: string | null
          national_id: string | null
          national_id_scan_path: string | null
          national_register: string | null
          notes: string | null
          notify_model_stock: boolean | null
          opening_balance: number
          origin: string | null
          payment_terms: string | null
          phone: string | null
          phone_pro: string | null
          po_box: string | null
          price_list: string | null
          receipt_copies: number
          sale_vat_type: Database["public"]["Enums"]["sale_vat_type"]
          segment: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos: boolean
          status: Database["public"]["Enums"]["contact_status"]
          street_number: string | null
          supplier_customer_no: string | null
          supplier_franco_min: number | null
          supplier_is_dcs: boolean
          supplier_is_internal: boolean
          supplier_order_min: number | null
          supplier_order_min_qty: number | null
          supplier_rfa_rate: number | null
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vehicle_preference: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          watch_note: string | null
          zip: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      contacts_match_candidates: {
        Args: {
          _company: string
          _company_name?: string
          _email: string
          _exclude?: string
          _name?: string
          _phone?: string
        }
        Returns: {
          contact_id: string
          display: string
          reason: string
        }[]
      }
      contacts_phone_gsm_candidates: {
        Args: { _company: string; _limit?: number; _offset?: number }
        Returns: {
          city: string
          code: string
          company_name: string
          first_name: string
          id: string
          last_name: string
          phone: string
          proposed_mobile: string
          total: number
          type: Database["public"]["Enums"]["contact_type"]
        }[]
      }
      contacts_search: {
        Args: {
          _company: string
          _limit: number
          _offset: number
          _q: string
          _sort?: string
          _type: string
        }
        Returns: {
          account_code: string | null
          accounting_account: string | null
          address: string | null
          address_complement: string | null
          address_complement2: string | null
          address_mismatch: boolean
          bic: string | null
          birth_date: string | null
          birth_place: string | null
          category: string | null
          city: string | null
          civility: string | null
          code: string | null
          company_id: string
          company_name: string | null
          contact_name: string | null
          contact_preference: string | null
          country: string
          created_at: string
          created_by: string | null
          credit_limit: number
          delivery_address: string | null
          domiciliation: string | null
          dou: string | null
          ducati_code: string | null
          ducati_url: string | null
          email: string | null
          email_pro: string | null
          external_ref: string | null
          factoring_code: string | null
          fax: string | null
          first_name: string | null
          gsm: string | null
          iban: string | null
          id: string
          imported_from: string | null
          interests: string[]
          is_account: boolean
          is_active: boolean
          is_blocked: boolean
          is_detaxe: boolean
          is_vip: boolean
          is_watch: boolean
          last_name: string | null
          legacy_code: string | null
          legal_form: string | null
          license_category:
            | Database["public"]["Enums"]["license_category"]
            | null
          license_date: string | null
          license_number: string | null
          license_place: string | null
          license_scan_path: string | null
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          marketing_opt_out: boolean
          mobile: string | null
          mobile_pro: string | null
          mode_ht: boolean
          model_interests: string[] | null
          my_ducati_city: string | null
          my_ducati_country: string | null
          my_ducati_data: Json | null
          my_ducati_email: string | null
          my_ducati_first_name: string | null
          my_ducati_is_current_owner: boolean | null
          my_ducati_last_name: string | null
          my_ducati_marketing: boolean | null
          my_ducati_phone: string | null
          my_ducati_profiling: boolean | null
          my_ducati_score: number | null
          my_ducati_synced_at: string | null
          national_id: string | null
          national_id_scan_path: string | null
          national_register: string | null
          notes: string | null
          notify_model_stock: boolean | null
          opening_balance: number
          origin: string | null
          payment_terms: string | null
          phone: string | null
          phone_pro: string | null
          po_box: string | null
          price_list: string | null
          receipt_copies: number
          sale_vat_type: Database["public"]["Enums"]["sale_vat_type"]
          segment: Database["public"]["Enums"]["customer_segment"]
          show_discounts_pos: boolean
          status: Database["public"]["Enums"]["contact_status"]
          street_number: string | null
          supplier_customer_no: string | null
          supplier_franco_min: number | null
          supplier_is_dcs: boolean
          supplier_is_internal: boolean
          supplier_order_min: number | null
          supplier_order_min_qty: number | null
          supplier_rfa_rate: number | null
          type: Database["public"]["Enums"]["contact_type"]
          updated_at: string
          vat_number: string | null
          vehicle_preference: string | null
          vies_checked_at: string | null
          vies_valid: boolean | null
          watch_note: string | null
          zip: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      contacts_search_count: {
        Args: { _company: string; _q: string; _type: string }
        Returns: number
      }
      counter_display_current: {
        Args: { _company: string }
        Returns: {
          amount: number
          beneficiary: string
          bic: string
          customer_name: string
          document_number: string
          iban: string
          payment_id: string
          received_at: string
          reference: string
          status: string
          updated_at: string
        }[]
      }
      counter_display_show: {
        Args: { _company: string; _payment: string }
        Returns: undefined
      }
      create_company: {
        Args: {
          _address?: string
          _city?: string
          _code: string
          _legal_name?: string
          _name: string
          _vat?: string
          _zip?: string
        }
        Returns: string
      }
      create_prospect_from_email: {
        Args: {
          _body: string
          _company: string
          _email: string
          _external_id: string
          _extract: Json
          _received: string
          _subject: string
        }
        Returns: {
          communication_id: string
          contact_id: string
          created: boolean
          lead_id: string
        }[]
      }
      crm_create_manual_lead: {
        Args: {
          _company: string
          _email?: string
          _estimated_value?: number
          _name: string
          _phone?: string
          _pipeline: string
          _source?: string
          _vehicle_interest?: string
        }
        Returns: {
          contact_created: boolean
          contact_id: string
          existing: boolean
          lead_id: string
        }[]
      }
      crm_link_lead_contact: {
        Args: { _contact?: string; _lead: string }
        Returns: {
          contact_created: boolean
          contact_id: string
          other_open_lead: string
        }[]
      }
      cycle_count_candidates: {
        Args: { _category?: string; _company: string; _limit?: number }
        Returns: {
          article_id: string
          bin_location: string
          designation: string
          last_move: string
          real_qty: number
          reference: string
        }[]
      }
      dashboard_kpis: { Args: { _company: string }; Returns: Json }
      debtors_list: {
        Args: { _as_of: string; _company: string }
        Returns: {
          contact_id: string
          contact_name: string
          invoices: number
          total_due: number
        }[]
      }
      declared_vehicle_attach: {
        Args: { _declaration: string; _from_date?: string; _vehicle: string }
        Returns: Json
      }
      declared_vehicle_create: {
        Args: { _declaration: string; _from_date?: string; _vehicle: Json }
        Returns: string
      }
      declared_vehicle_ignore: {
        Args: { _declaration: string; _note?: string }
        Returns: undefined
      }
      declared_vehicles_pending: { Args: { _company: string }; Returns: Json }
      default_assignee: { Args: { _company: string }; Returns: string }
      document_allocations: {
        Args: { _document: string }
        Returns: {
          article_id: string
          created_at: string
          created_by_name: string
          id: string
          part_order_id: string
          part_order_line_id: string
          part_order_number: string
          qty: number
          reference: string
        }[]
      }
      document_lines_stock: {
        Args: { _document: string }
        Returns: {
          article_id: string
          line_id: string
          mgmt_type: string
          on_order_qty: number
          on_order_stock_qty: number
          quantity: number
          real_qty: number
          reserved_qty: number
        }[]
      }
      document_order_needs: {
        Args: { _document: string }
        Returns: {
          article_id: string
          bin_location: string
          designation: string
          draft_qty: number
          free_qty: number
          line_ids: string[]
          mgmt_type: string
          missing_qty: number
          on_order_qty: number
          qty_needed: number
          real_qty: number
          reference: string
          reserved_qty: number
          supplier_id: string
          supplier_name: string
          unit_price_ht: number
          vat_rate: number
        }[]
      }
      document_part_orders: {
        Args: { _document: string }
        Returns: {
          channel: string
          created_at: string
          dispatch_status: string
          id: string
          line_count: number
          number: string
          order_kind: string
          source_doc_type: string
          source_document_id: string
          source_number: string
          total_ht: number
          total_ttc: number
        }[]
      }
      document_set_financing: {
        Args: {
          _amount: number
          _document: string
          _org: string
          _status: string
        }
        Returns: undefined
      }
      dormant_stock: {
        Args: { _company: string; _months?: number }
        Returns: {
          article_id: string
          designation: string
          last_move: string
          real_qty: number
          reference: string
          value_pamp: number
        }[]
      }
      ducati_catalog_article_for: {
        Args: { _company: string; _reference: string }
        Returns: string
      }
      ducati_catalog_article_link_count: {
        Args: { _company: string }
        Returns: Json
      }
      ducati_catalog_batch_progress: {
        Args: {
          _batch: string
          _counters?: Json
          _error?: string
          _position?: Json
          _status: string
        }
        Returns: undefined
      }
      ducati_catalog_batch_start: {
        Args: { _company: string; _model_years_total: number; _scope: Json }
        Returns: string
      }
      ducati_catalog_batch_start_loader: {
        Args: { _model_years_total: number; _scope: Json }
        Returns: string
      }
      ducati_catalog_drawing_lines: {
        Args: { _company: string; _drawing_id: string }
        Returns: {
          article_designation: string
          article_id: string
          article_is_library: boolean
          article_mgmt_type: string
          article_reference: string
          article_sale_price_ht: number
          catalog_price_ht: number
          catalog_price_ttc: number
          description: string
          end_date: string
          has_tempario: boolean
          line_no: number
          notes: string
          on_order_qty: number
          part_notes: string
          position: string
          price_seen_at: string
          quantity: number
          real_qty: number
          reference: string
          reference_norm: string
          replaced: boolean
          replaced_part: string
          reserved_qty: number
          start_date: string
        }[]
      }
      ducati_catalog_find_parts: {
        Args: { _company: string; _limit?: number; _q: string }
        Returns: {
          article_designation: string
          article_id: string
          article_reference: string
          catalog_price_ht: number
          description: string
          reference: string
          reference_norm: string
          replaced: boolean
          replaced_part: string
        }[]
      }
      ducati_catalog_import_state: { Args: never; Returns: Json }
      ducati_catalog_ingest_drawings: {
        Args: {
          _batch: string
          _complete?: boolean
          _drawings: Json
          _model_year_id: string
        }
        Returns: Json
      }
      ducati_catalog_ingest_model_year: {
        Args: { _batch: string; _groups: Json; _model_year_id: string }
        Returns: Json
      }
      ducati_catalog_ingest_model_years: {
        Args: { _batch: string; _items: Json }
        Returns: Json
      }
      ducati_catalog_ingest_products: {
        Args: { _batch: string; _products: Json }
        Returns: Json
      }
      ducati_catalog_ingest_tree: {
        Args: { _batch: string; _tree: Json }
        Returns: Json
      }
      ducati_catalog_is_staff: { Args: never; Returns: boolean }
      ducati_catalog_known_products: {
        Args: { _batch: string; _codes: string[]; _kind: string }
        Returns: string[]
      }
      ducati_catalog_norm_ref: { Args: { _ref: string }; Returns: string }
      ducati_catalog_part_usage: {
        Args: { _limit?: number; _offset?: number; _reference: string }
        Returns: {
          drawing_code: string
          drawing_description: string
          drawing_id: string
          family_description: string
          group_description: string
          is_europe: boolean
          model_description: string
          model_id: string
          model_year_code: string
          model_year_id: string
          position: string
          quantity: number
          total_count: number
          year: number
        }[]
      }
      ducati_catalog_product_for_reference: {
        Args: { _reference: string }
        Returns: {
          category_label: string
          collection_year: number
          color: string
          description: string
          gender: string
          image_url: string
          images: Json
          kind: string
          models: string[]
          price_ht: number
          price_seen_at: string
          price_ttc: number
          product_code: string
          product_name: string
          size: string
          sku: string
        }[]
      }
      ducati_catalog_refresh_completeness: {
        Args: { _batch: string }
        Returns: Json
      }
      ducati_catalog_stats: { Args: never; Returns: Json }
      ducati_products_creation_preview: {
        Args: { _company: string }
        Returns: Json
      }
      ducati_products_repair_designations: {
        Args: { _company: string; _limit?: number }
        Returns: Json
      }
      enqueue_label: {
        Args: {
          _article: string
          _barcode?: boolean
          _price?: boolean
          _qty?: number
        }
        Returns: number
      }
      enqueue_notification: {
        Args: {
          _body: string
          _channel: string
          _company: string
          _entity_id?: string
          _entity_type?: string
          _subject: string
          _template?: string
          _to: string
        }
        Returns: number
      }
      excel_order_assign_number: { Args: { _order: string }; Returns: string }
      excel_order_close: {
        Args: { _archive_path: string; _attachment: string; _order: string }
        Returns: {
          archive_attachment_id: string | null
          archive_path: string | null
          archived_at: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          dealer_code: string | null
          dealer_name: string | null
          download_count: number
          downloaded_at: string | null
          id: string
          notes: string | null
          number: string | null
          part_order_id: string | null
          status: string
          tab_totals: Json | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "excel_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      excel_order_current: {
        Args: { _company: string; _dealer_code?: string; _dealer_name?: string }
        Returns: {
          archive_attachment_id: string | null
          archive_path: string | null
          archived_at: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          dealer_code: string | null
          dealer_name: string | null
          download_count: number
          downloaded_at: string | null
          id: string
          notes: string | null
          number: string | null
          part_order_id: string | null
          status: string
          tab_totals: Json | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "excel_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      excel_order_tab_totals: {
        Args: { _company: string }
        Returns: {
          excel_order_id: string
          line_count: number
          reached: boolean
          tab: string
          threshold: number
          total_final: number
          total_value: number
        }[]
      }
      excel_order_threshold: { Args: { _company: string }; Returns: number }
      generate_accounting_entries: {
        Args: { _company: string; _from: string; _to: string }
        Returns: number
      }
      generate_auxiliary_accounts: {
        Args: { _company: string }
        Returns: number
      }
      generate_payment_entries: {
        Args: { _company: string; _from: string; _to: string }
        Returns: number
      }
      generate_sales_entries: {
        Args: { _company: string; _from: string; _to: string }
        Returns: number
      }
      generate_stock_snapshot: {
        Args: { _company: string; _kind?: string; _label: string }
        Returns: string
      }
      get_user_mail_signature: {
        Args: { _user: string }
        Returns: {
          email: string
          full_name: string
          job_title: string
        }[]
      }
      has_role: {
        Args: {
          _company: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      iban_is_valid: { Args: { _iban: string }; Returns: boolean }
      ingest_email: {
        Args: {
          _body: string
          _company: string
          _direction: string
          _display_from: string
          _external_id: string
          _match_email: string
          _received: string
          _subject: string
        }
        Returns: {
          communication_id: string
          contact_id: string
          matched: boolean
        }[]
      }
      ingest_inbound_email: {
        Args: {
          _body: string
          _company: string
          _external_id: string
          _from: string
          _received: string
          _subject: string
        }
        Returns: {
          communication_id: string
          contact_id: string
          matched: boolean
        }[]
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
      inventory_import_apply: {
        Args: { _import: string; _limit?: number }
        Returns: Json
      }
      inventory_import_complete_vins: {
        Args: { _apply?: boolean; _import: string }
        Returns: Json
      }
      inventory_import_open: {
        Args: {
          _company: string
          _counted_at?: string
          _origin: string
          _ref?: string
          _source_file?: string
        }
        Returns: string
      }
      inventory_import_preview: { Args: { _import: string }; Returns: Json }
      inventory_import_report: { Args: { _import: string }; Returns: Json }
      inventory_import_resolve: { Args: { _import: string }; Returns: Json }
      inventory_import_stage: {
        Args: { _import: string; _lines: Json }
        Returns: number
      }
      inventory_import_vin_candidates: {
        Args: { _import: string }
        Returns: {
          file_designation: string
          file_reference: string
          line_no: number
          marge_pct: number
          n_candidats_ligne: number
          n_candidats_moto: number
          pamp: number
          retenu: boolean
          sale_price_ttc: number
          vehicle_id: string
          vehicle_model: string
          vehicle_reference: string
          vin: string
        }[]
      }
      is_admin: { Args: { _company: string }; Returns: boolean }
      is_member: { Args: { _company: string }; Returns: boolean }
      lead_audit: {
        Args: { _lead: string }
        Returns: {
          action: string
          actor: string
          changes: string
          occurred_at: string
        }[]
      }
      lead_sla_hours: { Args: { _company: string }; Returns: number }
      learn_ducati_vds: {
        Args: {
          _cc: number
          _cv: number
          _euro: string
          _model: string
          _vin: string
        }
        Returns: undefined
      }
      log_ignored_email: {
        Args: {
          _company: string
          _email: string
          _external_id: string
          _received: string
          _subject: string
          _verdict: string
        }
        Returns: string
      }
      maintenance_catalog_coverage: { Args: { _limit?: number }; Returns: Json }
      maintenance_deduce_parts: {
        Args: { _model_year_id: string; _service_code?: string }
        Returns: {
          article_id: string
          article_ref: string
          confidence: string
          designation: string
          family_code: string
          family_label: string
          fluid_product: string
          fluid_spec: string
          kind: string
          matched_labels: string[]
          optional: boolean
          quantity: number
          references_: string[]
          service_code: string
          unit: string
        }[]
      }
      maintenance_engine_family_key: {
        Args: { _model_year_id: string }
        Returns: string
      }
      maintenance_fluid_article_set: {
        Args: { _article: string; _company: string; _family: string }
        Returns: undefined
      }
      maintenance_hourly_rate_ht: {
        Args: { _company: string }
        Returns: number
      }
      maintenance_ingest: {
        Args: { _force?: boolean; _payload: Json }
        Returns: Json
      }
      maintenance_kit_detail: {
        Args: { _kit: string }
        Returns: {
          article_id: string
          bins: string[]
          confidence: string
          designation: string
          family_code: string
          fluid_product: string
          fluid_spec: string
          id: string
          kind: string
          kit_id: string
          mgmt_type: string
          note: string
          on_order_qty: number
          origin: string
          quantity: number
          real_qty: number
          reference: string
          reserved_qty: number
          sort_order: number
          unit: string
        }[]
      }
      maintenance_kit_for_model_year: {
        Args: {
          _company: string
          _model_year_id: string
          _service_code: string
        }
        Returns: string
      }
      maintenance_kit_generate: {
        Args: {
          _company: string
          _limit?: number
          _model_year?: string
          _offset?: number
        }
        Returns: Json
      }
      maintenance_kit_item_delete: {
        Args: { _item: string }
        Returns: undefined
      }
      maintenance_kit_item_save: {
        Args: {
          _article: string
          _designation?: string
          _item: string
          _kit: string
          _note?: string
          _quantity: number
        }
        Returns: string
      }
      maintenance_kits_list: {
        Args: { _company: string; _search?: string }
        Returns: {
          edited_at: string
          edited_by_name: string
          engine_family_key: string
          engine_family_label: string
          id: string
          items_count: number
          model_years_count: number
          service_code: string
          service_label: string
          status: string
          to_confirm_count: number
          updated_at: string
          version: number
        }[]
      }
      maintenance_link_set: {
        Args: {
          _company: string
          _model_year_ids: string[]
          _plan: string
          _status: string
        }
        Returns: number
      }
      maintenance_parts_coverage: {
        Args: { _limit?: number; _offset?: number }
        Returns: Json
      }
      maintenance_propose_catalog_links: {
        Args: { _company: string }
        Returns: Json
      }
      maintenance_stats: { Args: never; Returns: Json }
      monthly_revenue: {
        Args: { _company: string }
        Returns: {
          invoices: number
          month: string
          revenue_ttc: number
        }[]
      }
      motos_parc_creer_articles: {
        Args: { _apply?: boolean; _company: string; _limit?: number }
        Returns: Json
      }
      motos_site_a_creer: {
        Args: { _company: string; _en_ligne_seulement?: boolean }
        Returns: {
          image_url: string
          price: number
          product_title: string
          propositions: number
          shop_status: string
          shopify_variant_id: string
          sku: string
          variant_title: string
        }[]
      }
      motos_site_annonces_obsoletes: {
        Args: { _company: string }
        Returns: {
          image_url: string
          price: number
          product_title: string
          reason: string
          shop_status: string
          shopify_variant_id: string
          state: string
        }[]
      }
      motos_site_creer_fiches: {
        Args: { _apply?: boolean; _company: string; _limit?: number }
        Returns: Json
      }
      motos_site_demander_retrait: { Args: { _company: string }; Returns: Json }
      motos_site_purifier: {
        Args: { _apply?: boolean; _company: string }
        Returns: Json
      }
      motos_site_rattacher: {
        Args: { _apply?: boolean; _company: string }
        Returns: Json
      }
      next_contact_code: { Args: { _company: string }; Returns: string }
      next_document_number: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
      or_journey_minutes: { Args: { _or: string }; Returns: number }
      or_worked_minutes: { Args: { _or: string }; Returns: number }
      part_order_allocate: {
        Args: { _document: string; _line: string; _note?: string; _qty: number }
        Returns: string
      }
      part_order_allocation_cancel: {
        Args: { _allocation: string }
        Returns: undefined
      }
      part_order_article_search: {
        Args: { _company: string; _limit?: number; _term: string }
        Returns: {
          article_id: string
          available_qty: number
          bin_location: string
          bin_location2: string
          designation: string
          is_library: boolean
          matched_barcode: string
          mgmt_type: string
          on_order_qty: number
          real_qty: number
          reference: string
          reserved_qty: number
          sale_price_ht: number
          supplier_id: string
          supplier_name: string
          supplier_ref: string
          vat_rate: number
        }[]
      }
      part_order_check_rules: { Args: { _order_id: string }; Returns: Json }
      part_order_create_for_workshop: {
        Args: {
          _channel?: string
          _kind?: string
          _lines?: Json
          _notes?: string
          _or?: string
          _picking?: string
        }
        Returns: string
      }
      part_order_create_from_document: {
        Args: {
          _channel?: string
          _document: string
          _kind: string
          _lines?: Json
          _notes?: string
        }
        Returns: string
      }
      part_order_history: {
        Args: { _order_id: string }
        Returns: {
          changed_at: string
          changed_by: string
          changed_by_name: string
          from_status: string
          note: string
          to_status: string
        }[]
      }
      part_order_line_delete: { Args: { _line_id: string }; Returns: undefined }
      part_order_line_save: {
        Args: {
          _article_id?: string
          _designation?: string
          _line_id?: string
          _order_id: string
          _qty_client?: number
          _qty_shop?: number
          _supplier_id?: string
          _unit_price_ht?: number
          _vat_rate?: number
        }
        Returns: Json
      }
      part_order_lines_detail: {
        Args: { _order_id: string }
        Returns: {
          article_id: string
          available_qty: number
          bin_location: string
          bin_location2: string
          designation: string
          id: string
          line_ht: number
          on_order_qty: number
          order_id: string
          qty_client: number
          qty_shop: number
          real_qty: number
          reference: string
          reserved_qty: number
          sort_order: number
          supplier_id: string
          supplier_name: string
          unit_price_ht: number
          vat_rate: number
        }[]
      }
      part_order_open_lines: {
        Args: { _article: string; _document: string }
        Returns: {
          allocated_here: number
          allocated_qty: number
          dispatch_status: string
          line_id: string
          order_contact_id: string
          order_contact_name: string
          order_id: string
          order_kind: string
          order_number: string
          qty_client: number
          qty_shop: number
          source_document_id: string
          validated_at: string
        }[]
      }
      part_order_rules: {
        Args: { _company: string }
        Returns: {
          code: string
          configured: boolean
          fallback: string
          is_active: boolean
          label: string
          max_per_day: number
          min_ht: number
          min_ht_per_tab: number
          sort_order: number
          surcharge_pct: number
        }[]
      }
      part_order_transition: {
        Args: {
          _note?: string
          _order_id: string
          _payment_method?: string
          _to: Database["public"]["Enums"]["order_dispatch_status"]
        }
        Returns: Json
      }
      part_order_validate: { Args: { _order_id: string }; Returns: Json }
      password_reset_allow: {
        Args: { _email_hash: string; _ip_hash?: string }
        Returns: boolean
      }
      password_reset_target: {
        Args: { _email: string }
        Returns: {
          company_id: string
          user_id: string
        }[]
      }
      pending_deposits: {
        Args: { _company: string }
        Returns: {
          contact_name: string
          deposit: number
          document_id: string
          issue_date: string
          number: string
        }[]
      }
      pending_effects: {
        Args: { _company: string; _to: string }
        Returns: {
          amount: number
          document_number: string
          due_date: string
          method: string
          payment_id: string
        }[]
      }
      pending_exchange_summaries: {
        Args: { _limit?: number }
        Returns: {
          body: string
          channel: string
          communication_id: string
          direction: string
          from_address: string
          lead_id: string
          lead_name: string
          lead_notes: string
          mailbox: string
          occurred_at: string
          subject: string
        }[]
      }
      picking_cancel: {
        Args: { _picking: string; _reason?: string }
        Returns: string
      }
      picking_detail: {
        Args: { _picking: string }
        Returns: {
          article_id: string
          bins: string[]
          designation: string
          document_line_id: string
          id: string
          mgmt_type: string
          on_order_qty: number
          picking_id: string
          prep_step: string
          prep_step_at: string
          prep_step_by_name: string
          qty_ordered: number
          qty_picked: number
          real_qty: number
          reference: string
          reserved_qty: number
          sort_order: number
          status: string
        }[]
      }
      picking_finish: { Args: { _picking: string }; Returns: undefined }
      picking_open_for_document: {
        Args: { _document: string }
        Returns: string
      }
      picking_open_for_repair_order: { Args: { _or: string }; Returns: string }
      picking_order_needs: {
        Args: { _picking: string }
        Returns: {
          article_id: string
          bin_location: string
          designation: string
          draft_qty: number
          free_qty: number
          mgmt_type: string
          missing_qty: number
          on_order_qty: number
          origin: string
          qty_needed: number
          real_qty: number
          reference: string
          reserved_qty: number
          supplier_id: string
          supplier_name: string
          unit_price_ht: number
          vat_rate: number
        }[]
      }
      picking_overview: {
        Args: { _company: string; _picking?: string }
        Returns: {
          cancel_reason: string
          cancelled_at: string
          cancelled_by_name: string
          client_name: string
          company_id: string
          completed_at: string
          completed_by_name: string
          contact_id: string
          created_at: string
          created_by_name: string
          doc_changed: boolean
          doc_issue_date: string
          doc_number: string
          doc_status: string
          doc_type: string
          document_id: string
          id: string
          lines_mounted: number
          lines_ordered: number
          lines_prepared: number
          lines_removed: number
          lines_total: number
          location: string
          note: string
          seller_name: string
          seller_user_id: string
          status: string
          vehicle_label: string
        }[]
      }
      picking_regenerate: { Args: { _picking: string }; Returns: Json }
      picking_reopen: { Args: { _picking: string }; Returns: undefined }
      picking_set_location: {
        Args: { _location: string; _picking: string }
        Returns: undefined
      }
      picking_set_step: {
        Args: { _item: string; _step: string }
        Returns: undefined
      }
      plate_normalize: { Args: { _plate: string }; Returns: string }
      portal_appointments: { Args: never; Returns: Json }
      portal_can_read_object: { Args: { p_name: string }; Returns: boolean }
      portal_can_write_object: { Args: { p_name: string }; Returns: boolean }
      portal_cancel_appointment_request: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      portal_complete_upload: { Args: { p_upload_id: string }; Returns: Json }
      portal_declare_vehicle: {
        Args: {
          p_brand: string
          p_model: string
          p_model_year: number
          p_plate: string
          p_vin: string
        }
        Returns: string
      }
      portal_declared_vehicles: { Args: never; Returns: Json }
      portal_home: { Args: never; Returns: Json }
      portal_invoice: { Args: { p_document_id: string }; Returns: Json }
      portal_invoices: { Args: never; Returns: Json }
      portal_prepare_declaration_upload: {
        Args: {
          p_content_type: string
          p_declaration_id: string
          p_file_name: string
          p_size: number
        }
        Returns: Json
      }
      portal_prepare_upload: {
        Args: {
          p_content_type: string
          p_file_name: string
          p_kind: string
          p_size: number
          p_vehicle_id: string
        }
        Returns: Json
      }
      portal_profile: { Args: never; Returns: Json }
      portal_request_appointment: {
        Args: {
          p_date: string
          p_reason: string
          p_slot: string
          p_vehicle_id: string
        }
        Returns: string
      }
      portal_touch: { Args: never; Returns: undefined }
      portal_update_profile: { Args: { p: Json }; Returns: Json }
      portal_vehicle: { Args: { p_vehicle_id: string }; Returns: Json }
      portal_vehicles: { Args: never; Returns: Json }
      portal_whoami: { Args: never; Returns: Json }
      purchase_order_destinations: {
        Args: { _order: string }
        Returns: {
          contact_id: string
          contact_name: string
          dispatch_status: string
          order_kind: string
          part_order_id: string
          part_order_line_id: string
          part_order_number: string
          purchase_line_id: string
          qty_client: number
          qty_shop: number
          source_document_id: string
          source_document_number: string
        }[]
      }
      qr_payment_cancel: { Args: { _payment: string }; Returns: undefined }
      qr_payment_confirm: { Args: { _payment: string }; Returns: undefined }
      qr_payment_lock: {
        Args: { _payment: string }
        Returns: {
          code_client_legacy: string | null
          company_id: string
          compta_transferred: boolean
          condition_reglement: string | null
          contact_id: string | null
          created_at: string
          date_transfert: string | null
          doc_type: string
          due_date: string | null
          financing_amount: number
          financing_org_id: string | null
          financing_status: string | null
          forced_ttc: number | null
          global_discount_amount: number
          global_discount_pct: number
          id: string
          imported_from: string | null
          issue_date: string
          legacy_number: string | null
          marge: number | null
          marge_pct: number | null
          notes: string | null
          number: string | null
          operator: string | null
          operator_user_id: string | null
          paid_amount: number
          price_mode: string
          remise_ttc: number | null
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
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      qr_payment_start: {
        Args: { _amount: number; _document: string; _reference: string }
        Returns: string
      }
      recompute_document_paid: {
        Args: { _document: string }
        Returns: undefined
      }
      recompute_oro_and_vehicle: { Args: { _oro: string }; Returns: undefined }
      record_inventory_count: {
        Args: {
          _article: string
          _bin?: string
          _counted: number
          _mode: string
        }
        Returns: number
      }
      record_price_change: {
        Args: {
          _article: string
          _coef?: number
          _origin?: string
          _purchase?: number
          _sale_ht?: number
          _sale_ttc?: number
        }
        Returns: undefined
      }
      record_sepa_collection: {
        Args: { _amount: number; _document: string }
        Returns: undefined
      }
      record_sepa_unpaid: {
        Args: { _amount: number; _document: string }
        Returns: undefined
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
      repair_order_order_needs: {
        Args: { _or: string }
        Returns: {
          article_id: string
          bin_location: string
          designation: string
          draft_qty: number
          free_qty: number
          mgmt_type: string
          missing_qty: number
          on_order_qty: number
          origin: string
          qty_needed: number
          real_qty: number
          reference: string
          reserved_qty: number
          supplier_id: string
          supplier_name: string
          unit_price_ht: number
          vat_rate: number
        }[]
      }
      report_indicators: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          avg_basket: number
          ca_ht: number
          invoices: number
          margin: number
          margin_pct: number
        }[]
      }
      report_period_compare: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          ca_ht: number
          margin: number
          period: string
        }[]
      }
      report_sales_by: {
        Args: { _company: string; _dim: string; _from: string; _to: string }
        Returns: {
          ca_ht: number
          label: string
          margin: number
          qty: number
        }[]
      }
      report_transformation: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          converted: number
          created: number
          doc_type: string
          rate: number
        }[]
      }
      reset_real_stock: {
        Args: { _company: string; _keep_vehicles?: boolean }
        Returns: number
      }
      resolve_account: {
        Args: { _company: string; _dimension: string; _key: string }
        Returns: string
      }
      resolve_customer_price: {
        Args: {
          _article: string
          _company: string
          _contact: string
          _qty?: number
        }
        Returns: {
          discount_pct: number
          rule_kind: string
          unit_price_ht: number
          unit_price_ttc: number
        }[]
      }
      resolve_journal: {
        Args: { _company: string; _dimension: string; _key: string }
        Returns: string
      }
      round_up_euro: { Args: { p: number }; Returns: number }
      sale_article_exact_lookup: {
        Args: { _company: string; _ref: string }
        Returns: {
          article_id: string
          bin_location: string
          brand: string
          catalog_url: string
          designation: string
          equivalence_group: string
          is_library: boolean
          matched_on: string
          mgmt_type: string
          on_order_qty: number
          real_qty: number
          reference: string
          reserved_qty: number
          sale_price_ht: number
          superseded_by_id: string
          supplier_ref: string
          to_complete: boolean
          vat_rate: number
        }[]
      }
      sales_journal: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          contact_id: string
          document_id: string
          issue_date: string
          number: string
          paid_amount: number
          total_ht: number
          total_ttc: number
          total_vat: number
        }[]
      }
      sales_open_balances: {
        Args: { _company: string; _operator?: string }
        Returns: {
          age_days: number
          client_due: number
          contact_id: string
          contact_name: string
          days_overdue: number
          doc_type: string
          due_date: string
          financing_pending: number
          id: string
          issue_date: string
          number: string
          operator_name: string
          operator_user_id: string
          overdue: boolean
          paid: number
          status: string
          to_receive_from_org: number
          ttc: number
        }[]
      }
      sepa_collectable: {
        Args: { _company: string; _due_to: string }
        Returns: {
          amount_due: number
          bic: string
          contact_id: string
          contact_name: string
          document_id: string
          due_date: string
          iban: string
          mandate_ref: string
          number: string
          seq_type: string
          signature_date: string
        }[]
      }
      set_accounting_cutover: {
        Args: { _company: string; _date: string }
        Returns: undefined
      }
      set_company_mail_signature: {
        Args: { _company: string; _settings: Json }
        Returns: undefined
      }
      set_default_assignee: {
        Args: { _company: string; _transfer?: boolean; _user: string }
        Returns: number
      }
      set_inbound_cursor: {
        Args: { _company: string; _ts: string }
        Returns: undefined
      }
      set_mail_cursors: {
        Args: { _company: string; _in: string; _sent: string }
        Returns: undefined
      }
      set_mailbox_cursors: {
        Args: { _in: string; _mailbox: string; _sent: string }
        Returns: undefined
      }
      set_user_mail_signature: {
        Args: { _full_name: string; _job_title: string; _user: string }
        Returns: undefined
      }
      settle_consignment: {
        Args: {
          _consignment: string
          _sale_document?: string
          _sale_price_ttc: number
        }
        Returns: {
          commission: number
          reversal: number
        }[]
      }
      shopify_article_site_status: {
        Args: { _article: string; _company: string }
        Returns: Json
      }
      shopify_link_suggestions: {
        Args: { _company: string; _variant: string }
        Returns: {
          article_id: string
          designation: string
          reason: string
          reference: string
          score: number
        }[]
      }
      shopify_link_variant: {
        Args: { _article: string; _company: string; _variant: string }
        Returns: undefined
      }
      shopify_orders_set_import: {
        Args: { _company: string; _enabled: boolean }
        Returns: {
          company_id: string
          enabled_at: string | null
          import_enabled: boolean
          last_catchup: Json | null
          last_catchup_at: string | null
          reservation_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "shopify_order_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shopify_orders_set_reservation_days: {
        Args: { _company: string; _days: number }
        Returns: {
          company_id: string
          enabled_at: string | null
          import_enabled: boolean
          last_catchup: Json | null
          last_catchup_at: string | null
          reservation_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "shopify_order_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shopify_products_overview: {
        Args: { _company: string }
        Returns: {
          article_designation: string
          article_id: string
          article_reference: string
          barcode: string
          decided_at: string
          handle: string
          image_url: string
          inventory_quantity: number
          link_status: string
          match_via: string
          price: number
          product_status: string
          product_title: string
          product_type: string
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          synced_at: string
          variant_title: string
          vendor: string
        }[]
      }
      shopify_realign: {
        Args: { _apply?: boolean; _company: string }
        Returns: Json
      }
      shopify_set_variant_decision: {
        Args: { _company: string; _decision: string; _variant: string }
        Returns: undefined
      }
      shopify_sync_resync_all: { Args: { _company: string }; Returns: number }
      shopify_sync_set_mode: {
        Args: { _company: string; _mode: string }
        Returns: number
      }
      shopify_sync_status: { Args: { _company: string }; Returns: Json }
      shopify_sync_trial_add: {
        Args: { _article: string; _company: string }
        Returns: undefined
      }
      shopify_sync_trial_remove: {
        Args: { _article: string; _company: string }
        Returns: undefined
      }
      shopify_unlinked_products: {
        Args: { _company: string; _limit?: number; _offset?: number }
        Returns: {
          candidates: number
          image_url: string
          pending_article_id: string
          pending_article_reference: string
          price: number
          product_title: string
          qty: number
          shop_status: string
          shopify_variant_id: string
          sku: string
          total_count: number
          variant_title: string
        }[]
      }
      shopify_vehicle_links_decide: {
        Args: { _company: string; _decision: string; _ids: string[] }
        Returns: Json
      }
      shopify_vehicle_links_refresh: {
        Args: { _company: string }
        Returns: Json
      }
      shopify_vehicle_links_review: {
        Args: { _company: string; _status?: string }
        Returns: {
          color: string
          id: string
          image_url: string
          method: string
          model: string
          model_year: number
          price: number
          product_title: string
          reason: string
          score: number
          shop_status: string
          shopify_variant_id: string
          status: string
          variant_title: string
          vehicle_id: string
          vehicle_status: string
          vin: string
        }[]
      }
      signup_precheck: {
        Args: { _company: string; _email: string }
        Returns: string
      }
      signup_register: {
        Args: {
          _company: string
          _email: string
          _origin: string
          _p: Json
          _user: string
        }
        Returns: {
          contact_created: boolean
          contact_id: string
          lead_created: boolean
          lead_id: string
          task_created: boolean
        }[]
      }
      stock_value_owned: { Args: { _company: string }; Returns: number }
      supplier_order_from_proposal: {
        Args: {
          _company: string
          _line_ids: string[]
          _note?: string
          _supplier: string
        }
        Returns: Json
      }
      supplier_order_proposal: {
        Args: { _company: string }
        Returns: {
          article_id: string
          contact_id: string
          contact_name: string
          designation: string
          dispatch_status: string
          line_id: string
          order_id: string
          order_kind: string
          order_number: string
          paid: boolean
          purchase_price: number
          qty_client: number
          qty_shop: number
          reference: string
          sale_price_ht: number
          source_document_id: string
          source_document_number: string
          source_document_type: string
          supplier_email: string
          supplier_franco_min: number
          supplier_id: string
          supplier_is_dcs: boolean
          supplier_name: string
          supplier_order_min: number
          supplier_ref: string
          validated_at: string
          vat_rate: number
        }[]
      }
      supplier_proposal_log_mail: {
        Args: {
          _attachment: string
          _company: string
          _from: string
          _kind: string
          _line_ids: string[]
          _subject: string
          _supplier: string
          _to: string
        }
        Returns: undefined
      }
      supplier_proposal_set_supplier: {
        Args: { _line: string; _supplier: string }
        Returns: undefined
      }
      top_articles: {
        Args: { _company: string; _from: string; _limit?: number; _to: string }
        Returns: {
          article_id: string
          designation: string
          qty: number
          reference: string
          revenue_ht: number
        }[]
      }
      transfer_stock_on_replace: {
        Args: { _from: string; _to: string }
        Returns: undefined
      }
      unaccent: { Args: { "": string }; Returns: string }
      vat_register: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          base_ht: number
          vat: number
          vat_rate: number
        }[]
      }
      vehicle_article_mgmt_type: {
        Args: {
          _reference?: string
          _status: Database["public"]["Enums"]["vehicle_status"]
        }
        Returns: Database["public"]["Enums"]["article_mgmt_type"]
      }
      vehicle_attach_owner: {
        Args: {
          _contact: string
          _from_date?: string
          _reason?: string
          _vehicle: string
        }
        Returns: Json
      }
      vehicle_create_for_contact: {
        Args: {
          _company: string
          _contact: string
          _from_date?: string
          _vehicle: Json
        }
        Returns: string
      }
      vehicle_ensure_article: {
        Args: {
          _mgmt?: string
          _unit_cost?: number
          _vehicle: string
          _with_stock?: boolean
        }
        Returns: string
      }
      vehicle_needs_article: {
        Args: { _status: Database["public"]["Enums"]["vehicle_status"] }
        Returns: boolean
      }
      vehicle_parc_kind: {
        Args: { _status: Database["public"]["Enums"]["vehicle_status"] }
        Returns: string
      }
      vehicle_parc_publishable: {
        Args: { _status: Database["public"]["Enums"]["vehicle_status"] }
        Returns: boolean
      }
      vehicle_site_status: {
        Args: { _company: string; _vehicle: string }
        Returns: Json
      }
      vehicles_find_by_vin: {
        Args: { _company: string; _exclude?: string; _vin: string }
        Returns: {
          brand: string
          id: string
          model: string
          owner_id: string
          owner_name: string
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          vin: string
        }[]
      }
      vehicles_parc_check: {
        Args: { _company: string }
        Returns: {
          anomalie: string
          detail: string
          model: string
          statut: string
          vehicle_id: string
          vin: string
        }[]
      }
      vin_identify: { Args: { _vin: string }; Returns: Json }
      vin_normalize: { Args: { _vin: string }; Returns: string }
      vo_margin_register: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          base_ht: number
          designation: string
          doc_number: string
          document_id: string
          margin: number
          purchase_price: number
          sale_date: string
          sale_ttc: number
          vat_margin: number
          vehicle_id: string
          vin: string
        }[]
      }
      vo_margin_summary: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          count_vo: number
          total_base: number
          total_margin: number
          total_sale: number
          total_vat_margin: number
        }[]
      }
      workshop_load: {
        Args: {
          _capacity?: number
          _company: string
          _from: string
          _to: string
        }
        Returns: {
          appointments: number
          day: string
          load_pct: number
        }[]
      }
      workshop_productivity: {
        Args: { _company: string; _from: string; _to: string }
        Returns: {
          mechanic: string
          presence_min: number
          work_min: number
        }[]
      }
      wsm_ingest_images: { Args: { _payload: Json }; Returns: Json }
      wsm_ingest_manuals: {
        Args: { _force?: boolean; _payload: Json }
        Returns: Json
      }
      wsm_ingest_procedures: {
        Args: { _force?: boolean; _payload: Json }
        Returns: Json
      }
      wsm_link_set: {
        Args: {
          _company: string
          _manual: string
          _model_year_ids: string[]
          _status: string
        }
        Returns: number
      }
      wsm_manual_list: {
        Args: { _family?: string; _limit?: number; _q?: string }
        Returns: Json
      }
      wsm_manual_overview: { Args: { _manual: string }; Returns: Json }
      wsm_propose_catalog_links: { Args: { _company: string }; Returns: Json }
      wsm_stats: { Args: never; Returns: Json }
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
        | "employe"
      customer_segment: "standard" | "vip"
      kit_billing_mode: "forfait" | "nomenclature"
      license_category: "AM" | "A1" | "A2" | "A" | "B" | "autre"
      mileage_qualif: "nc" | "reel" | "ng"
      order_dispatch_status:
        | "brouillon"
        | "en_attente_paiement"
        | "payee"
        | "a_envoyer"
        | "envoyee"
        | "annulee"
      order_kind: "urgente" | "standard" | "excel" | "accident"
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
        "employe",
      ],
      customer_segment: ["standard", "vip"],
      kit_billing_mode: ["forfait", "nomenclature"],
      license_category: ["AM", "A1", "A2", "A", "B", "autre"],
      mileage_qualif: ["nc", "reel", "ng"],
      order_dispatch_status: [
        "brouillon",
        "en_attente_paiement",
        "payee",
        "a_envoyer",
        "envoyee",
        "annulee",
      ],
      order_kind: ["urgente", "standard", "excel", "accident"],
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
