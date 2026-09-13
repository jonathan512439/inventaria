import ProductListPage from "@/components/ProductListPage";

export default function DraftsPage() {
  return (
    <ProductListPage
      mode="draft"
      title="Borradores"
      subtitle="Corrige lo que la IA infirió y completa precio, stock, etc. Luego confirma."
    />
  );
}
