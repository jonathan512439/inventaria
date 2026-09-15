import CategoryInventoryClient from "./CategoryInventoryClient";

// Ruta con parámetro: se resuelve en el servidor (edge). El resto de pantallas son estáticas.
export const runtime = "edge";

export default function CategoryInventoryPage() {
  return <CategoryInventoryClient />;
}
