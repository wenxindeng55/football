import { CalendarDays } from 'lucide-react';
import { MatchCard } from './MatchCard';
import type { MatchScheduleGroup } from '../utils/matchSchedule';

interface MatchDateGroupProps {
  group: MatchScheduleGroup;
  selectedMatchId: string;
  riskScores: Record<string, number>;
  hidingMatchId: string | null;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export function MatchDateGroup({
  group,
  selectedMatchId,
  riskScores,
  hidingMatchId,
  onSelect,
  onHide,
  onPause,
  onResume,
}: MatchDateGroupProps) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-odds-accent" />
          <h2 className="truncate text-sm font-semibold text-odds-text">{group.label}</h2>
        </div>
        <span className="shrink-0 rounded-lg border border-odds-border bg-odds-control/70 px-2.5 py-1 text-xs text-odds-muted">
          {group.matches.length} 场比赛
        </span>
      </div>

      <div className="grid min-w-0 gap-3">
        {group.matches.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            selected={match.id === selectedMatchId}
            riskScore={riskScores[match.id] ?? 0}
            onSelect={onSelect}
            onHide={onHide}
            onPause={onPause}
            onResume={onResume}
            hiding={hidingMatchId === match.id}
          />
        ))}
      </div>
    </section>
  );
}
