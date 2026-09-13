import type { FieldType } from "@/types/database";

/**
 * Rubros preconfigurados: cada uno trae sus secciones ("estantes") y los datos que se guardan
 * por producto, ya marcados según los llena la IA desde la foto o el usuario.
 */
export interface PresetField {
  name: string;
  field_type: FieldType;
  is_ai_fillable: boolean;
  options?: string[];
  default_value?: string;
}

export interface Preset {
  id: string;
  name: string;
  icon: string;
  description: string;
  sections: string[];
  fields: PresetField[];
}

/** Datos comunes a todos los rubros (primero los que llena la IA, luego los del usuario). */
const BASE_AI: PresetField[] = [
  { name: "nombre", field_type: "text", is_ai_fillable: true },
  { name: "marca", field_type: "text", is_ai_fillable: true },
  { name: "descripcion", field_type: "text", is_ai_fillable: true },
];
const BASE_USER: PresetField[] = [
  { name: "precio", field_type: "number", is_ai_fillable: false },
  { name: "precio_compra", field_type: "number", is_ai_fillable: false },
  { name: "stock", field_type: "number", is_ai_fillable: false, default_value: "1" },
];

const p = (id: string, name: string, icon: string, description: string, sections: string[], extraAi: PresetField[] = [], extraUser: PresetField[] = []): Preset => ({
  id,
  name,
  icon,
  description,
  sections,
  fields: [...BASE_AI, ...extraAi, ...BASE_USER, ...extraUser],
});

export const PRESETS: Preset[] = [
  p("libreria", "Librería y papelería", "📚", "Cuadernos, útiles, papel, arte y oficina",
    ["Cuadernos y agendas", "Lápices y bolígrafos", "Papel y cartulinas", "Arte y manualidades", "Útiles escolares", "Oficina", "Mochilas y estuches", "Libros"],
    [{ name: "color", field_type: "text", is_ai_fillable: true }, { name: "presentacion", field_type: "text", is_ai_fillable: true }],
    [{ name: "unidades_por_paquete", field_type: "number", is_ai_fillable: false, default_value: "1" }]),
  p("ropa", "Ropa", "👕", "Prendas para dama, caballero y niños",
    ["Dama", "Caballero", "Niños", "Ropa interior", "Deportiva", "Accesorios"],
    [{ name: "color", field_type: "text", is_ai_fillable: true }, { name: "tipo_prenda", field_type: "text", is_ai_fillable: true }, { name: "material", field_type: "text", is_ai_fillable: true }],
    [{ name: "talla", field_type: "select", is_ai_fillable: true, options: ["XS", "S", "M", "L", "XL", "XXL", "Única"] }]),
  p("calzado", "Calzado", "👟", "Zapatos, zapatillas, sandalias",
    ["Dama", "Caballero", "Niños", "Deportivo", "Sandalias", "Botas"],
    [{ name: "color", field_type: "text", is_ai_fillable: true }, { name: "material", field_type: "text", is_ai_fillable: true }],
    [{ name: "talla", field_type: "number", is_ai_fillable: false }]),
  p("bebidas", "Bebidas", "🥤", "Gaseosas, agua, jugos, cerveza, licores",
    ["Gaseosas", "Agua", "Jugos y néctares", "Energizantes", "Cerveza", "Vinos y licores", "Lácteos"],
    [{ name: "sabor", field_type: "text", is_ai_fillable: true }, { name: "volumen", field_type: "text", is_ai_fillable: true }],
    [{ name: "unidades_por_paquete", field_type: "number", is_ai_fillable: false, default_value: "1" }]),
  p("abarrotes", "Abarrotes y tienda", "🛒", "Alimentos envasados, snacks, despensa",
    ["Arroz, fideos y granos", "Aceites y conservas", "Snacks y golosinas", "Panadería y galletas", "Lácteos y huevos", "Condimentos", "Café, té y azúcar"],
    [{ name: "peso_o_contenido", field_type: "text", is_ai_fillable: true }, { name: "sabor", field_type: "text", is_ai_fillable: true }],
    [{ name: "unidades_por_paquete", field_type: "number", is_ai_fillable: false, default_value: "1" }]),
  p("limpieza", "Limpieza y hogar", "🧴", "Detergentes, desinfectantes, cocina, baño",
    ["Detergentes y jabones", "Desinfectantes", "Papel y toallas", "Cocina", "Baño", "Ambientadores"],
    [{ name: "aroma", field_type: "text", is_ai_fillable: true }, { name: "contenido", field_type: "text", is_ai_fillable: true }]),
  p("ferreteria", "Ferretería", "🔧", "Herramientas, tornillería, eléctricos, pintura",
    ["Herramientas manuales", "Herramientas eléctricas", "Tornillos y fijaciones", "Eléctricos", "Plomería", "Pintura", "Construcción"],
    [{ name: "medida", field_type: "text", is_ai_fillable: true }, { name: "material", field_type: "text", is_ai_fillable: true }, { name: "modelo", field_type: "text", is_ai_fillable: true }],
    [{ name: "unidad_de_venta", field_type: "select", is_ai_fillable: false, options: ["unidad", "par", "metro", "caja", "kilo"], default_value: "unidad" }]),
  p("farmacia", "Farmacia", "💊", "Medicamentos, vitaminas, cuidado personal",
    ["Analgésicos", "Antibióticos", "Vitaminas y suplementos", "Cuidado personal", "Primeros auxilios", "Bebé", "Dermatología"],
    [{ name: "presentacion", field_type: "text", is_ai_fillable: true }, { name: "contenido", field_type: "text", is_ai_fillable: true }, { name: "principio_activo", field_type: "text", is_ai_fillable: true }],
    [{ name: "fecha_vencimiento", field_type: "text", is_ai_fillable: false }]),
  p("cosmeticos", "Cosméticos y belleza", "💄", "Maquillaje, cabello, piel, perfumes",
    ["Maquillaje", "Cabello", "Cuidado de la piel", "Perfumes", "Uñas", "Accesorios"],
    [{ name: "color_o_tono", field_type: "text", is_ai_fillable: true }, { name: "contenido", field_type: "text", is_ai_fillable: true }]),
  p("electronica", "Electrónica y celulares", "📱", "Celulares, accesorios, audio, computación",
    ["Celulares", "Fundas y protectores", "Cargadores y cables", "Audio", "Computación", "Smart TV y hogar", "Gaming"],
    [{ name: "modelo", field_type: "text", is_ai_fillable: true }, { name: "color", field_type: "text", is_ai_fillable: true }, { name: "compatibilidad", field_type: "text", is_ai_fillable: true }],
    [{ name: "garantia_meses", field_type: "number", is_ai_fillable: false }]),
  p("jugueteria", "Juguetería", "🧸", "Juguetes por edad y tipo",
    ["Bebés", "Muñecas y figuras", "Vehículos", "Juegos de mesa", "Educativos", "Aire libre", "Peluches"],
    [{ name: "color", field_type: "text", is_ai_fillable: true }, { name: "edad_recomendada", field_type: "text", is_ai_fillable: true }]),
  p("repuestos", "Repuestos y autopartes", "🏍️", "Piezas para auto y moto, lubricantes",
    ["Motor", "Frenos", "Suspensión", "Eléctrico", "Lubricantes y filtros", "Llantas", "Accesorios"],
    [{ name: "modelo", field_type: "text", is_ai_fillable: true }, { name: "compatibilidad", field_type: "text", is_ai_fillable: true }, { name: "codigo", field_type: "text", is_ai_fillable: true }]),
];

export const getPreset = (id: string) => PRESETS.find((x) => x.id === id);
