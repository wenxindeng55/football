import type { SourceStatus } from '../types/matchIntelligence';
import { DataStatus, inferEmptyReason, type DataStatusTone } from './DataStatus';

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

function statusTone(status?: SourceStatus, rowCount = 0): DataStatusTone {
  const code = (status?.code || '').toLowerCase();
  if (code.includes('failed') || code.includes('error')) return 'danger';
  if (code.includes('empty') || code.includes('missing') || code.includes('not_configured') || code.includes('no_rows') || rowCount === 0) {
    return 'warning';
  }
  if (code.includes('mock') || code.includes('dev_seed')) return 'info';
  return 'success';
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
  const description =
    reason ||
    sourceStatus?.reason ||
    (rowCount > 0 ? '该模块已返回可展示记录。' : '数据库暂未返回该模块记录，页面会保持空态显示。');
  const reasonCode = inferEmptyReason(sourceStatus?.code || dataSource, rowCount);

  return (
    <DataStatus
      title={moduleName}
      reasonCode={rowCount > 0 ? undefined : reasonCode}
      reason={description}
      rowCount={rowCount}
      dataSource={dataSource}
      updatedAt={updatedAt}
      suggestedAction={suggestedAction}
      tone={statusTone(sourceStatus, rowCount)}
      compact={compact}
    />
  );
}
