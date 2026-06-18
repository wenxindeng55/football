import { useEffect, useMemo, useState } from 'react';
import { Database, Filter, RefreshCw } from 'lucide-react';
import { fetchRawOdds, type RawMarketFilter, type RawOddsResponse } from '../api/oddsApi';
import { marketLabels, marketOrder } from '../data/marketConfig';
import { formatOdds, formatPercent } from '../utils/format';
import { localizeText } from '../utils/display';
import { EmptyState, LoadingState } from './DataStatus';

interface RawOddsPanelProps {
  matchId: string;
  canRead?: boolean;
}

const PAGE_SIZE = 20;

const marketOptions: Array<{ key: RawMarketFilter; label: string }> = [
  { key: 'all', label: '全部盘口' },
  ...marketOrder.map((key) => ({ key, label: marketLabels[key] })),
];

export function RawOddsPanel({ matchId, canRead = true }: RawOddsPanelProps) {
  const [market, setMarket] = useState<RawMarketFilter>('all');
  const [changedOnly, setChangedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<RawOddsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offset = (page - 1) * PAGE_SIZE;
  const rows = response?.rows ?? [];
  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeText = useMemo(() => {
    if (!response || total === 0) return '0 / 0';
    return `${offset + 1}-${offset + rows.length} / ${total}`;
  }, [offset, response, rows.length, total]);

  useEffect(() => {
    setPage(1);
  }, [changedOnly, market, matchId]);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      setResponse(null);
      setError(null);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchRawOdds(matchId, { market, changedOnly, limit: PAGE_SIZE, offset })
      .then((data) => {
        if (active) setResponse(data);
      })
      .catch((fetchError) => {
        if (!active) return;
        const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        setError(message);
        setResponse(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canRead, changedOnly, matchId, market, offset]);

  return (
    <section className="surface min-w-0 overflow-hidden bg-odds-panel2/70">
      <div className="border-b border-odds-border px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-odds-text">原始盘口快照</h3>
            <p className="mt-1 text-sm leading-6 text-odds-muted">
              服务端分页读取 SQLite 快照，默认最近 20 条，不一次性渲染全部记录。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_auto] xl:min-w-[430px]">
            <label className="focus-within:ring-2 focus-within:ring-odds-accent/50 flex min-h-10 items-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 text-sm text-odds-text2">
              <Filter className="h-4 w-4 shrink-0 text-odds-accent" />
              <select
                value={market}
                onChange={(event) => setMarket(event.target.value as RawMarketFilter)}
                className="min-w-0 flex-1 bg-transparent text-odds-text focus:outline-none"
                aria-label="筛选盘口类型"
              >
                {marketOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="focus-within:ring-2 focus-within:ring-odds-accent/50 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 text-sm text-odds-text2">
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(event) => setChangedOnly(event.target.checked)}
                className="h-4 w-4 accent-odds-accent"
              />
              只看有变化
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-odds-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-odds-muted">
          <span className="inline-flex items-center gap-2 rounded-full border border-odds-border bg-odds-control/55 px-3 py-2">
            <Database className="h-4 w-4 text-odds-accent" />
            {rangeText}
          </span>
          <span className="rounded-full border border-odds-border bg-odds-control/55 px-3 py-2">
            第 {page}/{totalPages} 页
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="focus-ring rounded-lg border border-odds-border bg-odds-control px-3 py-2 text-xs text-odds-text2 hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={!response?.hasMore || loading}
            onClick={() => setPage((current) => current + 1)}
            className="focus-ring rounded-lg border border-odds-border bg-odds-control px-3 py-2 text-xs text-odds-text2 hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            下一页
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {!canRead ? (
          <EmptyState
            title="原始盘口快照"
            reasonCode="api_not_called"
            reason="当前未登录管理员账号，页面不会调用原始数据接口。"
            rowCount={0}
            suggestedAction="登录管理员后再查看后台 SQLite 原始盘口快照。"
            tone="info"
          />
        ) : null}
        {canRead && loading ? <LoadingState title="正在读取原始盘口快照..." /> : null}
        {canRead && !loading && error ? (
          <EmptyState
            title="原始盘口快照"
            reasonCode="fetch_failed"
            reason={`原始数据接口读取失败：${error}`}
            rowCount={0}
            suggestedAction="确认后端服务、SQLite 文件和 /api/matches/{match_id}/raw 接口是否可用。"
            tone="danger"
          />
        ) : null}
        {canRead && !loading && !error && rows.length === 0 ? (
          <EmptyState
            title="原始盘口快照"
            reasonCode={changedOnly ? 'api_zero_rows' : 'database_no_records'}
            reason={changedOnly ? '当前筛选条件下接口返回 0 条变化记录。' : '数据库当前没有该比赛和盘口筛选条件下的原始快照记录。'}
            rowCount={0}
            suggestedAction="检查采集任务是否运行、match_id 是否映射到正确 match_url，并确认缓存已刷新。"
          />
        ) : null}

        {canRead && !loading && !error && rows.length > 0 ? (
          <>
            <div className="hidden max-h-[620px] overflow-auto xl:block">
              <table className="w-full min-w-[980px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="sticky top-0 z-10 text-xs text-odds-muted">
                  <tr>
                    <th className="rounded-l-lg bg-odds-control px-3 py-2">采集时间</th>
                    <th className="bg-odds-control px-3 py-2">盘口类型</th>
                    <th className="bg-odds-control px-3 py-2">选项</th>
                    <th className="bg-odds-control px-3 py-2">开盘</th>
                    <th className="bg-odds-control px-3 py-2">当前</th>
                    <th className="bg-odds-control px-3 py-2">变化</th>
                    <th className="rounded-r-lg bg-odds-control px-3 py-2">页面更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="text-odds-text2">
                      <td className="rounded-l-lg border-y border-l border-odds-border bg-odds-control/45 px-3 py-2 numeric">
                        {row.collectedAt}
                      </td>
                      <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2">{localizeText(row.marketType)}</td>
                      <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 font-medium text-odds-text">
                        {localizeText(row.optionName)}
                      </td>
                      <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 numeric">{formatOdds(row.openingOdds)}</td>
                      <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 numeric font-semibold">
                        {formatOdds(row.currentOdds)}
                      </td>
                      <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 numeric">{formatPercent(row.changePercent)}</td>
                      <td className="rounded-r-lg border-y border-r border-odds-border bg-odds-control/45 px-3 py-2 numeric text-odds-muted">
                        {row.pageUpdatedAt || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 xl:hidden">
              {rows.map((row) => (
                <article key={row.id} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
                  <div className="flex items-start justify-between gap-3 text-xs text-odds-muted">
                    <span className="numeric">{row.collectedAt}</span>
                    <span>{localizeText(row.marketType)}</span>
                  </div>
                  <p className="mt-2 font-semibold text-odds-text">{localizeText(row.optionName)}</p>
                  <p className="mt-2 text-sm text-odds-text3">
                    <span className="numeric">{formatOdds(row.openingOdds)}</span>
                    <span className="px-2 text-odds-muted">→</span>
                    <span className="numeric font-semibold">{formatOdds(row.currentOdds)}</span>
                    <span className="ml-2 numeric text-odds-danger">{formatPercent(row.changePercent)}</span>
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : null}
        {canRead && loading ? (
          <div className="mt-3 inline-flex items-center gap-2 text-xs text-odds-muted">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            正在等待接口响应
          </div>
        ) : null}
      </div>
    </section>
  );
}
