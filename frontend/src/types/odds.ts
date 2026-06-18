export type MarketKey = '1x2' | 'asian' | 'totals' | 'btts';

export type AlertLevel = '普通' | '重要' | '高风险';

export type MatchStatus = '未开赛' | '进行中' | '已完赛';

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
  riskLevel?: AlertLevel;
  confidence?: '高' | '中' | '低' | string;
  marketWeight?: '核心盘口' | '中等盘口' | '低权重盘口' | string;
  marketWeightRank?: number | string;
  triggerReason?: string;
  confirmationNeeded?: string;
}

export interface DataCompleteness {
  score: number;
  maxScore: number;
  missing: string[];
  label: string;
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
  paused?: boolean;
  marketSummary: string;
  summaryCards: SummaryCardData[];
  markets: Record<MarketKey, MarketData>;
  alerts: AlertItem[];
  dataCompleteness?: DataCompleteness;
}
