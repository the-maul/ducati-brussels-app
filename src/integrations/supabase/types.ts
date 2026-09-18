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
          updated_at: string
          vat_rate: number
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
          updated_at?: string
          vat_rate?: number
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
          updated_at?: string
          vat_rate?: number
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
          source: string
          vehicle_id: string | null
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
          source: string
          vehicle_id?: string | null
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
          source?: string
          vehicle_id?: string | null
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
            foreignKeyName: "oro_lines_oro_id_fkey"
            columns: ["oro_id"]
            isOneToOne: false
            referencedRelation: "oro"
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
            foreignKeyName: "part_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "part_orders"
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
          id: string
          picking_id: string
          qty_ordered: number
          qty_picked: number
          reference: string | null
          status: string
        }
        Insert: {
          article_id?: string | null
          company_id: string
          created_at?: string
          designation?: string | null
          id?: string
          picking_id: string
          qty_ordered?: number
          qty_picked?: number
          reference?: string | null
          status?: string
        }
        Update: {
          article_id?: string | null
          company_id?: string
          created_at?: string
          designation?: string | null
          id?: string
          picking_id?: string
          qty_ordered?: number
          qty_picked?: number
          reference?: string | null
          status?: string
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
            foreignKeyName: "picking_list_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          company_id: string
          created_at: string
          created_by: string | null
          document_id: string | null
          id: string
          location: string | null
          note: string | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          location?: string | null
          note?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          location?: string | null
          note?: string | null
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
            foreignKeyName: "shopify_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      signup_settings: {
        Row: {
          client_app_open: boolean
          company_id: string
          id: boolean
          is_open: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_app_open?: boolean
          company_id: string
          id?: boolean
          is_open?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_app_open?: boolean
          company_id?: string
          id?: boolean
          is_open?: boolean
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
          id: string
          kind: string
          origin: string | null
          title: string
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          kind: string
          origin?: string | null
          title: string
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          origin?: string | null
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
            foreignKeyName: "vehicles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _account_label: {
        Args: { _code: string; _company: string }
        Returns: string
      }
      _accounting_cutover: { Args: { _company: string }; Returns: string }
      _article_on_order_qty: { Args: { _article: string }; Returns: number }
      _contact_haystack: {
        Args: { c: Database["public"]["Tables"]["contacts"]["Row"] }
        Returns: string
      }
      _cron_appointment_reminders: { Args: never; Returns: number }
      _cron_dormant_alert: { Args: never; Returns: undefined }
      _cron_invoice_reminders: { Args: never; Returns: number }
      _cron_maybe_stock_copy: { Args: never; Returns: undefined }
      _cron_stock_copies: { Args: never; Returns: number }
      _doc_margin: { Args: { _doc: string }; Returns: number }
      _eur_fr: { Args: { _n: number }; Returns: string }
      _jnum: { Args: { _j: Json; _k: string }; Returns: number }
      _next_document_number_unchecked: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
      _part_order_refresh_totals: {
        Args: { _order_id: string }
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
      append_lead_exchange_note: {
        Args: { _comm: string; _lead: string; _text: string }
        Returns: boolean
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
      default_assignee: { Args: { _company: string }; Returns: string }
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
      monthly_revenue: {
        Args: { _company: string }
        Returns: {
          invoices: number
          month: string
          revenue_ttc: number
        }[]
      }
      next_contact_code: { Args: { _company: string }; Returns: string }
      next_document_number: {
        Args: { _company: string; _doc_type: string }
        Returns: string
      }
      or_worked_minutes: { Args: { _or: string }; Returns: number }
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
      portal_appointments: { Args: never; Returns: Json }
      portal_can_read_object: { Args: { p_name: string }; Returns: boolean }
      portal_can_write_object: { Args: { p_name: string }; Returns: boolean }
      portal_cancel_appointment_request: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      portal_complete_upload: { Args: { p_upload_id: string }; Returns: Json }
      portal_home: { Args: never; Returns: Json }
      portal_invoice: { Args: { p_document_id: string }; Returns: Json }
      portal_invoices: { Args: never; Returns: Json }
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
      shopify_set_variant_decision: {
        Args: { _company: string; _decision: string; _variant: string }
        Returns: undefined
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
