import { AlertTriangle, CheckCircle2, Database, Info } from 'lucide-react';
import type { SourceStatus } from '../types/matchIntelligence';

interface DataStatusPanelProps {
  moduleName: string;
  sourceStatus?: SourceStatus;
  dataSource?: string;
  updatedAt?: string | null;
  rowCount?: number;
  reason?: string;
  suggestedAction?: string;
  compact?: boolean;
}

function statusTone(status?: SourceStatus, rowCount = 0) {
  const code = (status?.code || '').toLowerCase();
  if (code.includes('failed') || code.includes('error')) return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (code.includes('empty') || code.includes('missing') || code.includes('not_configured') || code.includes('no_rows') || rowCount === 0) {
    return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  }
  if (code.includes('mock') || code.includes('dev_seed')) return 'border-odds-accent/35 bg-odds-accent/10 text-odds-accent';
  return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
}

function statusIcon(status?: SourceStatus, rowCount = 0) {
  const code = (status?.code || '').toLowerCase();
  if (code.includes('failed') || code.includes('error')) return AlertTriangle;
  if (code.includes('empty') || code.includes('missing') || code.includes('not_configured') || code.includes('no_rows') || rowCount === 0) return Info;
  if (code.includes('mock') || code.includes('dev_seed')) return Database;
  return CheckCircle2;
}

export function DataStatusPanel({
  moduleName,
  sourceStatus,
  dataSource,
  updatedAt,
  rowCount = 0,
  reason,
  suggestedAction,
  compact = false,
}: DataStatusPanelProps) {
  const Icon = statusIcon(sourceStatus, rowCount);
  const label =
    sourceStatus?.label ||
    (dataSource === 'dev_seed' || dataSource === 'mock' ? '开发种子数据' : rowCount > 0 ? '已有数据' : '暂无入库数据');
  const description =
    reason ||
    sourceStatus?.reason ||
    (rowCount > 0 ? '该模块已返回可展示记录。' : '数据库暂未返回该模块记录，页面会保持空态显示。');

  return (
    <div className={`rounded-lg border p-3 ${statusTone(sourceStatus, rowCount)}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{moduleName}</p>
            <span className="rounded-md border border-current/25 px-2 py-0.5 text-xs">{label}</span>
            {typeof rowCount === 'number' ? <span className="numeric text-xs opacity-80">{rowCount} 条</span> : null}
          </div>
          <p className={`mt-1 text-sm leading-6 text-odds-text3 ${compact ? 'line-clamp-2' : ''}`}>{description}</p>
          {!compact && suggestedAction ? <p className="mt-1 text-sm leading-6 text-odds-muted">建议：{suggestedAction}</p> : null}
          {!compact && updatedAt ? <p className="mt-2 text-xs numeric text-odds-muted">最近查询：{updatedAt}</p> : null}
        </div>
      </div>
    </div>
  );
}
