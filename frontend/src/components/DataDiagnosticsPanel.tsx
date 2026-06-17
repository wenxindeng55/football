import { ActivitySquare, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import type { DataSourceDiagnostic, MatchDiagnosticsResponse } from '../types/matchIntelligence';

interface DataDiagnosticsPanelProps {
  data: MatchDiagnosticsResponse;
}

const sourceLabels: Record<string, string> = {
  odds: '盘口快照',
  lineups: '首发名单',
  events: '比赛事件',
  stats: '技术统计',
  injuries: '伤停信息',
  standings: '小组积分',
};

const providerLabels: Record<string, string> = {
  sgodds: 'SGOdds',
  thesportsdb: 'TheSportsDB',
};

function sourceLabel(source: DataSourceDiagnostic) {
  const dataType = source.dataType || source.name.split(':')[1] || source.name;
  const dataTypeLabel = sourceLabels[dataType] ?? dataType;
  if (!source.source) return sourceLabels[source.name] ?? dataTypeLabel;
  return `${providerLabels[source.source] ?? source.source} · ${dataTypeLabel}`;
}

function statusClass(status: string, rowCount: number) {
  const value = status.toLowerCase();
  if (value.includes('failed') || value.includes('error')) return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (
    value.includes('missing') ||
    value.includes('empty') ||
    value.includes('not_configured') ||
    value.includes('no_rows') ||
    value.includes('source_empty') ||
    rowCount === 0
  ) {
    return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  }
  if (value.includes('mock') || value.includes('dev_seed')) return 'border-odds-accent/35 bg-odds-accent/10 text-odds-accent';
  return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
}

function StatusIcon({ source }: { source: DataSourceDiagnostic }) {
  const status = source.status.toLowerCase();
  if (status.includes('failed') || status.includes('error')) return <AlertTriangle className="h-4 w-4" />;
  if (source.rowCount === 0) return <ActivitySquare className="h-4 w-4" />;
  if (status.includes('mock') || status.includes('dev_seed')) return <Database className="h-4 w-4" />;
  return <CheckCircle2 className="h-4 w-4" />;
}

export function DataDiagnosticsPanel({ data }: DataDiagnosticsPanelProps) {
  return (
    <section className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">数据诊断</h3>
          <p className="mt-1 text-sm leading-6 text-odds-muted">
            检查内部 match_id、外部赛事 ID 映射、各模块入库行数和最近查询时间。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-odds-success/35 bg-odds-success/10 px-2.5 py-1 numeric text-odds-success">
            正常 {data.summary.normal}
          </span>
          <span className="rounded-md border border-odds-warning/35 bg-odds-warning/10 px-2.5 py-1 numeric text-odds-warning">
            待处理 {data.summary.needsAttention}
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
          <p className="text-xs text-odds-muted">内部 match_id</p>
          <p className="mt-1 break-all text-sm font-semibold text-odds-text">{data.matchId}</p>
        </div>
        <div className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
          <p className="text-xs text-odds-muted">外部赛事 ID</p>
          <p className="mt-1 break-all text-sm font-semibold text-odds-text">{data.externalMatchId || '未映射'}</p>
        </div>
        <div className="rounded-lg border border-odds-border bg-odds-control/45 p-3">
          <p className="text-xs text-odds-muted">诊断更新时间</p>
          <p className="mt-1 numeric text-sm font-semibold text-odds-text">{data.updatedAt || '-'}</p>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {data.sources.map((source) => (
          <article
            key={`${source.name}-${source.source || ''}-${source.dataType || ''}`}
            className={`rounded-lg border p-3 ${statusClass(source.status, source.rowCount)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <StatusIcon source={source} />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{sourceLabel(source)}</p>
                  <p className="mt-1 text-sm leading-6 text-odds-text3">{source.reason}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-current/25 px-2.5 py-1 text-xs numeric">
                {source.rowCount} 条
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-odds-muted sm:grid-cols-2">
              <p>配置：{source.configured ? '已配置' : '未配置'}</p>
              <p className="numeric">最近抓取：{source.lastFetchedAt || '-'}</p>
              <p className="numeric">最近入库：{source.lastIngestedAt || '-'}</p>
              <p className="numeric">最近查询：{source.lastQueriedAt || '-'}</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-odds-text3">建议：{source.suggestedAction}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
