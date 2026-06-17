import type { MarketKey } from '../types/odds';
import { marketLabels, marketOrder } from '../data/marketConfig';

interface MarketTabsProps {
  activeMarket: MarketKey;
  onChange: (market: MarketKey) => void;
}

export function MarketTabs({ activeMarket, onChange }: MarketTabsProps) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-odds-border bg-odds-control/45 p-1">
      {marketOrder.map((marketKey) => {
        const active = activeMarket === marketKey;
        return (
          <button
            key={marketKey}
            type="button"
            onClick={() => onChange(marketKey)}
            className={`focus-ring rounded-lg border px-3 py-2 text-sm transition ${
              active
                ? 'border-odds-accent/40 bg-odds-accent/15 text-odds-text'
                : 'border-transparent bg-transparent text-odds-muted hover:border-odds-border hover:text-odds-text'
            }`}
          >
            {marketLabels[marketKey]}
          </button>
        );
      })}
    </div>
  );
}
