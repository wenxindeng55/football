import type { AlertItem, MarketData, MarketKey, MatchData, SummaryCardData } from '../types/odds';

const DEFAULT_API_BASE_URL = '';

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function joinPath(path: string) {
  return `${apiBaseUrl()}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers;
  const response = await fetch(joinPath(path), { ...init, headers });
  if (!response.ok) {
    throw new Error(`API 请求失败：${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(joinPath(path));
  if (!response.ok) {
    throw new Error(`API 请求失败：${response.status} ${response.statusText}`);
  }

  const disposition = response.headers.get('content-disposition');
  const filename = disposition?.match(/filename="([^"]+)"/i)?.[1] ?? null;
  return { blob: await response.blob(), filename };
}

export interface ApiHealth {
  status: string;
  databasePath: string;
  databaseExists: boolean;
  tableExists: boolean;
  matchCount: number;
}

export interface ApiMarketInfo {
  key: string | null;
  label: string;
  marketType: string;
  rowCount: number;
}

export interface ApiOddsResponse {
  matchId: string;
  market: string;
  series: MarketData;
  rows: Array<{
    time: string;
    marketType: string;
    option: string;
    openingOdds: number;
    currentOdds: number;
    changePercent: number;
    interpretation: string;
  }>;
}

export interface RawOddsRow {
  id: number;
  collectedAt: string;
  pageUpdatedAt: string;
  matchName: string;
  matchUrl: string;
  marketType: string;
  optionName: string;
  openingOdds: number;
  currentOdds: number;
  changePercent: number;
  rawHtmlPath: string;
}

export interface RawOddsResponse {
  matchId: string;
  market: string;
  rows: RawOddsRow[];
}

export interface AddMonitorMatchPayload {
  name: string;
  url: string;
  matchTime?: string | null;
  league?: string | null;
  matchNo?: string | null;
}

export interface AddMonitorMatchResponse {
  status: 'added' | 'exists';
  message: string;
  match: AddMonitorMatchPayload;
  matches: AddMonitorMatchPayload[];
}

export interface DiscoveryMatch {
  name: string;
  nameZh: string;
  url: string;
  matchTime: string | null;
  league: string | null;
  matchNo: string | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh: string;
  awayTeamZh: string;
  monitored: boolean;
  hidden: boolean;
  paused: boolean;
}

export interface DiscoveryDateGroup {
  date: string;
  matches: DiscoveryMatch[];
}

export interface DiscoveryMatchesResponse {
  source: string;
  timezone: string;
  days: number;
  dates: DiscoveryDateGroup[];
}

export interface HideMatchResponse {
  status: 'hidden' | 'paused' | 'active';
  message: string;
  match: {
    name: string;
    nameZh: string;
    url: string;
    hiddenAt: string;
    reason: string;
  };
}

export function fetchHealth() {
  return requestJson<ApiHealth>('/api/health');
}

export function fetchMatches(init?: RequestInit) {
  return requestJson<MatchData[]>('/api/matches', init);
}

export function fetchMatch(matchId: string, init?: RequestInit) {
  return requestJson<MatchData>(`/api/matches/${encodeURIComponent(matchId)}`, init);
}

export function fetchMarkets(matchId: string) {
  return requestJson<ApiMarketInfo[]>(`/api/matches/${encodeURIComponent(matchId)}/markets`);
}

export function fetchOdds(matchId: string, market: string, init?: RequestInit) {
  const search = new URLSearchParams({ market, limit: '300' });
  return requestJson<ApiOddsResponse>(`/api/matches/${encodeURIComponent(matchId)}/odds?${search}`, init);
}

export function fetchSummary(matchId: string) {
  return requestJson<SummaryCardData[]>(`/api/matches/${encodeURIComponent(matchId)}/summary`);
}

export function fetchAlerts(matchId: string) {
  return requestJson<AlertItem[]>(`/api/matches/${encodeURIComponent(matchId)}/alerts`);
}

export function fetchRawOdds(matchId: string, market: MarketKey) {
  const search = new URLSearchParams({ market });
  return requestJson<RawOddsResponse>(`/api/matches/${encodeURIComponent(matchId)}/raw?${search}`);
}

export function downloadCsv(matchId: string, market: MarketKey) {
  const search = new URLSearchParams({ market });
  return requestBlob(`/api/matches/${encodeURIComponent(matchId)}/export.csv?${search}`);
}

export function downloadChart(matchId: string, market: MarketKey) {
  const search = new URLSearchParams({ market });
  return requestBlob(`/api/matches/${encodeURIComponent(matchId)}/chart.png?${search}`);
}

export function addMonitorMatch(payload: AddMonitorMatchPayload) {
  return requestJson<AddMonitorMatchResponse>('/api/config/matches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchDiscoveryMatches(days = 7) {
  const search = new URLSearchParams({ days: String(days) });
  return requestJson<DiscoveryMatchesResponse>(`/api/discovery/matches?${search}`);
}

export function hideMonitorMatch(matchId: string) {
  return requestJson<HideMatchResponse>(`/api/config/matches/${encodeURIComponent(matchId)}`, {
    method: 'DELETE',
  });
}

export function pauseMonitorMatch(matchId: string) {
  return requestJson<HideMatchResponse>(`/api/config/matches/${encodeURIComponent(matchId)}/pause`, {
    method: 'POST',
  });
}

export function resumeMonitorMatch(matchId: string) {
  return requestJson<HideMatchResponse>(`/api/config/matches/${encodeURIComponent(matchId)}/pause`, {
    method: 'DELETE',
  });
}
