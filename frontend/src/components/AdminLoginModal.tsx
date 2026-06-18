import { FormEvent, useState } from 'react';
import { LockKeyhole, LogIn, X } from 'lucide-react';
import { loginAdmin, type AuthUser } from '../api/authApi';

interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export function AdminLoginModal({ open, onClose, onSuccess }: AdminLoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await loginAdmin(username.trim(), password);
      if (response.authenticated && response.user) {
        setPassword('');
        onSuccess(response.user);
        return;
      }
      setError('登录失败，请检查管理员账号和密码。');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="surface w-full max-w-[420px] p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-odds-accent">
              <LockKeyhole className="h-4 w-4" />
              管理员登录
            </div>
            <h3 className="mt-2 text-lg font-semibold text-odds-text">解锁管理操作</h3>
            <p className="mt-1 text-sm leading-6 text-odds-muted">公开看板无需登录，添加比赛、导出和采集控制需要管理员权限。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md border border-odds-border bg-odds-control p-2 text-odds-text2 hover:border-odds-accent/50"
            aria-label="关闭管理员登录"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-medium text-odds-text2">
            管理员账号
            <input
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
            />
          </label>

          <label className="block text-sm font-medium text-odds-text2">
            管理员密码
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
            />
          </label>
        </div>

        {error ? <div className="mt-4 rounded-md border border-odds-danger/35 bg-odds-danger/10 p-3 text-sm text-odds-danger">{error}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md border border-odds-border bg-odds-control px-4 py-2 text-sm text-odds-text2 hover:border-odds-accent/50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-odds-accent/50 bg-odds-accent/15 px-4 py-2 text-sm font-semibold text-odds-text hover:bg-odds-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {loading ? '登录中...' : '登录'}
          </button>
        </div>
      </form>
    </div>
  );
}
