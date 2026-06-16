import { BarChart3, Database, FileDown, Plus } from 'lucide-react';

type ActionKey = 'csv' | 'chart' | 'raw' | 'add';

interface ActionBarProps {
  loadingAction: ActionKey | null;
  onExportCsv: () => void;
  onExportChart: () => void;
  onViewRawData: () => void;
  onAddMatch: () => void;
}

const actions: Array<{
  key: ActionKey;
  label: string;
  loadingLabel: string;
  icon: typeof FileDown;
  primary: boolean;
}> = [
  { key: 'csv', label: '导出 CSV', loadingLabel: '导出中...', icon: FileDown, primary: false },
  { key: 'chart', label: '导出图表', loadingLabel: '生成中...', icon: BarChart3, primary: false },
  { key: 'raw', label: '查看原始数据', loadingLabel: '读取中...', icon: Database, primary: false },
  { key: 'add', label: '添加监控比赛', loadingLabel: '打开中...', icon: Plus, primary: true },
];

export function ActionBar({ loadingAction, onExportCsv, onExportChart, onViewRawData, onAddMatch }: ActionBarProps) {
  const handlers: Record<ActionKey, () => void> = {
    csv: onExportCsv,
    chart: onExportChart,
    raw: onViewRawData,
    add: onAddMatch,
  };

  return (
    <section className="surface flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-5">
      <div>
        <h3 className="text-base font-semibold text-odds-text">底部操作区</h3>
        <p className="mt-1 text-sm text-odds-muted">导出、回看和扩展监控对象</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:flex">
        {actions.map((action) => {
          const Icon = action.icon;
          const loading = loadingAction === action.key;
          return (
            <button
              key={action.label}
              type="button"
              onClick={handlers[action.key]}
              disabled={loadingAction !== null}
              className={`focus-ring inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                action.primary
                  ? 'border-odds-success/50 bg-odds-success/15 text-odds-success hover:bg-odds-success/20'
                  : 'border-odds-border bg-odds-control/45 text-odds-text hover:border-odds-accent/50'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Icon className="h-4 w-4" />
              {loading ? action.loadingLabel : action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
