import { Activity, Gauge, ShieldCheck } from 'lucide-react';
import type { MatchData } from '../types/odds';

interface MatchOverviewProps {
  match: MatchData;
  riskScore: number;
}

function riskToneClass(score: number) {
  if (score >= 72) return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (score >= 52) return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  if (score >= 32) return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  return 'border-odds-border bg-odds-control/60 text-odds-muted';
}

export function MatchOverview({ match, riskScore }: MatchOverviewProps) {
  const completeness = match.dataCompleteness;
  const safeRiskScore = Math.min(100, Math.max(0, riskScore));

  return (
    <section className="relative min-w-0 overflow-hidden rounded-lg border border-odds-accent/20 bg-odds-panel2/80 p-4 shadow-panel sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:34px_34px] opacity-45" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase text-odds-accent">世界杯盘口监控看板</p>
          <h2 className="break-words text-2xl font-extrabold tracking-normal text-odds-text sm:text-3xl">{match.name}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-odds-muted sm:text-sm">
            <span className="inline-flex items-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 py-2">
              <Activity className="h-4 w-4 text-odds-success" />
              {match.matchTime}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-odds-warning" />
              {match.status}
            </span>
            {completeness ? (
              <span className="inline-flex items-center gap-2 rounded-lg border border-odds-border bg-odds-control/55 px-3 py-2">
                <Gauge className="h-4 w-4 text-odds-accent" />
                数据完整度 {completeness.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-[144px] place-items-center rounded-lg border border-odds-border bg-odds-control/35 px-4 py-4 text-center">
          <div className="numeric text-4xl font-black leading-none text-odds-text">{safeRiskScore}</div>
          <div className="mt-2 text-xs text-odds-muted">异动风险评分 / 100</div>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-2">
        {match.tags.map((tag) => (
          <span key={tag.label} className="rounded-full border border-odds-border bg-odds-control/45 px-2.5 py-1 text-xs text-odds-text2">
            {tag.label}
          </span>
        ))}
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${riskToneClass(safeRiskScore)}`}>
          风险 {safeRiskScore}/100
        </span>
      </div>

      <div className="relative mt-5 rounded-lg border border-odds-success/25 bg-odds-success/10 px-4 py-3 text-sm leading-6 text-odds-success">
        {match.direction}
      </div>

      <p className="relative mt-4 max-w-5xl text-sm leading-6 text-odds-text3">{match.marketSummary}</p>
      {completeness?.missing.length ? (
        <p className="relative mt-3 text-sm leading-6 text-odds-muted">缺失：{completeness.missing.join('、')}</p>
      ) : null}
    </section>
  );
}
