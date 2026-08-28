export function BudgetBar({ allocated, total }: { allocated: number; total: number }) {
  const pct = Math.min(100, (allocated / total) * 100);
  const over = allocated > total;
  return (
    <div>
      <div className="flex justify-between text-xs text-text-muted mb-1">
        <span>${allocated.toFixed(2)} allocated</span>
        <span>${Math.max(0, total - allocated).toFixed(2)} remaining</span>
      </div>
      <div className="h-2 rounded-full bg-bg-raised overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${over ? 'bg-loss' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
