import { Download, Globe2, Settings, Signal } from 'lucide-react';

interface HeaderProps {
  updatedAt: string;
  timezone: string;
  exporting: boolean;
  onExportCsv: () => void;
  onOpenSettings: () => void;
}

export function Header({ updatedAt, timezone, exporting, onExportCsv, onOpenSettings }: HeaderProps) {
  return (
    <header className="surface flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-odds-success/30 bg-odds-success/10 shadow-glow">
          <Signal className="h-5 w-5 text-odds-success" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-normal text-odds-text sm:text-2xl">Odds Watcher</h1>
          <p className="text-sm text-odds-muted">实时盘口变化监控</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2 text-xs text-odds-muted sm:text-sm">
          <span className="rounded-md border border-odds-border bg-odds-control/55 px-3 py-2 numeric">
            数据更新时间 {updatedAt}
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-control/55 px-3 py-2">
            <Globe2 className="h-4 w-4 text-odds-accent" />
            新加坡时间 ({timezone})
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExportCsv}
            disabled={exporting}
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-panel2 px-3 py-2 text-sm text-odds-text hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? '导出中' : '导出'}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-panel2 px-3 py-2 text-sm text-odds-text hover:border-odds-accent/50"
          >
            <Settings className="h-4 w-4" />
            设置
          </button>
        </div>
      </div>
    </header>
  );
}
