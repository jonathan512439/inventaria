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
  min_stock_default: number | null; // mínimo por defecto para los productos nuevos (categoría principal)
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
  purchase_id?: string | null;
  count_id?: string | null;
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
  min_stock: number | null;
  expires_at: string | null;
  visible: boolean;
  created_at: string;
};

export type Supplier = { id: string; user_id: string; name: string; phone: string | null; note: string | null; created_at: string };

export type Purchase = {
  id: string;
  user_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  doc: string | null;
  note: string | null;
  total: number;
  items: number;
  created_at: string;
};

export type PurchaseItem = {
  id: string;
  purchase_id: string;
  user_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  qty: number;
  unit_cost: number | null;
  expires_at: string | null;
  created_at: string;
};

export type StockCount = {
  id: string;
  user_id: string;
  category_id: string | null;
  category_name: string | null;
  note: string | null;
  started_at: string;
  closed_at: string | null;
  items: number;
  differences: number;
  diff_units: number;
};

export type StockCountItem = {
  id: string;
  count_id: string;
  user_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  expected: number;
  counted: number | null;
  reason: string | null;
  created_at: string;
};

export type PriceHistory = {
  id: number;
  user_id: string;
  product_id: string | null;
  variant_id: string | null;
  field: string;
  old_value: number | null;
  new_value: number | null;
  source: string | null;
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
  min_stock?: number | null;
  expires_at?: string | null;
  precio_mayorista?: number | null;
  unidades_por_paquete?: number | null;
};

export type AiUsage = {
  id: string;
  user_id: string | null;
  model: string;
  purpose: string;
  status: string;
  quota_limit: number | null;
  own_key: boolean; // hecho con la clave propia del usuario (no cuenta contra el cupo del servicio)
  created_at: string;
};

/** Clave de IA propia del usuario, cifrada. Solo la lee el servidor. */
export type AiKey = {
  user_id: string;
  provider: string;
  key_ciphertext: string;
  iv: string;
  last4: string;
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
  posible_duplicado?: { product_id: string; nombre: string; motivo: string } | null; // otro producto del inventario que parece el mismo
};

export type Product = {
  id: string;
  user_id: string;
  category_id: string | null;
  status: ProductStatus;
  data: ProductData;
  ai_meta: AiMeta;
  image_url: string | null;
  min_stock?: number | null;
  expires_at?: string | null;
  deleted_at?: string | null; // papelera (borrado suave)
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
        Insert: Omit<Category, "id" | "created_at" | "icon" | "min_stock_default"> & { id?: string; created_at?: string; icon?: string | null; min_stock_default?: number | null };
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
          purchase_id?: string | null;
          count_id?: string | null;
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
        Insert: Omit<ProductVariant, "id" | "created_at" | "codigo_barras" | "precio" | "costo" | "stock" | "visible" | "min_stock" | "expires_at"> & {
          id?: string;
          created_at?: string;
          codigo_barras?: string | null;
          precio?: number | null;
          costo?: number | null;
          stock?: number;
          visible?: boolean;
          min_stock?: number | null;
          expires_at?: string | null;
        };
        Update: Partial<ProductVariant>;
        Relationships: [];
      };
      ai_usage: {
        Row: AiUsage;
        Insert: Omit<AiUsage, "id" | "created_at" | "quota_limit" | "own_key"> & { id?: string; created_at?: string; quota_limit?: number | null; own_key?: boolean };
        Update: Partial<AiUsage>;
        Relationships: [];
      };
      suppliers: {
        Row: Supplier;
        Insert: Omit<Supplier, "id" | "created_at" | "phone" | "note"> & { id?: string; created_at?: string; phone?: string | null; note?: string | null };
        Update: Partial<Supplier>;
        Relationships: [];
      };
      purchases: {
        Row: Purchase;
        Insert: Omit<Purchase, "id" | "created_at" | "supplier_id" | "supplier_name" | "doc" | "note" | "total" | "items"> & {
          id?: string;
          created_at?: string;
          supplier_id?: string | null;
          supplier_name?: string | null;
          doc?: string | null;
          note?: string | null;
          total?: number;
          items?: number;
        };
        Update: Partial<Purchase>;
        Relationships: [];
      };
      purchase_items: {
        Row: PurchaseItem;
        Insert: Omit<PurchaseItem, "id" | "created_at" | "product_id" | "variant_id" | "product_name" | "variant_label" | "unit_cost" | "expires_at"> & {
          id?: string;
          created_at?: string;
          product_id?: string | null;
          variant_id?: string | null;
          product_name?: string | null;
          variant_label?: string | null;
          unit_cost?: number | null;
          expires_at?: string | null;
        };
        Update: Partial<PurchaseItem>;
        Relationships: [];
      };
      stock_counts: {
        Row: StockCount;
        Insert: Omit<StockCount, "id" | "started_at" | "closed_at" | "items" | "differences" | "diff_units" | "category_id" | "category_name" | "note"> & {
          id?: string;
          started_at?: string;
          closed_at?: string | null;
          items?: number;
          differences?: number;
          diff_units?: number;
          category_id?: string | null;
          category_name?: string | null;
          note?: string | null;
        };
        Update: Partial<StockCount>;
        Relationships: [];
      };
      stock_count_items: {
        Row: StockCountItem;
        Insert: Omit<StockCountItem, "id" | "created_at" | "product_id" | "variant_id" | "product_name" | "variant_label" | "counted" | "reason"> & {
          id?: string;
          created_at?: string;
          product_id?: string | null;
          variant_id?: string | null;
          product_name?: string | null;
          variant_label?: string | null;
          counted?: number | null;
          reason?: string | null;
        };
        Update: Partial<StockCountItem>;
        Relationships: [];
      };
      price_history: {
        Row: PriceHistory;
        Insert: Omit<PriceHistory, "id" | "created_at" | "product_id" | "variant_id" | "old_value" | "new_value" | "source"> & {
          id?: number;
          created_at?: string;
          product_id?: string | null;
          variant_id?: string | null;
          old_value?: number | null;
          new_value?: number | null;
          source?: string | null;
        };
        Update: Partial<PriceHistory>;
        Relationships: [];
      };
      ai_keys: {
        Row: AiKey;
        Insert: Omit<AiKey, "created_at" | "provider"> & { created_at?: string; provider?: string };
        Update: Partial<AiKey>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: Omit<Product, "id" | "created_at" | "updated_at" | "status" | "data" | "image_url" | "ai_meta" | "min_stock" | "expires_at" | "deleted_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          status?: ProductStatus;
          data?: ProductData;
          ai_meta?: AiMeta;
          image_url?: string | null;
          min_stock?: number | null;
          expires_at?: string | null;
          deleted_at?: string | null;
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
