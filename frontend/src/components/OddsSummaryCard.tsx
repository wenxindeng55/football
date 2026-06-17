import { TrendingDown, TrendingUp } from 'lucide-react';
import type { SummaryCardData } from '../types/odds';
import { changeTone, formatPercent } from '../utils/format';

interface OddsSummaryCardProps {
  summary: SummaryCardData;
}

export function OddsSummaryCard({ summary }: OddsSummaryCardProps) {
  const isDown = summary.changePercent < 0;
  const Icon = isDown ? TrendingDown : TrendingUp;

  return (
    <article className="surface h-fit min-w-0 self-start bg-odds-panel2/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-odds-text">{summary.title}</p>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs numeric ${isDown ? 'border-odds-success/30 bg-odds-success/10 text-odds-success' : 'border-odds-danger/30 bg-odds-danger/10 text-odds-danger'}`}>
          <Icon className="h-3.5 w-3.5" />
          {formatPercent(summary.changePercent)}
        </span>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
          <p className="text-xs text-odds-muted">开盘赔率</p>
          <p className="mt-1 break-words text-base font-bold numeric leading-7 text-odds-text sm:text-lg">
            {summary.openingOdds}
          </p>
        </div>
        <div className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
          <p className="text-xs text-odds-muted">当前赔率</p>
          <p className={`mt-1 break-words text-base font-bold numeric leading-7 sm:text-lg ${changeTone(summary.changePercent)}`}>
            {summary.currentOdds}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-odds-text3">{summary.explanation}</p>
    </article>
  );
}
