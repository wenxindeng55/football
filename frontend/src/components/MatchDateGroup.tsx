import { CalendarDays } from 'lucide-react';
import { MatchCard } from './MatchCard';
import type { MatchScheduleGroup } from '../utils/matchSchedule';

interface MatchDateGroupProps {
  group: MatchScheduleGroup;
  selectedMatchId: string;
  hidingMatchId: string | null;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
}

export function MatchDateGroup({ group, selectedMatchId, hidingMatchId, onSelect, onHide }: MatchDateGroupProps) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-odds-accent" />
          <h2 className="truncate text-sm font-semibold text-odds-text sm:text-base">{group.label}</h2>
        </div>
        <span className="shrink-0 rounded-md border border-odds-border bg-odds-control/70 px-2.5 py-1 text-xs text-odds-muted">
          {group.matches.length} 场比赛
        </span>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {group.matches.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            selected={match.id === selectedMatchId}
            onSelect={onSelect}
            onHide={onHide}
            hiding={hidingMatchId === match.id}
          />
        ))}
      </div>
    </section>
  );
}
