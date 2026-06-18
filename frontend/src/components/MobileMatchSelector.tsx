import { ChevronDown } from 'lucide-react';
import type { MatchData } from '../types/odds';

interface MobileMatchSelectorProps {
  matches: MatchData[];
  selectedMatchId: string;
  riskScores: Record<string, number>;
  onSelect: (id: string) => void;
}

export function MobileMatchSelector({ matches, selectedMatchId, riskScores, onSelect }: MobileMatchSelectorProps) {
  const selected = matches.find((match) => match.id === selectedMatchId) ?? matches[0];

  if (!selected) return null;

  return (
    <section className="surface min-w-0 p-4 xl:hidden">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-odds-text">比赛选择</h2>
          <p className="mt-1 truncate text-xs text-odds-muted">{selected.matchTime} · {selected.status}</p>
        </div>
        <span className="shrink-0 rounded-lg border border-odds-danger/35 bg-odds-danger/10 px-2.5 py-1 text-xs numeric text-odds-danger">
          风险 {riskScores[selected.id] ?? 0}/100
        </span>
      </div>

      <label className="focus-within:ring-2 focus-within:ring-odds-accent/50 flex min-h-11 items-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 text-sm text-odds-text">
        <select
          value={selected.id}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-0 flex-1 appearance-none bg-transparent font-semibold text-odds-text focus:outline-none"
          aria-label="选择比赛"
        >
          {matches.map((match) => (
            <option key={match.id} value={match.id}>
              {match.name} · {match.matchTime} · 风险 {riskScores[match.id] ?? 0}/100
            </option>
          ))}
        </select>
        <ChevronDown className="h-4 w-4 shrink-0 text-odds-accent" />
      </label>
    </section>
  );
}
