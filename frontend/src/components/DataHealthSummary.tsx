export interface DataHealthItem {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

interface DataHealthSummaryProps {
  items: DataHealthItem[];
}

function toneClass(tone: DataHealthItem['tone']) {
  if (tone === 'success') return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  if (tone === 'danger') return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (tone === 'info') return 'border-odds-accent/35 bg-odds-accent/10 text-odds-accent';
  return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
}

export function DataHealthSummary({ items }: DataHealthSummaryProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {items.map((item) => (
        <span key={item.label} className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs ${toneClass(item.tone)}`}>
          <span className="font-semibold">{item.label}：</span>
          <span className="numeric">{item.value}</span>
        </span>
      ))}
    </div>
  );
}
