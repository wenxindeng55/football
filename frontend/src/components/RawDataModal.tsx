import { X } from 'lucide-react';
import type { RawOddsRow } from '../api/oddsApi';
import { formatOdds, formatPercent } from '../utils/format';
import { localizeText } from '../utils/display';

interface RawDataModalProps {
  open: boolean;
  rows: RawOddsRow[];
  loading: boolean;
  onClose: () => void;
}

export function RawDataModal({ open, rows, loading, onClose }: RawDataModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <section className="surface flex max-h-[86vh] w-full max-w-5xl flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-odds-text">原始采集数据</h3>
            <p className="mt-1 text-sm text-odds-muted">直接来自后台 SQLite 快照接口</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md border border-odds-border bg-odds-control p-2 text-odds-text2 hover:border-odds-accent/50"
            aria-label="关闭原始数据"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid min-h-[220px] place-items-center text-sm text-odds-muted">正在读取后台原始数据...</div>
        ) : (
          <div className="min-h-0 overflow-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-y-2 text-left text-sm">
              <thead className="sticky top-0 z-10 text-xs text-odds-muted">
                <tr>
                  <th className="bg-odds-control px-3 py-2">采集时间</th>
                  <th className="bg-odds-control px-3 py-2">比赛</th>
                  <th className="bg-odds-control px-3 py-2">盘口</th>
                  <th className="bg-odds-control px-3 py-2">选项</th>
                  <th className="bg-odds-control px-3 py-2">开盘</th>
                  <th className="bg-odds-control px-3 py-2">当前</th>
                  <th className="bg-odds-control px-3 py-2">变化</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="text-odds-text2">
                    <td className="rounded-l-lg border-y border-l border-odds-border bg-odds-control/45 px-3 py-2 numeric">
                      {row.collectedAt}
                    </td>
                    <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2">
                      {localizeText(row.matchName)}
                    </td>
                    <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2">
                      {localizeText(row.marketType)}
                    </td>
                    <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 font-medium text-odds-text">
                      {localizeText(row.optionName)}
                    </td>
                    <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 numeric">
                      {formatOdds(row.openingOdds)}
                    </td>
                    <td className="border-y border-odds-border bg-odds-control/45 px-3 py-2 numeric font-semibold">
                      {formatOdds(row.currentOdds)}
                    </td>
                    <td className="rounded-r-lg border-y border-r border-odds-border bg-odds-control/45 px-3 py-2 numeric">
                      {formatPercent(row.changePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="grid min-h-[180px] place-items-center text-sm text-odds-muted">当前盘口暂无原始数据</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
