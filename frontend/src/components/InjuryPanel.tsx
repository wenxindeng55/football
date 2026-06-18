import { HeartPulse } from 'lucide-react';
import type { MatchInjuriesResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface InjuryPanelProps {
  data: MatchInjuriesResponse;
}

function statusClass(status: string) {
  if (/(缺阵|停赛|out|suspended)/i.test(status)) return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (/(伤疑|doubt|questionable)/i.test(status)) return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  return 'border-odds-border bg-odds-control text-odds-text3';
}

export function InjuryPanel({ data }: InjuryPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">伤停信息</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">{data.explanation}</p>
        </div>
        <HeartPulse className="h-5 w-5 shrink-0 text-odds-warning" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {Object.entries(data.summary.byTeam).map(([team, count]) => (
          <span key={team} className="rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs text-odds-text3">
            {team} <span className="numeric text-odds-text">{count}</span> 人
          </span>
        ))}
        {data.summary.total === 0 ? (
          <span className="rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs text-odds-muted">
            0 条伤停记录
          </span>
        ) : null}
      </div>

      {data.injuries.length === 0 ? (
        <DataStatusPanel
          moduleName="伤停信息"
          sourceStatus={data.sourceStatus}
          dataSource={data.dataSource}
          updatedAt={data.updatedAt}
          rowCount={0}
          reason="当前数据库没有该比赛的伤停或停赛记录。"
          suggestedAction="接入伤停源后写入 injuries_suspensions，并保留 source_url 便于追溯。"
        />
      ) : null}

      <div className="space-y-2">
        {data.injuries.slice(0, 5).map((injury) => (
          <article key={`${injury.teamName}-${injury.playerName}`} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-odds-text">{injury.playerName}</p>
                <p className="mt-1 text-xs text-odds-muted">{injury.teamName}</p>
              </div>
              <span className={`shrink-0 rounded-md border px-2 py-1 text-xs ${statusClass(injury.status)}`}>
                {injury.status}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-odds-text3">
              {injury.reason || '原因待补充'}{injury.expectedReturn ? `，预计 ${injury.expectedReturn}` : ''}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
