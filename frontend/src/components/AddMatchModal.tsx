import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, ListPlus, Plus, RefreshCw, X } from 'lucide-react';
import {
  fetchDiscoveryMatches,
  type AddMonitorMatchPayload,
  type DiscoveryDateGroup,
  type DiscoveryMatch,
} from '../api/oddsApi';

interface AddMatchModalProps {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: AddMonitorMatchPayload) => Promise<void>;
}

type AddMode = 'candidate' | 'manual';

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    timeZone: 'Asia/Singapore',
  }).format(date);
}

function formatMatchTime(value: string | null) {
  if (!value) return '时间待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  }).format(date);
}

function candidateStatus(match: DiscoveryMatch) {
  if (match.hidden) return '已隐藏';
  if (match.monitored) return '已监控';
  return null;
}

export function AddMatchModal({ open, loading, onClose, onSubmit }: AddMatchModalProps) {
  const [mode, setMode] = useState<AddMode>('candidate');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [groups, setGroups] = useState<DiscoveryDateGroup[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedUrl, setSelectedUrl] = useState('');
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');

  async function loadCandidates() {
    setCandidateLoading(true);
    setCandidateError('');
    try {
      const response = await fetchDiscoveryMatches(7);
      setGroups(response.dates);
      const defaultDate = response.dates[1]?.date ?? response.dates[0]?.date ?? '';
      setSelectedDate((current) => current || defaultDate);
    } catch (error) {
      console.warn('候选比赛读取失败。', error);
      setCandidateError('候选比赛读取失败');
    } finally {
      setCandidateLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setMode('candidate');
    setSelectedUrl('');
    void loadCandidates();
  }, [open]);

  const activeGroup = groups.find((group) => group.date === selectedDate) ?? groups[0];
  const candidates = useMemo(() => activeGroup?.matches ?? [], [activeGroup]);
  const selectedCandidate = candidates.find((match) => match.url === selectedUrl) ?? null;

  useEffect(() => {
    if (!activeGroup) return;
    setSelectedDate(activeGroup.date);
    setSelectedUrl((current) => {
      if (candidates.some((match) => match.url === current && !match.monitored && !match.hidden)) {
        return current;
      }
      return candidates.find((match) => !match.monitored && !match.hidden)?.url ?? '';
    });
  }, [activeGroup, candidates]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (mode === 'candidate') {
        if (!selectedCandidate || selectedCandidate.monitored || selectedCandidate.hidden) return;
        await onSubmit({
          name: selectedCandidate.name,
          url: selectedCandidate.url,
          matchTime: selectedCandidate.matchTime,
          league: selectedCandidate.league,
          matchNo: selectedCandidate.matchNo,
        });
        setSelectedUrl('');
      } else {
        await onSubmit({ name: name.trim(), url: url.trim() });
        setName('');
        setUrl('');
      }
    } catch {
      // 保留用户输入，便于修正后台错误后重试。
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="surface w-full max-w-[560px] p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-odds-success">
              <Plus className="h-4 w-4" />
              添加监控比赛
            </div>
            <h3 className="mt-2 text-lg font-semibold text-odds-text">新增采集目标</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md border border-odds-border bg-odds-control p-2 text-odds-text2 hover:border-odds-accent/50"
            aria-label="关闭添加监控比赛"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-odds-border bg-odds-control p-1">
          <button
            type="button"
            onClick={() => setMode('candidate')}
            className={`focus-ring inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
              mode === 'candidate' ? 'bg-odds-accent text-white' : 'text-odds-text2 hover:text-odds-text'
            }`}
          >
            <ListPlus className="h-4 w-4" />
            候选比赛
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`focus-ring inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
              mode === 'manual' ? 'bg-odds-accent text-white' : 'text-odds-text2 hover:text-odds-text'
            }`}
          >
            <Link className="h-4 w-4" />
            手动 URL
          </button>
        </div>

        {mode === 'candidate' ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="block flex-1 text-sm font-medium text-odds-text2">
                日期
                <select
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
                >
                  {groups.map((group) => (
                    <option key={group.date} value={group.date}>
                      {formatDateLabel(group.date)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void loadCandidates()}
                disabled={candidateLoading}
                className="focus-ring mt-auto inline-flex items-center justify-center gap-2 rounded-md border border-odds-border bg-odds-control px-3 py-2 text-sm text-odds-text2 hover:border-odds-accent/50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${candidateLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            <label className="block text-sm font-medium text-odds-text2">
              比赛
              <select
                required
                value={selectedUrl}
                onChange={(event) => setSelectedUrl(event.target.value)}
                className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
              >
                <option value="">请选择比赛</option>
                {candidates.map((match) => {
                  const status = candidateStatus(match);
                  return (
                    <option key={match.url} value={match.url} disabled={Boolean(status)}>
                      {formatMatchTime(match.matchTime)} {match.nameZh} {match.league ? `· ${match.league}` : ''}
                      {status ? ` · ${status}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="min-h-[44px] rounded-md border border-odds-border bg-odds-control/70 p-3 text-sm text-odds-text2">
              {candidateError || (selectedCandidate ? selectedCandidate.name : '未来 7 天暂无可选比赛')}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-odds-text2">
              比赛名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：比利时 对 埃及"
                className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
              />
            </label>

            <label className="block text-sm font-medium text-odds-text2">
              比赛 URL
              <input
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://sgodds.com/football/current-odds/..."
                className="mt-2 w-full rounded-md border border-odds-border bg-odds-control px-3 py-2 text-odds-text outline-none focus:border-odds-accent"
              />
            </label>
          </div>
        )}

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
            disabled={loading || candidateLoading || (mode === 'candidate' && !selectedCandidate)}
            className="focus-ring rounded-md border border-odds-success/50 bg-odds-success/15 px-4 py-2 text-sm font-semibold text-odds-success hover:bg-odds-success/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '提交中...' : '提交到后台'}
          </button>
        </div>
      </form>
    </div>
  );
}
