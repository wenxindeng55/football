import type { AlertItem, MarketData, MatchData, OddsTableRow, SummaryCardData, Tag } from '../types/odds';

const textReplacements: Array<[RegExp, string]> = [
  [/\bCape Verde\b/g, '佛得角'],
  [/\bIvory Coast\b/g, '科特迪瓦'],
  [/\bBelgium\b/g, '比利时'],
  [/\bEgypt\b/g, '埃及'],
  [/\bSpain\b/g, '西班牙'],
  [/\bGermany\b/g, '德国'],
  [/\bIran\b/g, '伊朗'],
  [/\bNew Zealand\b/g, '新西兰'],
  [/\bPick The Score\b/g, '比分投注'],
  [/\bHalftime-Fulltime\b/g, '半全场'],
  [/\bTotal Goals\b/g, '总进球'],
  [/\bAsian Handicap\b/g, '亚洲让球'],
  [/\bWill Both Teams Score\b/g, '双方进球'],
  [/\bDraw\b/g, '平局'],
  [/\bOver\b/g, '大球'],
  [/\bUnder\b/g, '小球'],
  [/\bYes\b/g, '是'],
  [/\bNo\b/g, '否'],
  [/\b1X2\b/g, '胜平负'],
  [/\bsgodds mock feed\b/g, 'sgodds 模拟数据源'],
  [/\bsgodds SQLite\b/g, 'sgodds SQLite 数据库'],
  [/\s+vs\s+/gi, ' 对 '],
];

export function localizeText(value: string) {
  return textReplacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function localizeTag(tag: Tag): Tag {
  return { ...tag, label: localizeText(tag.label) };
}

export function localizeMarket(market: MarketData): MarketData {
  return {
    ...market,
    label: localizeText(market.label),
    description: localizeText(market.description),
    selections: market.selections.map((selection) => ({
      ...selection,
      option: localizeText(selection.option),
    })),
  };
}

export function localizeSummary(summary: SummaryCardData): SummaryCardData {
  return {
    ...summary,
    title: localizeText(summary.title),
    openingOdds: localizeText(summary.openingOdds),
    currentOdds: localizeText(summary.currentOdds),
    explanation: localizeText(summary.explanation),
  };
}

export function localizeAlert(alert: AlertItem): AlertItem {
  return {
    ...alert,
    message: localizeText(alert.message),
  };
}

export function localizeOddsRows(rows: OddsTableRow[]): OddsTableRow[] {
  return rows.map((row) => ({
    ...row,
    marketType: localizeText(row.marketType),
    option: localizeText(row.option),
    interpretation: localizeText(row.interpretation),
  }));
}

export function localizeMatch(match: MatchData): MatchData {
  return {
    ...match,
    name: localizeText(match.name),
    homeTeam: localizeText(match.homeTeam),
    awayTeam: localizeText(match.awayTeam),
    direction: localizeText(match.direction),
    tags: match.tags.map(localizeTag),
    dataSource: localizeText(match.dataSource),
    marketSummary: localizeText(match.marketSummary),
    summaryCards: match.summaryCards.map(localizeSummary),
    alerts: match.alerts.map(localizeAlert),
    markets: {
      '1x2': localizeMarket(match.markets['1x2']),
      asian: localizeMarket(match.markets.asian),
      totals: localizeMarket(match.markets.totals),
      btts: localizeMarket(match.markets.btts),
    },
  };
}
