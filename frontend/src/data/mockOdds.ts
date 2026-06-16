import type { AlertItem, MarketData, MarketKey, MatchData, OddsTableRow, SelectionHistory, SummaryCardData } from '../types/odds';

export const marketOrder: MarketKey[] = ['1x2', 'asian', 'totals', 'btts'];

export const marketLabels: Record<MarketKey, string> = {
  '1x2': '1X2',
  asian: '亚洲让球',
  totals: '大小球',
  btts: '双方进球',
};

export const oddsTimes = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 18 * 60 + index * 10;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

const primaryHomeSeries = [1.55, 1.48, 1.35, 1.38, 1.42, 1.39, 1.36, 1.34, 1.32, 1.31, 1.30, 1.29, 1.28, 1.30, 1.27, 1.25, 1.24, 1.23, 1.22];
const primaryDrawSeries = [3.90, 4.05, 4.30, 4.22, 4.15, 4.28, 4.34, 4.42, 4.55, 4.62, 4.76, 4.82, 4.90, 4.84, 4.98, 5.08, 5.16, 5.20, 5.28];
const primaryAwaySeries = [5.40, 5.80, 7.50, 7.10, 6.80, 7.20, 7.70, 8.10, 8.45, 8.90, 9.40, 9.80, 10.20, 10.00, 10.60, 11.10, 11.60, 12.20, 12.80];
const handicapHomeSeries = [1.88, 1.82, 1.76, 1.78, 1.74, 1.70, 1.68, 1.66, 1.64, 1.63, 1.61, 1.60, 1.58, 1.59, 1.57, 1.55, 1.54, 1.52, 1.51];
const handicapAwaySeries = [1.98, 2.06, 2.18, 2.14, 2.24, 2.32, 2.38, 2.44, 2.50, 2.54, 2.62, 2.68, 2.76, 2.72, 2.82, 2.88, 2.94, 3.02, 3.10];
const overSeries = [1.94, 1.91, 1.88, 1.86, 1.84, 1.82, 1.80, 1.78, 1.76, 1.75, 1.73, 1.72, 1.70, 1.71, 1.69, 1.67, 1.66, 1.64, 1.63];
const underSeries = [1.90, 1.94, 1.98, 2.00, 2.04, 2.07, 2.10, 2.14, 2.17, 2.20, 2.24, 2.26, 2.30, 2.28, 2.34, 2.38, 2.42, 2.48, 2.52];
const yesSeries = [1.86, 1.84, 1.82, 1.80, 1.83, 1.81, 1.78, 1.76, 1.74, 1.73, 1.71, 1.70, 1.68, 1.69, 1.67, 1.65, 1.64, 1.63, 1.62];
const noSeries = [2.00, 2.04, 2.08, 2.12, 2.10, 2.14, 2.20, 2.26, 2.32, 2.36, 2.42, 2.46, 2.52, 2.50, 2.56, 2.62, 2.68, 2.74, 2.80];

function pct(opening: number, current: number) {
  return Number((((current - opening) / opening) * 100).toFixed(1));
}

function points(values: number[]) {
  return values.map((odds, index) => ({ time: oddsTimes[index], odds }));
}

function shift(values: number[], delta: number) {
  return values.map((value) => Number((value + delta).toFixed(2)));
}

function createSelection(option: string, openingOdds: number, values: number[]): SelectionHistory {
  return { option, openingOdds, points: points(values) };
}

function buildRows(market: MarketData, homeTeam: string, awayTeam: string): OddsTableRow[] {
  return market.selections.flatMap((selection) =>
    selection.points.map((point) => {
      const changePercent = pct(selection.openingOdds, point.odds);
      const isDown = changePercent < 0;
      const option = selection.option;
      let interpretation = isDown ? `${option} 赔率下降，市场热度上升` : `${option} 赔率上升，市场热度回落`;

      if (market.key === '1x2' && option === homeTeam && changePercent <= -10) {
        interpretation = `市场明显偏向${homeTeam}`;
      }
      if (market.key === '1x2' && option === awayTeam && changePercent > 20) {
        interpretation = `市场明显不看好${awayTeam}`;
      }
      if (market.key === 'totals' && option.startsWith('Over') && isDown) {
        interpretation = '进球预期上升';
      }

      return {
        time: point.time,
        marketType: market.label,
        option,
        openingOdds: selection.openingOdds,
        currentOdds: point.odds,
        changePercent,
        interpretation,
      };
    }),
  );
}

function buildMarkets(homeTeam: string, awayTeam: string, offset = 0): Record<MarketKey, MarketData> {
  const markets: Record<MarketKey, MarketData> = {
    '1x2': {
      key: '1x2',
      label: '1X2',
      description: '胜平负市场，用来观察主胜、平局、客胜方向变化。',
      selections: [
        createSelection(homeTeam, Number((1.6 + offset).toFixed(2)), shift(primaryHomeSeries, offset)),
        createSelection('Draw', Number((3.72 + offset * 2).toFixed(2)), shift(primaryDrawSeries, offset * 2)),
        createSelection(awayTeam, Number((4.8 + offset * 4).toFixed(2)), shift(primaryAwaySeries, offset * 4)),
      ],
    },
    asian: {
      key: 'asian',
      label: '亚洲让球',
      description: '亚洲让球盘口，重点观察强队让球方向是否被持续压低。',
      selections: [
        createSelection(`${homeTeam} -1`, Number((1.92 + offset).toFixed(2)), shift(handicapHomeSeries, offset)),
        createSelection(`${awayTeam} +1`, Number((1.94 + offset).toFixed(2)), shift(handicapAwaySeries, offset)),
      ],
    },
    totals: {
      key: 'totals',
      label: '大小球',
      description: '大小球 2.5，用来观察进球预期是否升温。',
      selections: [
        createSelection('Over 2.5', Number((1.96 + offset).toFixed(2)), shift(overSeries, offset)),
        createSelection('Under 2.5', Number((1.88 + offset).toFixed(2)), shift(underSeries, offset)),
      ],
    },
    btts: {
      key: 'btts',
      label: '双方进球',
      description: '双方进球 Yes / No，观察两队均有进球的市场预期。',
      selections: [
        createSelection('Yes', Number((1.9 + offset).toFixed(2)), shift(yesSeries, offset)),
        createSelection('No', Number((1.96 + offset).toFixed(2)), shift(noSeries, offset)),
      ],
    },
  };

  return markets;
}

function summaryCards(homeTeam: string): SummaryCardData[] {
  return [
    {
      title: '胜平负方向',
      openingOdds: '1.60',
      currentOdds: '1.35',
      changePercent: -15.6,
      explanation: `${homeTeam === 'Belgium' ? '比利时' : homeTeam}胜赔下降，市场更看好${homeTeam === 'Belgium' ? '比利时' : homeTeam}`,
    },
    {
      title: '亚洲让球方向',
      openingOdds: '-1 / 1.92',
      currentOdds: '-1 / 1.76',
      changePercent: -8.3,
      explanation: `${homeTeam === 'Belgium' ? '比利时' : homeTeam} -1 赔率下降，强队方向升温`,
    },
    {
      title: '大小球方向',
      openingOdds: 'Over 2.5 / 1.96',
      currentOdds: 'Over 2.5 / 1.82',
      changePercent: -7.1,
      explanation: '大球赔率下降，进球预期略有上升',
    },
  ];
}

function alerts(homeTeam: string, awayTeam: string): AlertItem[] {
  const items: AlertItem[] = [
    {
      id: `${homeTeam}-alert-2000`,
      time: '20:00',
      level: '普通',
      message: '大球 2.5 赔率下降，进球预期上升',
    },
    {
      id: `${homeTeam}-alert-1940`,
      time: '19:40',
      level: '高风险',
      message: `${awayTeam} 胜赔从 5.80 升到 7.50，市场明显不看好${awayTeam}`,
    },
    {
      id: `${homeTeam}-alert-1920`,
      time: '19:20',
      level: '重要',
      message: `${homeTeam} 主胜赔率 10 分钟内从 1.48 降到 1.35，市场快速升温`,
    },
  ];

  return items.sort((a, b) => b.time.localeCompare(a.time));
}

function createMatch(params: {
  id: string;
  homeTeam: string;
  awayTeam: string;
  matchTime: string;
  scheduledAt?: string | null;
  score: string;
  status: MatchData['status'];
  direction: string;
  offset?: number;
  tags: MatchData['tags'];
}): MatchData {
  const markets = buildMarkets(params.homeTeam, params.awayTeam, params.offset ?? 0);
  return {
    id: params.id,
    name: `${params.homeTeam} vs ${params.awayTeam}`,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    scheduledAt: params.scheduledAt ?? null,
    matchTime: params.matchTime,
    score: params.score,
    status: params.status,
    direction: params.direction,
    tags: params.tags,
    dataSource: 'sgodds mock feed',
    updatedAt: '2026-06-16 21:00',
    marketSummary: `${params.homeTeam} 主胜和让球方向持续降赔，市场资金更集中在强队方向；大小球端大球略微升温。`,
    summaryCards: summaryCards(params.homeTeam),
    markets,
    alerts: alerts(params.homeTeam, params.awayTeam),
  };
}

export const matches: MatchData[] = [
  createMatch({
    id: 'belgium-egypt',
    homeTeam: 'Belgium',
    awayTeam: 'Egypt',
    scheduledAt: '2026-06-20 22:00',
    matchTime: '06月20日 22:00',
    score: '未开赛',
    status: '未开赛',
    direction: '市场偏向 Belgium',
    tags: [
      { label: '主队升温', tone: 'success' },
      { label: '盘口异动', tone: 'warning' },
      { label: '临场降赔', tone: 'danger' },
    ],
  }),
  createMatch({
    id: 'spain-cape-verde',
    homeTeam: 'Spain',
    awayTeam: 'Cape Verde',
    scheduledAt: '2026-06-21 01:00',
    matchTime: '06月21日 01:00',
    score: '未开赛',
    status: '未开赛',
    direction: '市场偏向 Spain',
    offset: 0.08,
    tags: [
      { label: '主队升温', tone: 'success' },
      { label: '临场降赔', tone: 'danger' },
    ],
  }),
  createMatch({
    id: 'germany-ivory-coast',
    homeTeam: 'Germany',
    awayTeam: 'Ivory Coast',
    scheduledAt: '2026-06-21 03:30',
    matchTime: '06月21日 03:30',
    score: '0 - 0',
    status: '进行中',
    direction: '盘口方向震荡',
    offset: 0.14,
    tags: [
      { label: '盘口异动', tone: 'warning' },
      { label: '主队升温', tone: 'success' },
    ],
  }),
];

export function getMarketRows(match: MatchData, marketKey: MarketKey): OddsTableRow[] {
  const market = match.markets[marketKey];
  return market ? buildRows(market, match.homeTeam, match.awayTeam) : [];
}
