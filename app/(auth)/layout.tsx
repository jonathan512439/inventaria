export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="animate-in w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-float" style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></svg>
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">InventarIA</h1>
          <p className="mt-1 text-sm text-slate-500">Tu inventario con una foto</p>
        </div>
        {children}
      </div>
    </main>
  );
}
