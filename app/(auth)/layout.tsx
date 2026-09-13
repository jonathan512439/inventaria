export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-brand-700">InventarIA</h1>
          <p className="mt-1 text-sm text-slate-500">Inventario con fotos + IA</p>
        </div>
        {children}
      </div>
    </main>
  );
}
