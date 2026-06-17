import { Trophy } from 'lucide-react';
import type { GroupStandingResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface GroupMotivationPanelProps {
  data: GroupStandingResponse;
}

function motivationClass(level?: string | null) {
  if (/high|strong|must|高|强/i.test(level || '')) return 'text-odds-warning';
  if (/low|低/i.test(level || '')) return 'text-odds-muted';
  return 'text-odds-text3';
}

export function GroupMotivationPanel({ data }: GroupMotivationPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">小组形势</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">{data.explanation}</p>
        </div>
        <Trophy className="h-5 w-5 shrink-0 text-odds-accent" />
      </div>

      {data.teams.length === 0 ? (
        <DataStatusPanel
          moduleName="小组积分"
          sourceStatus={data.sourceStatus}
          dataSource={data.dataSource}
          updatedAt={data.updatedAt}
          rowCount={0}
          reason="当前数据库没有该比赛双方对应的小组积分记录。"
          suggestedAction="补充赛事/小组映射后写入 group_standings，并维护排名、净胜球和出线压力字段。"
        />
      ) : null}

      <div className="space-y-3">
        {data.teams.map((team) => (
          <article key={`${team.groupName}-${team.teamName}`} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-odds-text">{team.teamName}</p>
                <p className="mt-1 text-xs text-odds-muted">
                  {team.groupName} · 第 {team.rank ?? '-'} 名
                </p>
              </div>
              <span className="rounded-md border border-odds-border bg-odds-panel/65 px-2.5 py-1 text-xs numeric text-odds-text">
                {team.points} 分
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-odds-panel/60 p-2">
                <p className="text-odds-muted">赛</p>
                <p className="mt-1 numeric font-semibold text-odds-text">{team.played}</p>
              </div>
              <div className="rounded-md bg-odds-panel/60 p-2">
                <p className="text-odds-muted">净胜球</p>
                <p className="mt-1 numeric font-semibold text-odds-text">{team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}</p>
              </div>
              <div className="rounded-md bg-odds-panel/60 p-2">
                <p className="text-odds-muted">进/失</p>
                <p className="mt-1 numeric font-semibold text-odds-text">
                  {team.goalsFor}/{team.goalsAgainst}
                </p>
              </div>
            </div>

            <p className={`mt-3 text-sm leading-6 ${motivationClass(team.motivationLevel)}`}>
              {team.motivationText || '暂未记录明确出线压力。'}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
