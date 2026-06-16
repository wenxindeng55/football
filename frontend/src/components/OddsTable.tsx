import { ArrowDown, ArrowUp } from 'lucide-react';
import type { OddsTableRow } from '../types/odds';
import { changeTone, formatOdds, formatPercent } from '../utils/format';

interface OddsTableProps {
  rows: OddsTableRow[];
}

export function OddsTable({ rows }: OddsTableProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">盘口变化表格</h3>
          <p className="mt-1 text-sm text-odds-muted">每 10 分钟采集一次，表格随盘口类型同步切换。</p>
        </div>
        <span className="rounded-md border border-odds-border bg-odds-control/55 px-3 py-2 text-xs text-odds-muted">
          {rows.length} 条
        </span>
      </div>

      <div className="hidden max-h-[420px] overflow-y-auto xl:block">
        <div className="sticky top-0 z-10 grid grid-cols-[80px_100px_minmax(120px,1fr)_92px_92px_118px_minmax(220px,1.5fr)] gap-2 rounded-lg border border-odds-border bg-odds-control px-3 py-3 text-xs font-medium text-odds-muted">
          <span>时间</span>
          <span>盘口类型</span>
          <span>选项</span>
          <span>开盘赔率</span>
          <span>当前赔率</span>
          <span>变化百分比</span>
          <span>简单解读</span>
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((row, index) => {
            const down = row.changePercent < 0;
            const Icon = down ? ArrowDown : ArrowUp;
            return (
              <div
                key={`${row.time}-${row.marketType}-${row.option}-${row.currentOdds}-${index}`}
                className="grid grid-cols-[80px_100px_minmax(120px,1fr)_92px_92px_118px_minmax(220px,1.5fr)] gap-2 rounded-lg border border-odds-border bg-odds-control/45 px-3 py-3 text-sm text-odds-text2 hover:border-odds-accent/35"
              >
                <span className="numeric text-odds-muted">{row.time}</span>
                <span>{row.marketType}</span>
                <span className="font-medium text-odds-text">{row.option}</span>
                <span className="numeric">{formatOdds(row.openingOdds)}</span>
                <span className="numeric font-semibold">{formatOdds(row.currentOdds)}</span>
                <span className={`inline-flex items-center gap-1 numeric font-semibold ${changeTone(row.changePercent)}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {formatPercent(row.changePercent)}
                </span>
                <span className="text-odds-text3">{row.interpretation}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto xl:hidden">
        {rows.map((row, index) => {
          const down = row.changePercent < 0;
          const Icon = down ? ArrowDown : ArrowUp;
          return (
            <article key={`${row.time}-${row.marketType}-${row.option}-${row.currentOdds}-${index}`} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-odds-muted">
                <span className="numeric">{row.time}</span>
                <span>{row.marketType}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="font-semibold text-odds-text">{row.option}</p>
                <span className={`inline-flex items-center gap-1 numeric font-semibold ${changeTone(row.changePercent)}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {formatPercent(row.changePercent)}
                </span>
              </div>
              <p className="mt-2 text-sm text-odds-text3">
                <span className="numeric">{formatOdds(row.openingOdds)}</span>
                <span className="px-2 text-odds-muted">→</span>
                <span className="numeric font-semibold">{formatOdds(row.currentOdds)}</span>
              </p>
              <p className="mt-2 text-sm text-odds-text3">{row.interpretation}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
