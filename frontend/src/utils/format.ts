export function formatOdds(value: number) {
  return value.toFixed(2);
}

export function formatPercent(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function changeTone(value: number) {
  if (value < 0) return 'text-odds-success';
  if (value > 0) return 'text-odds-danger';
  return 'text-odds-muted';
}

export function tagToneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  const toneMap = {
    success: 'border-odds-success/35 bg-odds-success/10 text-odds-success',
    warning: 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning',
    danger: 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger',
    neutral: 'border-odds-border bg-odds-control/70 text-odds-muted',
  };
  return toneMap[tone];
}
