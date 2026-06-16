import { AlertTriangle, Bell, CircleAlert } from 'lucide-react';
import type { AlertItem } from '../types/odds';

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
          <p className="mt-1 text-sm text-odds-muted">自动判断，按时间倒序</p>
        </div>
        <span className="rounded-md border border-odds-border bg-odds-control/55 px-2.5 py-1 text-xs numeric text-odds-muted">
          {alerts.length}
        </span>
      </div>

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
            </article>
          );
        })}
      </div>
    </aside>
  );
}
