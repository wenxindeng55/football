import { Clock3, EyeOff, PauseCircle, PlayCircle, RadioTower } from 'lucide-react';
import type { MatchData } from '../types/odds';
import { tagToneClass } from '../utils/format';

interface MatchCardProps {
  match: MatchData;
  selected: boolean;
  riskScore: number;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  hiding: boolean;
  canManage: boolean;
}

function riskLabel(score: number) {
  if (score >= 72) return '高风险';
  if (score >= 52) return '需关注';
  if (score >= 32) return '观察中';
  return '平稳';
}

function riskToneClass(score: number) {
  if (score >= 72) return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (score >= 52) return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  if (score >= 32) return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  return 'border-odds-border bg-odds-control/60 text-odds-muted';
}

function sparkColor(score: number) {
  if (score >= 72) return '#ff718b';
  if (score >= 52) return '#f4c76b';
  if (score >= 32) return '#22d3a6';
  return '#39d0ff';
}

export function MatchCard({ match, selected, riskScore, onSelect, onHide, onPause, onResume, hiding, canManage }: MatchCardProps) {
  const safeRiskScore = Math.min(100, Math.max(0, riskScore));

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(match.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(match.id);
        }
      }}
      className={`focus-ring min-w-0 rounded-lg border bg-odds-panel2/70 p-4 text-left shadow-panel transition hover:-translate-y-0.5 hover:border-odds-accent/45 ${
        selected ? 'border-odds-accent/65 bg-odds-accent/10 shadow-glow' : 'border-odds-border'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-extrabold leading-6 text-odds-text">{match.name}</h2>
          <p className="mt-1 inline-flex items-center gap-2 text-xs text-odds-muted">
            <Clock3 className="h-3.5 w-3.5" />
            {match.matchTime}
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-odds-border bg-odds-control/60 px-2.5 py-1 text-xs numeric text-odds-text">
          {match.status}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-odds-text2">
        <RadioTower className={`h-4 w-4 ${selected ? 'text-odds-success' : 'text-odds-muted'}`} />
        <span className="truncate">{match.direction}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {match.tags.map((tag) => (
          <span key={tag.label} className={`rounded-full border px-2.5 py-1 text-xs ${tagToneClass(tag.tone)}`}>
            {tag.label}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_76px] items-center gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${riskToneClass(safeRiskScore)}`}>
              {riskLabel(safeRiskScore)}
            </span>
            <span className="numeric text-xs font-semibold text-odds-text2">{safeRiskScore}/100</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-odds-success via-odds-warning to-odds-danger"
              style={{ width: `${safeRiskScore}%` }}
            />
          </div>
        </div>
        <svg viewBox="0 0 76 30" className="h-[30px] w-[76px]" aria-hidden="true">
          <path
            d="M2 22 C12 16, 20 20, 29 14 S45 9, 54 13 S68 7, 74 9"
            fill="none"
            stroke={sparkColor(safeRiskScore)}
            strokeLinecap="round"
            strokeWidth="2.6"
          />
        </svg>
      </div>

      {canManage ? <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={hiding}
          onClick={(event) => {
            event.stopPropagation();
            onHide(match.id);
          }}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-odds-border bg-odds-control px-2.5 py-1.5 text-xs text-odds-muted hover:border-odds-danger/50 hover:text-odds-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          <EyeOff className="h-3.5 w-3.5" />
          {hiding ? '处理中' : '隐藏此比赛'}
        </button>
        <button
          type="button"
          disabled={hiding}
          onClick={(event) => {
            event.stopPropagation();
            if (match.paused) {
              onResume(match.id);
            } else {
              onPause(match.id);
            }
          }}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-odds-border bg-odds-control px-2.5 py-1.5 text-xs text-odds-muted hover:border-odds-warning/50 hover:text-odds-warning disabled:cursor-not-allowed disabled:opacity-60"
        >
          {match.paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
          {hiding ? '处理中' : match.paused ? '恢复采集' : '暂停采集'}
        </button>
      </div> : null}
    </article>
  );
}
