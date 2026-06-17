import { BrainCircuit } from 'lucide-react';
import type { MatchInsightSeverity, MatchInsightsResponse } from '../types/matchIntelligence';
import { DataStatusPanel } from './DataStatusPanel';

interface MatchInsightPanelProps {
  data: MatchInsightsResponse;
  loading?: boolean;
}

function severityClass(severity: MatchInsightSeverity) {
  if (severity === 'danger') return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (severity === 'warning') return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  if (severity === 'success') return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  return 'border-odds-border bg-odds-control/55 text-odds-text3';
}

export function MatchInsightPanel({ data, loading = false }: MatchInsightPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">综合洞察</h3>
          <p className="mt-1 text-sm text-odds-muted">
            {loading ? '正在同步后端分析...' : `规则分析 · ${data.dataSource}`}
          </p>
        </div>
        <BrainCircuit className="h-5 w-5 shrink-0 text-odds-accent" />
      </div>

      {data.items.length === 0 ? (
        <DataStatusPanel
          moduleName="综合洞察"
          dataSource={data.dataSource}
          rowCount={0}
          reason="当前盘口、事件或赛前情报不足，规则分析暂未生成结论。"
          suggestedAction="先补齐盘口序列、首发/伤停/事件/技术统计，再扩展 insight_service 的规则。"
        />
      ) : null}

      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((item) => (
          <article key={item.id} className={`rounded-lg border p-3 ${severityClass(item.severity)}`}>
            <p className="text-sm font-semibold">{item.title}</p>
            <p className="mt-2 text-sm leading-6 text-odds-text">{item.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
