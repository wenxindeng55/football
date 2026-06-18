import { AlertTriangle, Bell, CircleAlert } from 'lucide-react';
import type { AlertItem } from '../types/odds';
import { EmptyState } from './DataStatus';

interface AlertPanelProps {
  alerts: AlertItem[];
}

function levelClass(level: AlertItem['level']) {
  if (level === '高风险') return 'border-odds-danger/40 bg-odds-danger/10 text-odds-danger';
  if (level === '重要') return 'border-odds-warning/40 bg-odds-warning/10 text-odds-warning';
  return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
}

function levelIcon(level: AlertItem['level']) {
  if (level === '高风险') return CircleAlert;
  if (level === '重要') return AlertTriangle;
  return Bell;
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  return (
    <aside className="surface p-4 sm:p-5 lg:sticky lg:top-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">异动提醒</h3>
          <p className="mt-1 text-sm text-odds-muted">自动判断，按盘口权重、风险等级和变化幅度降噪排序</p>
        </div>
        <span className="rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs numeric text-odds-muted">
          {alerts.length}
        </span>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="异动提醒"
          reasonCode="api_zero_rows"
          reason="当前接口返回 0 条达到阈值的盘口异动提醒。"
          rowCount={0}
          suggestedAction="继续观察核心盘口是否出现连续变化，或检查采集频率和阈值配置。"
        />
      ) : null}

      <div className="space-y-3">
        {alerts.map((alert) => {
          const Icon = levelIcon(alert.level);
          return (
            <article key={alert.id} className={`rounded-lg border p-3 ${levelClass(alert.level)}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-semibold">
                  <Icon className="h-4 w-4" />
                  {alert.level}
                </span>
                <span className="numeric text-xs text-odds-text3">{alert.time}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-odds-text">{alert.message}</p>
              <div className="mt-3 grid gap-2 text-xs text-odds-text3">
                <span>风险等级：{alert.riskLevel || alert.level}</span>
                <span>置信度：{alert.confidence || '待计算'}</span>
                <span>市场权重：{alert.marketWeight || '待归类'}</span>
                <span>触发原因：{alert.triggerReason || alert.message}</span>
                <span>需要确认的数据：{alert.confirmationNeeded || '需要对照相邻盘口、事件、首发和统计数据。'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
