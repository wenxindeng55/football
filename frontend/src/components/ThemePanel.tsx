import { Check, Palette, X } from 'lucide-react';

export type ThemeMode = 'dark' | 'light' | 'custom';

interface ThemePanelProps {
  open: boolean;
  theme: ThemeMode;
  customBackground: string;
  onThemeChange: (theme: ThemeMode) => void;
  onCustomBackgroundChange: (color: string) => void;
  onClose: () => void;
}

const themeOptions: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'dark', label: '黑色主题', description: '适合长时间盯盘和夜间监控' },
  { value: 'light', label: '白色主题', description: '适合投屏、打印和明亮环境' },
  { value: 'custom', label: '自定义背景', description: '保留深色卡片，只调整页面背景' },
];

export function ThemePanel({
  open,
  theme,
  customBackground,
  onThemeChange,
  onCustomBackgroundChange,
  onClose,
}: ThemePanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/45 p-4 backdrop-blur-sm">
      <aside className="surface w-full max-w-[360px] p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-odds-accent">
              <Palette className="h-4 w-4" />
              主题设置
            </div>
            <h3 className="mt-2 text-lg font-semibold text-odds-text">看板显示主题</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md border border-odds-border bg-odds-control p-2 text-odds-text2 hover:border-odds-accent/50"
            aria-label="关闭主题设置"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {themeOptions.map((option) => {
            const active = option.value === theme;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onThemeChange(option.value)}
                className={`focus-ring flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left ${
                  active
                    ? 'border-odds-success/60 bg-odds-success/10 text-odds-success'
                    : 'border-odds-border bg-odds-control/55 text-odds-text2 hover:border-odds-accent/50'
                }`}
              >
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-1 block text-xs text-odds-muted">{option.description}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>

        <label className="mt-5 block text-sm font-medium text-odds-text2">
          自定义背景色
          <input
            type="color"
            value={customBackground}
            onChange={(event) => {
              onCustomBackgroundChange(event.target.value);
              onThemeChange('custom');
            }}
            className="mt-2 h-11 w-full cursor-pointer rounded-md border border-odds-border bg-odds-control p-1"
          />
        </label>
      </aside>
    </div>
  );
}
