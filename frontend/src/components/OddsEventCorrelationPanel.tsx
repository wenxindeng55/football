import { Link2 } from 'lucide-react';
import type { MatchInsightsResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface OddsEventCorrelationPanelProps {
  data: MatchInsightsResponse;
}

function linkTypeLabel(type: string) {
  const labels: Record<string, string> = {
    lineup_related: '首发关联',
    injury_related: '伤停关联',
    red_card_related: '红牌关联',
    goal_related: '进球关联',
    market_only: '市场行为',
    unknown: '未知关联',
  };
  return labels[type] ?? type;
}

function confidenceText(confidence: number) {
  if (!Number.isFinite(confidence)) return '-';
  return `${Math.round(confidence * 100)}%`;
}

export function OddsEventCorrelationPanel({ data }: OddsEventCorrelationPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">盘口事件联动</h3>
          <p className="mt-1 text-sm text-odds-muted">
            已生成 {data.correlations.length} 条联动判断，更新时间 {data.generatedAt || '-'}。
          </p>
        </div>
        <Link2 className="h-5 w-5 shrink-0 text-odds-success" />
      </div>

      {data.correlations.length === 0 ? (
        <DataStatusPanel
          moduleName="盘口事件联动"
          dataSource={data.dataSource}
          rowCount={0}
          reason="当前没有可关联的盘口快照和比赛事件。"
          suggestedAction="先保证 odds_snapshots 与 match_events 有同一 match_id 的时间序列，再由 insight_service 生成 odds_event_links。"
        />
      ) : null}

      <div className="space-y-3">
        {data.correlations.map((item) => (
          <article key={item.id} className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-odds-text">{linkTypeLabel(item.linkType)}</p>
                {item.event?.description ? (
                  <p className="mt-1 text-xs text-odds-muted">{item.event.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md border border-odds-border bg-odds-panel/65 px-2.5 py-1 text-xs numeric text-odds-muted">
                {confidenceText(item.confidence)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-odds-text3">{item.explanation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
