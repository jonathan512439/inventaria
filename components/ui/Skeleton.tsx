/** Esqueletos de carga (en vez de "Cargando…"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-2xl ${className}`} aria-hidden />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-3">
          <Skeleton className="h-16 w-16 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card space-y-4 p-0">
      <Skeleton className="aspect-[4/3] rounded-b-none rounded-t-3xl" />
      <div className="space-y-3 px-5 pb-5">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
        <Skeleton className="h-14 w-full rounded-3xl" />
      </div>
    </div>
  );
}
