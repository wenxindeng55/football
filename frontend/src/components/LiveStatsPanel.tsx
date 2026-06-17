import { Activity } from 'lucide-react';
import type { LiveStatPoint, LiveStatsResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface LiveStatsPanelProps {
  data: LiveStatsResponse;
}

const metrics: Array<{ key: keyof LiveStatPoint; label: string; suffix?: string }> = [
  { key: 'possession', label: '控球率', suffix: '%' },
  { key: 'shots', label: '射门' },
  { key: 'shotsOnTarget', label: '射正' },
  { key: 'corners', label: '角球' },
  { key: 'dangerousAttacks', label: '危险进攻' },
  { key: 'xg', label: 'xG' },
  { key: 'yellowCards', label: '黄牌' },
  { key: 'redCards', label: '红牌' },
];

function valueText(value: unknown, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`;
}

export function LiveStatsPanel({ data }: LiveStatsPanelProps) {
  const minute = data.latest[0]?.minute;

  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">赛中技术统计</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">{data.explanation}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs numeric text-odds-muted">
          <Activity className="h-3.5 w-3.5 text-odds-success" />
          {minute ? `${minute}'` : '赛前'}
        </span>
      </div>

      {data.latest.length === 0 ? (
        <DataStatusPanel
          moduleName="赛中技术统计"
          sourceStatus={data.sourceStatus}
          dataSource={data.dataSource}
          updatedAt={data.updatedAt}
          rowCount={0}
          reason="当前数据库没有该比赛的技术统计时间序列。"
          suggestedAction="接入赛中统计源后写入 match_stats，至少包含控球、射门、射正、角球、危险进攻和 xG。"
        />
      ) : null}

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {data.latest.map((team) => (
          <article key={team.teamName} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
            <p className="mb-3 truncate font-semibold text-odds-text">{team.teamName}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {metrics.map((metric) => (
                <div key={metric.key} className="rounded-md bg-odds-panel/60 p-2">
                  <p className="text-xs text-odds-muted">{metric.label}</p>
                  <p className="mt-1 numeric text-sm font-semibold text-odds-text">
                    {valueText(team[metric.key], metric.suffix)}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
