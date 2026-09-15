export type FieldType = "text" | "number" | "select";
export type ProductStatus = "draft" | "confirmed";

export type MemberRole = "dueno" | "vendedor";

export type Business = { id: string; name: string; owner_id: string; plan: string; created_at: string };

export type BusinessMember = {
  business_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string | null;
  has_pin: boolean;
  active: boolean;
  created_at: string;
};

export type Invite = {
  id: string;
  business_id: string;
  code: string;
  role: MemberRole;
  created_by: string;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  business_name: string | null;
  onboarded_at: string | null;
  current_business_id: string | null;
  /** Avisos: mínimo por defecto y días de anticipación del vencimiento (null = valores de fábrica) */
  min_stock_default: number | null;
  expiry_days: number | null;
  created_at: string;
};

export type Category = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  icon: string | null;
  min_stock_default: number | null; // mínimo por defecto para los productos nuevos (categoría principal)
  alerts_off: boolean; // no avisar de esta categoría
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
export type SaleStatus = "pagado" | "parcial" | "fiado";
export type PayMethod = "efectivo" | "qr" | "transferencia" | "mixto";

/** Una venta = un ticket con varias líneas. */
export type Sale = {
  id: string;
  user_id: string;
  number: number | null;
  customer_id: string | null;
  customer_name: string | null;
  status: SaleStatus;
  method: PayMethod;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  cost_total: number; // costo de lo vendido → ganancia real = total − cost_total
  items: number;
  note: string | null;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  user_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number | null;
  line_total: number;
  created_at: string;
};

export type Customer = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  note: string | null;
  credit_limit: number | null; // null = sin límite
  deleted_at: string | null;
  created_at: string;
};

/** Abono de un cliente contra su saldo (se aplica a las ventas más antiguas primero). */
export type Payment = {
  id: string;
  user_id: string;
  customer_id: string;
  amount: number;
  method: PayMethod;
  note: string | null;
  created_at: string;
};

/** Entrega en consignación: mercadería tuya en manos de un revendedor hasta que la vende o la devuelve. */
export type Consignment = {
  id: string;
  user_id: string;
  customer_id: string;
  customer_name: string | null;
  status: "abierta" | "liquidada";
  note: string | null;
  created_at: string;
  closed_at: string | null;
};

export type ConsignmentItem = {
  id: string;
  consignment_id: string;
  user_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  qty_out: number;
  qty_sold: number;
  qty_returned: number;
  unit_price: number;
  created_at: string;
};

export type CashMovement = { id: string; user_id: string; tipo: "ingreso" | "retiro"; amount: number; note: string | null; created_at: string };

export type CashClosing = {
  id: string;
  user_id: string;
  day: string;
  sales_count: number;
  total_sales: number;
  by_method: Record<string, number>;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  profit: number;
  note: string | null;
  closed_at: string;
};

export type StockMovement = {
  id: number;
  user_id: string;
  product_id: string | null;
  product_name: string | null;
  variant_id: string | null;
  variant_label: string | null;
  purchase_id?: string | null;
  count_id?: string | null;
  sale_id?: string | null;
  consignment_id?: string | null;
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
  business_id?: string | null;
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
  alerts_off?: boolean;
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
  alerts_off?: boolean; // descartado de los avisos de reposición / vencimiento
  deleted_at?: string | null; // papelera (borrado suave)
  business_id?: string | null;
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
        Insert: Omit<Category, "id" | "created_at" | "icon" | "min_stock_default" | "alerts_off"> & { id?: string; created_at?: string; icon?: string | null; min_stock_default?: number | null; alerts_off?: boolean };
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
          sale_id?: string | null;
          consignment_id?: string | null;
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
      businesses: {
        Row: Business;
        Insert: Omit<Business, "id" | "created_at" | "plan"> & { id?: string; created_at?: string; plan?: string };
        Update: Partial<Business>;
        Relationships: [];
      };
      business_members: {
        Row: BusinessMember;
        Insert: Omit<BusinessMember, "created_at" | "has_pin" | "active" | "display_name" | "role"> & { created_at?: string; has_pin?: boolean; active?: boolean; display_name?: string | null; role?: MemberRole };
        Update: Partial<BusinessMember>;
        Relationships: [];
      };
      invites: {
        Row: Invite;
        Insert: Omit<Invite, "id" | "created_at" | "expires_at" | "used_by" | "used_at" | "role"> & { id?: string; created_at?: string; expires_at?: string; used_by?: string | null; used_at?: string | null; role?: MemberRole };
        Update: Partial<Invite>;
        Relationships: [];
      };
      customers: {
        Row: Customer;
        Insert: Omit<Customer, "id" | "created_at" | "phone" | "note" | "credit_limit" | "deleted_at"> & { id?: string; created_at?: string; phone?: string | null; note?: string | null; credit_limit?: number | null; deleted_at?: string | null };
        Update: Partial<Customer>;
        Relationships: [];
      };
      payments: {
        Row: Payment;
        Insert: Omit<Payment, "id" | "created_at" | "method" | "note"> & { id?: string; created_at?: string; method?: PayMethod; note?: string | null };
        Update: Partial<Payment>;
        Relationships: [];
      };
      consignments: {
        Row: Consignment;
        Insert: Omit<Consignment, "id" | "created_at" | "closed_at" | "status" | "customer_name" | "note"> & { id?: string; created_at?: string; closed_at?: string | null; status?: "abierta" | "liquidada"; customer_name?: string | null; note?: string | null };
        Update: Partial<Consignment>;
        Relationships: [];
      };
      consignment_items: {
        Row: ConsignmentItem;
        Insert: Omit<ConsignmentItem, "id" | "created_at" | "product_id" | "variant_id" | "product_name" | "variant_label" | "qty_sold" | "qty_returned" | "unit_price"> & {
          id?: string;
          created_at?: string;
          product_id?: string | null;
          variant_id?: string | null;
          product_name?: string | null;
          variant_label?: string | null;
          qty_sold?: number;
          qty_returned?: number;
          unit_price?: number;
        };
        Update: Partial<ConsignmentItem>;
        Relationships: [];
      };
      sales: {
        Row: Sale;
        Insert: Omit<Sale, "id" | "created_at" | "number" | "customer_id" | "customer_name" | "status" | "method" | "subtotal" | "discount" | "total" | "paid" | "cost_total" | "items" | "note"> & {
          id?: string;
          created_at?: string;
          number?: number | null;
          customer_id?: string | null;
          customer_name?: string | null;
          status?: SaleStatus;
          method?: PayMethod;
          subtotal?: number;
          discount?: number;
          total?: number;
          paid?: number;
          cost_total?: number;
          items?: number;
          note?: string | null;
        };
        Update: Partial<Sale>;
        Relationships: [];
      };
      sale_items: {
        Row: SaleItem;
        Insert: Omit<SaleItem, "id" | "created_at" | "product_id" | "variant_id" | "product_name" | "variant_label" | "unit_cost" | "unit_price" | "line_total"> & {
          id?: string;
          created_at?: string;
          product_id?: string | null;
          variant_id?: string | null;
          product_name?: string | null;
          variant_label?: string | null;
          unit_cost?: number | null;
          unit_price?: number;
          line_total?: number;
        };
        Update: Partial<SaleItem>;
        Relationships: [];
      };
      cash_movements: {
        Row: CashMovement;
        Insert: Omit<CashMovement, "id" | "created_at" | "note"> & { id?: string; created_at?: string; note?: string | null };
        Update: Partial<CashMovement>;
        Relationships: [];
      };
      cash_closings: {
        Row: CashClosing;
        Insert: Omit<CashClosing, "id" | "closed_at" | "sales_count" | "total_sales" | "by_method" | "cash_in" | "cash_out" | "expected_cash" | "counted_cash" | "difference" | "profit" | "note"> & {
          id?: string;
          business_id?: string | null;
          closed_at?: string;
          sales_count?: number;
          total_sales?: number;
          by_method?: Record<string, number>;
          cash_in?: number;
          cash_out?: number;
          expected_cash?: number;
          counted_cash?: number | null;
          difference?: number | null;
          profit?: number;
          note?: string | null;
        };
        Update: Partial<CashClosing>;
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
          alerts_off?: boolean;
          deleted_at?: string | null;
          business_id?: string | null;
        };
        Update: Partial<Product>;
        Relationships: [];
      };
    };
    Views: {
      product_summaries: { Row: ProductSummary; Relationships: [] };
    };
    Functions: {
      accept_invite: { Args: { p_code: string; p_display_name?: string | null }; Returns: string };
      verify_pin: { Args: { p_business: string; p_user: string; p_pin: string }; Returns: boolean };
      set_pin: { Args: { p_business: string; p_pin: string }; Returns: undefined };
      set_my_name: { Args: { p_business: string; p_name: string }; Returns: undefined };
      current_business_id: { Args: Record<string, never>; Returns: string | null };
    };
    Enums: { field_type: FieldType; product_status: ProductStatus; movement_type: MovementType; sale_status: SaleStatus; pay_method: PayMethod };
    CompositeTypes: { [_ in never]: never };
  };
}
