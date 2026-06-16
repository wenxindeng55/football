import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

interface ToastProps {
  message: ToastMessage | null;
  onClose: () => void;
}

const toneClass = {
  success: 'border-odds-success/50 bg-odds-success/15 text-odds-success',
  error: 'border-odds-danger/50 bg-odds-danger/15 text-odds-danger',
  info: 'border-odds-accent/50 bg-odds-accent/15 text-odds-accent',
};

const toneIcon = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Toast({ message, onClose }: ToastProps) {
  if (!message) return null;

  const Icon = toneIcon[message.tone];

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-[360px]">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-panel ${toneClass[message.tone]}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm leading-5">{message.text}</p>
        <button type="button" onClick={onClose} className="ml-2 rounded-md p-0.5 hover:bg-white/10" aria-label="关闭提示">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
