import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { OddsTableRow } from '../types/odds';
import { changeTone, formatOdds, formatPercent } from '../utils/format';
import { EmptyState } from './DataStatus';

interface OddsTableProps {
  rows: OddsTableRow[];
}

const PAGE_SIZE = 20;

export function OddsTable({ rows }: OddsTableProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = useMemo(() => rows.slice(startIndex, startIndex + PAGE_SIZE), [rows, startIndex]);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const hasRows = rows.length > 0;
  const endIndex = hasRows ? Math.min(startIndex + pageRows.length, rows.length) : 0;

  return (
    <section className="surface min-w-0 overflow-hidden bg-odds-panel2/70">
      <div className="flex flex-col gap-3 border-b border-odds-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">盘口变化表格</h3>
          <p className="mt-1 text-sm text-odds-muted">每 10 分钟采集一次，表格随盘口类型同步切换。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-odds-border bg-odds-control/55 px-3 py-2 text-xs text-odds-muted">
            {hasRows ? `${startIndex + 1}-${endIndex} / ${rows.length}` : '0 条'}
          </span>
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="focus-ring rounded-lg border border-odds-border bg-odds-control px-3 py-2 text-xs text-odds-text2 hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            上一页
          </button>
          <span className="numeric text-xs text-odds-muted">
            {currentPage}/{totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="focus-ring rounded-lg border border-odds-border bg-odds-control px-3 py-2 text-xs text-odds-text2 hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            下一页
          </button>
        </div>
      </div>

      <div className="hidden max-h-[460px] overflow-y-auto p-4 xl:block">
        <div className="sticky top-0 z-10 grid grid-cols-[86px_100px_minmax(120px,1fr)_96px_96px_120px_minmax(220px,1.5fr)] gap-2 rounded-lg border border-odds-border bg-odds-control px-3 py-3 text-xs font-semibold text-odds-muted">
          <span>时间</span>
          <span>盘口类型</span>
          <span>选项</span>
          <span>开盘赔率</span>
          <span>当前赔率</span>
          <span>变化百分比</span>
          <span>简单解读</span>
        </div>
        <div className="mt-2 space-y-2">
          {pageRows.map((row, index) => {
            const down = row.changePercent < 0;
            const Icon = down ? ArrowDown : ArrowUp;
            const absoluteIndex = startIndex + index;
            return (
              <div
                key={`${row.time}-${row.marketType}-${row.option}-${row.currentOdds}-${absoluteIndex}`}
                className="grid grid-cols-[86px_100px_minmax(120px,1fr)_96px_96px_120px_minmax(220px,1.5fr)] gap-2 rounded-lg border border-odds-border bg-odds-control/40 px-3 py-3 text-sm text-odds-text2 hover:border-odds-accent/35 hover:bg-odds-accent/5"
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
        {!hasRows ? (
          <div className="mt-3">
            <EmptyState
              title="盘口变化表格"
              reasonCode="database_no_records"
              reason="数据库当前没有该比赛和盘口类型对应的快照记录。"
              rowCount={0}
              suggestedAction="确认采集任务是否运行，并检查 match_id 与 match_url 是否匹配。"
            />
          </div>
        ) : null}
      </div>

      <div className="max-h-[460px] space-y-3 overflow-y-auto p-4 xl:hidden">
        {pageRows.map((row, index) => {
          const down = row.changePercent < 0;
          const Icon = down ? ArrowDown : ArrowUp;
          const absoluteIndex = startIndex + index;
          return (
            <article key={`${row.time}-${row.marketType}-${row.option}-${row.currentOdds}-${absoluteIndex}`} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
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
        {!hasRows ? (
          <EmptyState
            title="盘口变化表格"
            reasonCode="database_no_records"
            reason="数据库当前没有该比赛和盘口类型对应的快照记录。"
            rowCount={0}
            suggestedAction="确认采集任务是否运行，并检查 match_id 与 match_url 是否匹配。"
          />
        ) : null}
      </div>
    </section>
  );
}
