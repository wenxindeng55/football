import type { MarketKey } from '../types/odds';
import { marketLabels, marketOrder } from '../data/marketConfig';

interface MarketTabsProps {
  activeMarket: MarketKey;
  onChange: (market: MarketKey) => void;
}

export function MarketTabs({ activeMarket, onChange }: MarketTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {marketOrder.map((marketKey) => {
        const active = activeMarket === marketKey;
        return (
          <button
            key={marketKey}
            type="button"
            onClick={() => onChange(marketKey)}
            className={`focus-ring rounded-md border px-3 py-2 text-sm transition ${
              active
                ? 'border-odds-success/60 bg-odds-success/10 text-odds-success'
                : 'border-odds-border bg-odds-control/45 text-odds-muted hover:border-odds-accent/50 hover:text-odds-text'
            }`}
          >
            {marketLabels[marketKey]}
          </button>
        );
      })}
    </div>
  );
}
