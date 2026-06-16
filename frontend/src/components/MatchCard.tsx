import { Clock3, EyeOff, RadioTower } from 'lucide-react';
import type { MatchData } from '../types/odds';
import { tagToneClass } from '../utils/format';

interface MatchCardProps {
  match: MatchData;
  selected: boolean;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
  hiding: boolean;
}

export function MatchCard({ match, selected, onSelect, onHide, hiding }: MatchCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(match.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(match.id);
        }
      }}
      className={`focus-ring surface min-w-0 p-4 text-left transition hover:-translate-y-0.5 hover:border-odds-accent/45 ${
        selected ? 'border-odds-success/70 bg-odds-success/10 shadow-glow' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-odds-text sm:text-lg">{match.name}</h2>
          <p className="mt-1 inline-flex items-center gap-2 text-xs text-odds-muted">
            <Clock3 className="h-3.5 w-3.5" />
            {match.matchTime}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-odds-border bg-odds-control/60 px-2.5 py-1 text-xs numeric text-odds-text">
          {match.score}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm text-odds-text2">
        <RadioTower className={`h-4 w-4 ${selected ? 'text-odds-success' : 'text-odds-muted'}`} />
        <span>{match.direction}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {match.tags.map((tag) => (
          <span key={tag.label} className={`rounded-full border px-2.5 py-1 text-xs ${tagToneClass(tag.tone)}`}>
            {tag.label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={hiding}
          onClick={(event) => {
            event.stopPropagation();
            onHide(match.id);
          }}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-odds-border bg-odds-control px-2.5 py-1.5 text-xs text-odds-muted hover:border-odds-danger/50 hover:text-odds-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          <EyeOff className="h-3.5 w-3.5" />
          {hiding ? '处理中' : '隐藏并停采'}
        </button>
      </div>
    </div>
  );
}
