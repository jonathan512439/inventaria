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

export type MovementType = "entrada" | "venta" | "salida" | "ajuste";

export type StockMovement = {
  id: number;
  user_id: string;
  product_id: string | null;
  product_name: string | null;
  variant_id: string | null;
  variant_label: string | null;
  tipo: MovementType;
  cantidad: number;
  precio_unitario: number | null;
  total: number | null;
  motivo: string | null;
  stock_resultante: number | null;
  created_at: string;
};

/** Eje de variación de una categoría principal: talla, color, edad… (máx. 3 por categoría) */
export type VariantAxis = {
  id: string;
  user_id: string;
  category_id: string;
  key: string; // 'talla'
  label: string; // 'Talla'
  options: string[]; // sugeridas; vacío = libre
  sort_order: number;
  created_at: string;
};

/** Una combinación concreta ("M · Rojo") con su propio stock, precio y código. */
export type ProductVariant = {
  id: string;
  user_id: string;
  product_id: string;
  values: Record<string, string>; // {"talla":"M","color":"Rojo"}
  label: string;
  codigo_barras: string | null;
  precio: number | null; // nulo = el del producto
  costo: number | null;
  stock: number;
  visible: boolean;
  created_at: string;
};

/** Fila de la vista `product_summaries` (inventario ligero: nombre, precio, stock resueltos en la base). */
export type ProductSummary = {
  id: string;
  user_id: string;
  category_id: string | null;
  status: ProductStatus;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  nombre: string | null;
  marca: string | null;
  precio: number | null;
  precio_compra: number | null;
  stock: number | null;
  codigo_barras: string | null;
  /** Texto de búsqueda (nombre, marca, descripción, etiqueta, código); no se pide en listados */
  search?: string | null;
};

export type AiUsage = {
  id: string;
  user_id: string | null;
  model: string;
  purpose: string;
  status: string;
  quota_limit: number | null;
  created_at: string;
};

/** Lo que la IA dedujo además de los campos: sugerencias y texto leído en la etiqueta. */
export type AiMeta = {
  categoria_sugerida?: string | null; // ruta "Ropa > Camisas" elegida por la IA
  categoria_nueva?: string | null; // subcategoría propuesta si ninguna existente encaja
  catalogo_sugerido?: string | null; // id de un catálogo preconfigurado (lib/presets) que le serviría al usuario
  categoria_nueva_general?: string | null; // nombre de una categoría (nivel superior) nueva si ningún catálogo encaja
  etiqueta?: string | null; // texto visible: marca, modelo, código, precio impreso
  modelo?: string | null; // modelo de Gemini usado
  variantes_propuestas?: Record<string, string[]> | null; // {"talla":["S","M","L"],"color":["Rojo"]} leídas de la foto; solo propuesta
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
      stock_movements: {
        Row: StockMovement;
        Insert: Omit<StockMovement, "id" | "created_at" | "precio_unitario" | "total" | "motivo" | "stock_resultante" | "product_name" | "variant_id" | "variant_label"> & {
          id?: number;
          created_at?: string;
          precio_unitario?: number | null;
          total?: number | null;
          motivo?: string | null;
          stock_resultante?: number | null;
          product_name?: string | null;
          variant_id?: string | null;
          variant_label?: string | null;
        };
        Update: Partial<StockMovement>;
        Relationships: [];
      };
      variant_axes: {
        Row: VariantAxis;
        Insert: Omit<VariantAxis, "id" | "created_at" | "options" | "sort_order"> & { id?: string; created_at?: string; options?: string[]; sort_order?: number };
        Update: Partial<VariantAxis>;
        Relationships: [];
      };
      product_variants: {
        Row: ProductVariant;
        Insert: Omit<ProductVariant, "id" | "created_at" | "codigo_barras" | "precio" | "costo" | "stock" | "visible"> & {
          id?: string;
          created_at?: string;
          codigo_barras?: string | null;
          precio?: number | null;
          costo?: number | null;
          stock?: number;
          visible?: boolean;
        };
        Update: Partial<ProductVariant>;
        Relationships: [];
      };
      ai_usage: {
        Row: AiUsage;
        Insert: Omit<AiUsage, "id" | "created_at" | "quota_limit"> & { id?: string; created_at?: string; quota_limit?: number | null };
        Update: Partial<AiUsage>;
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
    Views: {
      product_summaries: { Row: ProductSummary; Relationships: [] };
    };
    Functions: { [_ in never]: never };
    Enums: { field_type: FieldType; product_status: ProductStatus; movement_type: MovementType };
    CompositeTypes: { [_ in never]: never };
  };
}
