import { AlertTriangle } from 'lucide-react';

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  open,
  title,
  message,
  confirmLabel,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <section className="surface w-full max-w-md p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-odds-warning/35 bg-odds-warning/10 text-odds-warning">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-odds-text">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-odds-text3">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="focus-ring rounded-lg border border-odds-border bg-odds-control px-4 py-2 text-sm text-odds-text2 hover:border-odds-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="focus-ring rounded-lg border border-odds-warning/45 bg-odds-warning/15 px-4 py-2 text-sm font-semibold text-odds-warning hover:bg-odds-warning/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '处理中' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
