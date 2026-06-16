import type { MarketKey } from '../types/odds';

export const marketOrder: MarketKey[] = ['1x2', 'asian', 'totals', 'btts'];

export const marketLabels: Record<MarketKey, string> = {
  '1x2': '胜平负',
  asian: '亚洲让球',
  totals: '大小球',
  btts: '双方进球',
};
