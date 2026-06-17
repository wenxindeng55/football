import { Info } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MarketData } from '../types/odds';
import { formatOdds } from '../utils/format';

interface OddsTrendChartProps {
  market: MarketData;
}

const lineColors = ['#22c987', '#f3c24b', '#f05252', '#38bdf8'];
const dateTimePattern = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const clockTimePattern = /^(\d{1,2}):(\d{2})$/;

function themeColor(variableName: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value ? `rgb(${value})` : fallback;
}

interface TooltipPayloadItem {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  payload?: {
    time?: string;
  };
  value?: string | number;
}

interface CustomTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
}

function parseChartTimestamp(value: string, fallbackIndex: number) {
  const trimmed = value.trim();
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const dateTimeMatch = trimmed.match(dateTimePattern);
  if (dateTimeMatch) {
    const year = Number(dateTimeMatch[1]);
    const month = Number(dateTimeMatch[2]);
    const day = Number(dateTimeMatch[3]);
    const hour = Number(dateTimeMatch[4] ?? 0);
    const minute = Number(dateTimeMatch[5] ?? 0);
    const second = Number(dateTimeMatch[6] ?? 0);
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }

  const clockTimeMatch = trimmed.match(clockTimePattern);
  if (clockTimeMatch) {
    const hour = Number(clockTimeMatch[1]);
    const minute = Number(clockTimeMatch[2]);
    return Date.UTC(1970, 0, 1, hour, minute);
  }

  return fallbackIndex;
}

function formatAxisTime(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  if (date.getUTCFullYear() === 1970) return `${hour}:${minute}`;

  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  const visiblePayload = payload?.filter((item) => item.value !== null && Number.isFinite(Number(item.value))) ?? [];
  if (!active || visiblePayload.length === 0) return null;
  const timeLabel = visiblePayload[0]?.payload?.time ?? (typeof label === 'number' ? formatAxisTime(label) : label);

  return (
    <div className="rounded-lg border border-odds-border bg-odds-panel p-3 shadow-panel">
      <p className="mb-2 text-xs text-odds-muted">{timeLabel}</p>
      <div className="space-y-1">
        {visiblePayload.map((item) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-6 text-sm">
            <span style={{ color: item.color }}>{item.name ?? item.dataKey}</span>
            <span className="numeric font-semibold text-odds-text">{formatOdds(Number(item.value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OddsTrendChart({ market }: OddsTrendChartProps) {
  const gridColor = themeColor('--odds-grid', '#263246');
  const mutedColor = themeColor('--odds-muted', '#8f9bae');
  const chartTimes = Array.from(
    new Set(market.selections.flatMap((selection) => selection.points.map((point) => point.time))),
  )
    .map((time, index) => ({
      time,
      timestampMs: parseChartTimestamp(time, index),
    }))
    .sort((left, right) => left.timestampMs - right.timestampMs || left.time.localeCompare(right.time));
  const selectionPointMaps = market.selections.map(
    (selection) => new Map(selection.points.map((point) => [point.time, point.odds])),
  );
  const chartData = chartTimes.map(({ time, timestampMs }) => {
    const row: Record<string, string | number | null> = { time, timestampMs };
    market.selections.forEach((_, selectionIndex) => {
      row[`selection_${selectionIndex}`] = selectionPointMaps[selectionIndex].get(time) ?? null;
    });
    return row;
  });
  const latestSelections = market.selections.map((selection) => {
    const latestPoint = selection.points[selection.points.length - 1];
    const currentOdds = latestPoint?.odds ?? selection.openingOdds;
    const changePercent = selection.openingOdds
      ? ((currentOdds - selection.openingOdds) / selection.openingOdds) * 100
      : 0;
    return {
      option: selection.option,
      currentOdds,
      changePercent,
    };
  });
  const strongestSelection = [...latestSelections].sort(
    (left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent),
  )[0];
  const warmingSelection = [...latestSelections].sort((left, right) => left.changePercent - right.changePercent)[0];

  return (
    <section className="surface min-w-0 bg-odds-panel2/70 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-odds-text">赔率走势图</h3>
          <p className="mt-1 text-sm text-odds-muted">{market.description}</p>
        </div>
        <div className="rounded-lg border border-odds-warning/30 bg-odds-warning/10 px-3 py-2 text-xs leading-5 text-odds-warning xl:max-w-[320px]">
          <Info className="mr-1 inline h-3.5 w-3.5" />
          赔率下降 = 市场更看好这个结果；赔率上升 = 市场更不看好这个结果。
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-odds-border bg-odds-control/30 p-3">
        <div className="h-[300px] min-w-0 sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 14, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="timestampMs"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={{ stroke: gridColor }}
              tickLine={false}
              tickFormatter={(value) => formatAxisTime(Number(value))}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => formatOdds(Number(value))}
              width={48}
              domain={['dataMin - 0.15', 'dataMax + 0.25']}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: mutedColor, fontSize: 12 }} />
            {market.selections.map((selection, index) => (
              <Line
                key={selection.option}
                type="linear"
                dataKey={`selection_${index}`}
                name={selection.option}
                stroke={lineColors[index % lineColors.length]}
                strokeWidth={2.4}
                dot={{ r: 3, strokeWidth: 1.5 }}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-odds-border bg-odds-control/40 p-3">
          <p className="text-xs text-odds-muted">当前升温</p>
          <p className="mt-1 truncate text-lg font-extrabold numeric text-odds-success">
            {warmingSelection ? `${warmingSelection.option} ${formatOdds(warmingSelection.currentOdds)}` : '暂无'}
          </p>
        </div>
        <div className="rounded-lg border border-odds-border bg-odds-control/40 p-3">
          <p className="text-xs text-odds-muted">最大波动</p>
          <p className="mt-1 text-lg font-extrabold numeric text-odds-warning">
            {strongestSelection ? `${Math.abs(strongestSelection.changePercent).toFixed(1)}%` : '0.0%'}
          </p>
        </div>
        <div className="rounded-lg border border-odds-border bg-odds-control/40 p-3">
          <p className="text-xs text-odds-muted">最新方向</p>
          <p className="mt-1 truncate text-lg font-extrabold text-odds-text">
            {warmingSelection ? `${warmingSelection.option} 降赔` : '暂无'}
          </p>
        </div>
      </div>
    </section>
  );
}
