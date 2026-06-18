import { AlertTriangle, CheckCircle2, Database, Info, RefreshCw } from 'lucide-react';

export type EmptyReasonCode =
  | 'not_configured'
  | 'api_not_called'
  | 'api_zero_rows'
  | 'database_no_records'
  | 'match_id_mapping_failed'
  | 'fetch_failed'
  | 'cache_stale'
  | 'field_mapping_failed';

export type DataStatusTone = 'success' | 'warning' | 'danger' | 'info';

interface DataStatusProps {
  title: string;
  reasonCode?: EmptyReasonCode;
  reason?: string;
  rowCount?: number;
  dataSource?: string;
  updatedAt?: string | null;
  suggestedAction?: string;
  tone?: DataStatusTone;
  compact?: boolean;
}

export const emptyReasonLabels: Record<EmptyReasonCode, string> = {
  not_configured: '未配置数据源',
  api_not_called: '接口未调用',
  api_zero_rows: '接口返回 0 条',
  database_no_records: '数据库无记录',
  match_id_mapping_failed: 'match_id 映射失败',
  fetch_failed: '采集失败',
  cache_stale: '缓存未刷新',
  field_mapping_failed: '字段映射失败',
};

function toneClass(tone: DataStatusTone) {
  if (tone === 'success') return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  if (tone === 'danger') return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (tone === 'info') return 'border-odds-accent/35 bg-odds-accent/10 text-odds-accent';
  return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
}

function statusIcon(tone: DataStatusTone) {
  if (tone === 'success') return CheckCircle2;
  if (tone === 'danger') return AlertTriangle;
  if (tone === 'info') return Database;
  return Info;
}

export function inferEmptyReason(code?: string, rowCount = 0): EmptyReasonCode {
  const normalized = (code || '').toLowerCase();
  if (normalized.includes('not_configured')) return 'not_configured';
  if (normalized.includes('not_called')) return 'api_not_called';
  if (normalized.includes('source_empty') || normalized.includes('api_empty')) return 'api_zero_rows';
  if (normalized.includes('mapping')) return 'match_id_mapping_failed';
  if (normalized.includes('failed') || normalized.includes('error')) return 'fetch_failed';
  if (normalized.includes('cache')) return 'cache_stale';
  if (normalized.includes('field')) return 'field_mapping_failed';
  if (normalized.includes('no_rows') || normalized.includes('empty') || normalized.includes('missing') || rowCount === 0) {
    return 'database_no_records';
  }
  return 'database_no_records';
}

export function DataStatus({
  title,
  reasonCode,
  reason,
  rowCount = 0,
  dataSource,
  updatedAt,
  suggestedAction,
  tone = 'warning',
  compact = false,
}: DataStatusProps) {
  const Icon = statusIcon(tone);
  const label = reasonCode ? emptyReasonLabels[reasonCode] : rowCount > 0 ? '已有数据' : '数据库无记录';

  return (
    <div className={`rounded-lg border p-3 ${toneClass(tone)}`}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            <span className="rounded-md border border-current/25 px-2 py-0.5 text-xs">{label}</span>
            <span className="numeric text-xs opacity-80">{rowCount} 条</span>
            {dataSource ? <span className="rounded-md border border-current/20 px-2 py-0.5 text-xs opacity-80">{dataSource}</span> : null}
          </div>
          <p className={`mt-1 text-sm leading-6 text-odds-text3 ${compact ? 'line-clamp-2' : ''}`}>
            {reason || '当前模块没有可展示记录，需结合数据源状态继续排查。'}
          </p>
          {!compact && suggestedAction ? <p className="mt-1 text-sm leading-6 text-odds-muted">建议：{suggestedAction}</p> : null}
          {!compact && updatedAt ? <p className="mt-2 text-xs numeric text-odds-muted">最近查询：{updatedAt}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyState(props: DataStatusProps) {
  return (
    <div className="rounded-lg border border-dashed border-odds-border bg-odds-control/35 p-4">
      <DataStatus {...props} />
    </div>
  );
}

export function LoadingState({ title = '正在读取数据' }: { title?: string }) {
  return (
    <div className="rounded-lg border border-odds-border bg-odds-control/35 p-4 text-sm text-odds-text2">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin text-odds-accent" />
        {title}
      </div>
    </div>
  );
}
