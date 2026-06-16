import { Activity, Database, ShieldCheck } from 'lucide-react';
import type { MatchData } from '../types/odds';

interface MatchOverviewProps {
  match: MatchData;
}

export function MatchOverview({ match }: MatchOverviewProps) {
  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium uppercase text-odds-accent">世界杯盘口监控看板</p>
          <h2 className="text-2xl font-bold tracking-normal text-odds-text sm:text-3xl">{match.name}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-odds-muted sm:text-sm">
            <span className="inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-control/55 px-3 py-2">
              <Activity className="h-4 w-4 text-odds-success" />
              {match.matchTime}
            </span>
            <span className="inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-control/55 px-3 py-2">
              <Database className="h-4 w-4 text-odds-accent" />
              {match.dataSource}
            </span>
            <span className="inline-flex items-center gap-2 rounded-md border border-odds-border bg-odds-control/55 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-odds-warning" />
              {match.status}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-odds-success/30 bg-odds-success/10 px-4 py-3 text-sm text-odds-success lg:max-w-[360px]">
          {match.direction}
        </div>
      </div>

      <p className="mt-5 max-w-5xl text-sm leading-6 text-odds-text3">{match.marketSummary}</p>
    </section>
  );
}
