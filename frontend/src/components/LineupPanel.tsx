import { ShieldCheck, UsersRound } from 'lucide-react';
import type { MatchLineupsResponse, PlayerItem } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface LineupPanelProps {
  data: MatchLineupsResponse;
}

function playerName(player: PlayerItem) {
  return typeof player === 'string' ? player : player.name;
}

function playerLabel(player: PlayerItem) {
  if (typeof player === 'string') return player;
  const shirt = player.shirtNumber ? `${player.shirtNumber} ` : '';
  const position = player.position ? ` · ${player.position}` : '';
  return `${shirt}${player.name}${position}`;
}

export function LineupPanel({ data }: LineupPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">赛前首发</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">{data.explanation}</p>
        </div>
        <UsersRound className="h-5 w-5 shrink-0 text-odds-accent" />
      </div>

      {data.lineups.length === 0 ? (
        <DataStatusPanel
          moduleName="首发名单"
          sourceStatus={data.sourceStatus}
          dataSource={data.dataSource}
          updatedAt={data.updatedAt}
          rowCount={0}
          reason="当前数据库没有该比赛的首发名单记录，页面不会使用 mock 冒充真实首发。"
          suggestedAction="补充 match_source_map 映射后，把外部阵容源写入 match_lineups 和 lineup_players。"
        />
      ) : null}

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {data.lineups.map((lineup) => {
          const missing = lineup.keyPlayersMissing.map(playerName).filter(Boolean);
          return (
            <article key={lineup.teamName} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-odds-text">{lineup.teamName}</p>
                  <p className="mt-1 text-xs text-odds-muted">阵型 {lineup.formation || '待确认'}</p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    lineup.lineupConfirmed
                      ? 'border-odds-success/35 bg-odds-success/10 text-odds-success'
                      : 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {lineup.lineupConfirmed ? '已确认' : lineup.status === 'partial' ? '部分阵容' : '待确认'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-odds-text3">
                <div className="rounded-md bg-odds-panel/60 p-2">
                  <p className="text-odds-muted">首发</p>
                  <p className="mt-1 numeric text-sm font-semibold text-odds-text">{lineup.starters.length}</p>
                </div>
                <div className="rounded-md bg-odds-panel/60 p-2">
                  <p className="text-odds-muted">替补</p>
                  <p className="mt-1 numeric text-sm font-semibold text-odds-text">{lineup.substitutes.length}</p>
                </div>
              </div>
              <p className={`mt-3 text-sm leading-6 ${missing.length > 0 ? 'text-odds-warning' : 'text-odds-text3'}`}>
                {missing.length > 0 ? `关键缺席：${missing.join('、')}` : '暂无关键球员缺席记录。'}
              </p>
              {lineup.starters.length > 0 ? (
                <div className="mt-3 rounded-md border border-odds-border bg-odds-panel/55 p-2">
                  <p className="text-xs font-semibold text-odds-muted">已返回球员</p>
                  <p className="mt-1 text-sm leading-6 text-odds-text3">
                    {lineup.starters.slice(0, 8).map(playerLabel).join('、')}
                    {lineup.starters.length > 8 ? ' 等' : ''}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
