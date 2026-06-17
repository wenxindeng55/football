import type { AlertItem, MatchData, OddsTableRow } from './odds';

export type PlayerItem =
  | string
  | {
      name: string;
      position?: string;
      role?: string;
      note?: string;
      playerId?: string | number | null;
      shirtNumber?: string | number | null;
      isCaptain?: boolean;
      sortOrder?: number | null;
    };

export interface TeamLineup {
  id?: number | string;
  matchId: string;
  collectedAt?: string | null;
  teamName: string;
  teamSide?: 'home' | 'away' | string | null;
  formation?: string | null;
  lineupConfirmed: boolean;
  status?: string | null;
  publishedAt?: string | null;
  source?: string | null;
  externalMatchId?: string | null;
  starters: PlayerItem[];
  substitutes: PlayerItem[];
  keyPlayersMissing: PlayerItem[];
  sourceUrl?: string | null;
}

export type Match = MatchData;
export type OddsAlert = AlertItem;
export type MatchLineup = TeamLineup;

export interface OddsSnapshot extends OddsTableRow {
  id?: number | string;
  collectedAt?: string | null;
  oddsSnapshotId?: number | string | null;
}

export interface LineupPlayer {
  id?: number | string;
  matchId: string;
  teamName: string;
  teamSide?: 'home' | 'away' | string | null;
  playerName: string;
  position?: string | null;
  role?: 'starter' | 'substitute' | string | null;
  shirtNumber?: number | null;
  isKeyPlayer?: boolean;
  missingReason?: string | null;
}

export interface MatchLineupsResponse {
  matchId: string;
  lineups: TeamLineup[];
  explanation: string;
  dataSource: string;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
}

export interface InjuryItem {
  id?: number | string;
  matchId: string;
  collectedAt?: string | null;
  teamName: string;
  playerName: string;
  status: string;
  reason?: string | null;
  expectedReturn?: string | null;
  sourceUrl?: string | null;
}

export interface MatchInjuriesResponse {
  matchId: string;
  injuries: InjuryItem[];
  summary: {
    total: number;
    byTeam: Record<string, number>;
  };
  explanation: string;
  dataSource: string;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
}

export interface GroupStandingTeam {
  id?: number | string;
  groupName: string;
  teamName: string;
  collectedAt?: string | null;
  rank?: number | null;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  motivationLevel?: string | null;
  motivationText?: string | null;
}

export type GroupStanding = GroupStandingTeam;

export interface GroupStandingResponse {
  matchId: string;
  teams: GroupStandingTeam[];
  explanation: string;
  dataSource: string;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
}

export interface LiveStatPoint {
  id?: number | string;
  matchId: string;
  externalMatchId?: string | null;
  collectedAt?: string | null;
  minute?: number | null;
  teamName: string;
  teamSide?: string | null;
  possession?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
  shotsOffTarget?: number | null;
  blockedShots?: number | null;
  corners?: number | null;
  attacks?: number | null;
  dangerousAttacks?: number | null;
  fouls?: number | null;
  offsides?: number | null;
  totalPasses?: number | null;
  accuratePasses?: number | null;
  passAccuracy?: number | null;
  xg?: number | null;
  yellowCards?: number | null;
  redCards?: number | null;
  source?: string | null;
}

export type MatchStats = LiveStatPoint;

export interface LiveStatsResponse {
  matchId: string;
  timeline: LiveStatPoint[];
  latest: LiveStatPoint[];
  explanation: string;
  dataSource: string;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
}

export type MatchEventType =
  | 'goal'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'
  | 'injury'
  | 'var'
  | 'penalty'
  | 'lineup_confirmed'
  | string;

export interface MatchEventItem {
  id?: number | string;
  matchId: string;
  eventTime: string;
  minute?: number | null;
  stoppageMinute?: number | null;
  teamName?: string | null;
  teamSide?: string | null;
  eventType: MatchEventType;
  playerName?: string | null;
  relatedPlayerName?: string | null;
  description?: string | null;
  source?: string | null;
  externalMatchId?: string | null;
  externalEventId?: string | null;
  raw?: Record<string, unknown>;
}

export type MatchEvent = MatchEventItem;
export type InjurySuspension = InjuryItem;

export interface MatchEventsResponse {
  matchId: string;
  events: MatchEventItem[];
  explanation: string;
  dataSource: string;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
}

export type MatchInsightSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface MatchInsightItem {
  id: string;
  category: string;
  title: string;
  message: string;
  severity: MatchInsightSeverity;
}

export interface OddsEventCorrelation {
  id: number | string;
  matchId?: string;
  collectedAt?: string | null;
  oddsSnapshotId?: number | null;
  eventId?: number | string | null;
  linkType: string;
  explanation: string;
  confidence: number;
  event?: {
    eventType?: string | null;
    minute?: number | null;
    teamName?: string | null;
    description?: string | null;
  };
}

export interface MatchInsightsResponse {
  matchId: string;
  generatedAt: string;
  items: MatchInsightItem[];
  correlations: OddsEventCorrelation[];
  dataSource: string;
}

export interface SourceStatus {
  code: string;
  label: string;
  reason: string;
}

export interface DataSourceDiagnostic {
  name: string;
  source?: string | null;
  dataType?: string | null;
  configured: boolean;
  lastFetchedAt?: string | null;
  lastIngestedAt?: string | null;
  lastQueriedAt?: string | null;
  rowCount: number;
  matchId: string;
  externalMatchId?: string | null;
  error?: string | null;
  status: string;
  statusLabel: string;
  reason: string;
  suggestedAction: string;
}

export interface MatchDiagnosticsResponse {
  matchId: string;
  externalMatchId?: string | null;
  sourceMap?: Record<string, unknown>;
  sources: DataSourceDiagnostic[];
  summary: {
    normal: number;
    needsAttention: number;
  };
  updatedAt: string;
}

export interface MatchIntelligence {
  lineups: MatchLineupsResponse;
  injuries: MatchInjuriesResponse;
  groupStanding: GroupStandingResponse;
  liveStats: LiveStatsResponse;
  events: MatchEventsResponse;
  insights: MatchInsightsResponse;
  diagnostics: MatchDiagnosticsResponse;
}

export type MatchIdentity = Pick<MatchData, 'id' | 'name' | 'homeTeam' | 'awayTeam'>;
