import { Flag, Goal, RefreshCcw, ShieldAlert, Siren, Square, UserRoundCheck } from 'lucide-react';
import type { MatchEventItem, MatchEventsResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface MatchEventTimelineProps {
  data: MatchEventsResponse;
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    goal: '进球',
    yellow_card: '黄牌',
    red_card: '红牌',
    substitution: '换人',
    injury: '伤停',
    var: 'VAR',
    penalty: '点球',
    lineup_confirmed: '首发公布',
  };
  return labels[type] ?? type;
}

function eventIcon(type: MatchEventItem['eventType']) {
  if (type === 'goal') return Goal;
  if (type === 'yellow_card' || type === 'red_card') return Square;
  if (type === 'substitution') return RefreshCcw;
  if (type === 'injury') return ShieldAlert;
  if (type === 'var' || type === 'penalty') return Siren;
  if (type === 'lineup_confirmed') return UserRoundCheck;
  return Flag;
}

export function MatchEventTimeline({ data }: MatchEventTimelineProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">比赛事件时间线</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">{data.explanation}</p>
        </div>
        <span className="rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs numeric text-odds-muted">
          {data.events.length}
        </span>
      </div>

      {data.events.length === 0 ? (
        <DataStatusPanel
          moduleName="比赛事件"
          sourceStatus={data.sourceStatus}
          dataSource={data.dataSource}
          updatedAt={data.updatedAt}
          rowCount={0}
          reason="当前数据库没有该比赛的事件时间线记录。"
          suggestedAction="接入事件源后写入 match_events，用 event_type 标记进球、红黄牌、换人、VAR 和首发公布。"
        />
      ) : null}

      <div className="space-y-3">
        {data.events.map((event) => {
          const Icon = eventIcon(event.eventType);
          return (
            <article key={event.id ?? `${event.eventTime}-${event.eventType}`} className="flex gap-3 rounded-lg border border-odds-border bg-odds-control/45 p-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-odds-border bg-odds-panel">
                <Icon className="h-4 w-4 text-odds-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-odds-muted">
                  <span className="numeric">{event.minute ? `${event.minute}'` : event.eventTime}</span>
                  <span>{eventLabel(event.eventType)}</span>
                  {event.teamName ? <span>{event.teamName}</span> : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-odds-text3">
                  {event.description || event.playerName || '事件详情待补充'}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
