import { BarChart3, Database, FileDown, Plus } from 'lucide-react';

type ActionKey = 'csv' | 'chart' | 'raw' | 'add';

interface ActionBarProps {
  loadingAction: ActionKey | null;
  onExportCsv: () => void;
  onExportChart: () => void;
  onViewRawData: () => void;
  onAddMatch: () => void;
  title?: string;
  description?: string;
  embedded?: boolean;
}

const actions: Array<{
  key: ActionKey;
  label: string;
  loadingLabel: string;
  icon: typeof FileDown;
  primary: boolean;
}> = [
  { key: 'add', label: '添加监控比赛', loadingLabel: '打开中...', icon: Plus, primary: true },
  { key: 'chart', label: '导出图表', loadingLabel: '生成中...', icon: BarChart3, primary: false },
  { key: 'raw', label: '查看原始数据', loadingLabel: '读取中...', icon: Database, primary: false },
  { key: 'csv', label: '导出 CSV', loadingLabel: '导出中...', icon: FileDown, primary: false },
];

export function ActionBar({
  loadingAction,
  onExportCsv,
  onExportChart,
  onViewRawData,
  onAddMatch,
  title = '快捷操作',
  description = '导出、回看和扩展监控对象',
  embedded = false,
}: ActionBarProps) {
  const handlers: Record<ActionKey, () => void> = {
    csv: onExportCsv,
    chart: onExportChart,
    raw: onViewRawData,
    add: onAddMatch,
  };
  const sectionClass = embedded
    ? 'flex flex-col gap-3 border-b border-odds-border bg-odds-panel2/45 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4'
    : 'surface flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-5';

  return (
    <section className={sectionClass}>
      <div>
        <h3 className="text-base font-semibold text-odds-text">{title}</h3>
        <p className="mt-1 text-sm text-odds-muted">{description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:flex">
        {actions.map((action) => {
          const Icon = action.icon;
          const loading = loadingAction === action.key;
          return (
            <button
              key={action.label}
              type="button"
              onClick={handlers[action.key]}
              disabled={loadingAction !== null}
              className={`focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                action.primary
                  ? 'border-odds-success/50 bg-odds-success/15 text-odds-success hover:bg-odds-success/20'
                  : 'border-odds-border bg-odds-control/45 text-odds-text2 hover:border-odds-accent/50 hover:text-odds-text'
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
