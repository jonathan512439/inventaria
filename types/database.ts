export type FieldType = "text" | "number" | "select";
export type ProductStatus = "draft" | "confirmed";

export type Profile = {
  id: string;
  email: string | null;
  business_name: string | null;
  onboarded_at: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  icon: string | null;
  created_at: string;
};

export type FieldTemplate = {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  field_type: FieldType;
  options: string[] | null;
  is_ai_fillable: boolean;
  sort_order: number;
  default_value: string | null;
  created_at: string;
};

export type ProductData = Record<string, string | number | null>;

/** Lo que la IA dedujo además de los campos: sugerencias y texto leído en la etiqueta. */
export type AiMeta = {
  categoria_sugerida?: string | null; // ruta "Ropa > Camisas" elegida por la IA
  categoria_nueva?: string | null; // nombre propuesto si ninguna sección encaja
  etiqueta?: string | null; // texto visible: marca, modelo, código, precio impreso
  modelo?: string | null; // modelo de Gemini usado
};

export type Product = {
  id: string;
  user_id: string;
  category_id: string | null;
  status: ProductStatus;
  data: ProductData;
  ai_meta: AiMeta;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

/** Tipado mínimo para supabase-js (Database generic) */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      categories: {
        Row: Category;
        Insert: Omit<Category, "id" | "created_at" | "icon"> & { id?: string; created_at?: string; icon?: string | null };
        Update: Partial<Category>;
        Relationships: [];
      };
      field_templates: {
        Row: FieldTemplate;
        Insert: Omit<FieldTemplate, "id" | "created_at" | "sort_order" | "options" | "is_ai_fillable" | "field_type" | "default_value"> & {
          id?: string;
          created_at?: string;
          sort_order?: number;
          options?: string[] | null;
          is_ai_fillable?: boolean;
          field_type?: FieldType;
          default_value?: string | null;
        };
        Update: Partial<FieldTemplate>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: Omit<Product, "id" | "created_at" | "updated_at" | "status" | "data" | "image_url" | "ai_meta"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          status?: ProductStatus;
          data?: ProductData;
          ai_meta?: AiMeta;
          image_url?: string | null;
        };
        Update: Partial<Product>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { field_type: FieldType; product_status: ProductStatus };
    CompositeTypes: { [_ in never]: never };
  };
}
