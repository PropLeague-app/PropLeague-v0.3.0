export function SkeletonLoader({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-3 space-y-2">
      <SkeletonLoader className="h-4 w-1/2" />
      <SkeletonLoader className="h-3 w-full" />
      <SkeletonLoader className="h-3 w-3/4" />
    </div>
  );
}
