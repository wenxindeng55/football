export type MarketKey = '1x2' | 'asian' | 'totals' | 'btts';

export type AlertLevel = '普通' | '重要' | '高风险';

export type MatchStatus = '未开赛' | '进行中' | '已结束';

export interface Tag {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface OddsPoint {
  time: string;
  odds: number;
}

export interface SelectionHistory {
  option: string;
  openingOdds: number;
  points: OddsPoint[];
}

export interface MarketData {
  key: MarketKey;
  label: string;
  description: string;
  selections: SelectionHistory[];
}

export interface OddsTableRow {
  time: string;
  marketType: string;
  option: string;
  openingOdds: number;
  currentOdds: number;
  changePercent: number;
  interpretation: string;
}

export interface SummaryCardData {
  title: string;
  openingOdds: string;
  currentOdds: string;
  changePercent: number;
  explanation: string;
}

export interface AlertItem {
  id: string;
  time: string;
  level: AlertLevel;
  message: string;
}

export interface MatchData {
  id: string;
  name: string;
  englishName?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEnglish?: string;
  awayTeamEnglish?: string;
  scheduledAt?: string | null;
  matchTime: string;
  score: string;
  status: MatchStatus;
  direction: string;
  tags: Tag[];
  dataSource: string;
  updatedAt: string;
  league?: string | null;
  matchNo?: string | null;
  sourceType?: string | null;
  marketSummary: string;
  summaryCards: SummaryCardData[];
  markets: Record<MarketKey, MarketData>;
  alerts: AlertItem[];
}
