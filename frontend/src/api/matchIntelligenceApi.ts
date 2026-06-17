import { getMockMatchIntelligence } from '../data/mockMatchIntelligence';
import type {
  GroupStandingResponse,
  LiveStatsResponse,
  MatchDiagnosticsResponse,
  MatchEventsResponse,
  MatchIdentity,
  MatchInjuriesResponse,
  MatchInsightsResponse,
  MatchIntelligence,
  MatchLineupsResponse,
  SourceStatus,
} from '../types/matchIntelligence';

const DEFAULT_API_BASE_URL = '';
const allowMockFallback = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true';

interface ApiEnvelope<T> {
  status: string;
  data: T;
  sourceStatus?: SourceStatus;
  diagnostics?: Record<string, unknown>;
  updatedAt?: string | null;
  error?: string | null;
}

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function joinPath(path: string) {
  return `${apiBaseUrl()}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(joinPath(path), init);
  if (!response.ok) {
    throw new Error(`API 请求失败：${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function unwrapEnvelope<T extends object>(envelope: ApiEnvelope<T>): T {
  return {
    ...envelope.data,
    sourceStatus: envelope.sourceStatus,
    diagnostics: envelope.diagnostics,
    updatedAt: envelope.updatedAt,
  };
}

function markDevSeed<T extends { dataSource?: string; sourceStatus?: SourceStatus }>(fallback: T): T {
  return {
    ...fallback,
    dataSource: 'dev_seed',
    sourceStatus: {
      code: 'dev_seed',
      label: '开发种子数据',
      reason: '仅开发环境显式启用 VITE_ENABLE_MOCK_FALLBACK=true 时展示。',
    },
  };
}

async function requestEnvelope<T extends { dataSource?: string; sourceStatus?: SourceStatus }>(
  path: string,
  fallback: T,
  init?: RequestInit,
): Promise<T> {
  try {
    return unwrapEnvelope(await requestJson<ApiEnvelope<T>>(path, init));
  } catch (error) {
    if (!allowMockFallback) throw error;
    console.warn('比赛情报 API 请求失败，使用开发种子数据。', error);
    return markDevSeed(fallback);
  }
}

async function requestPlain<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(path, init);
  } catch (error) {
    if (!allowMockFallback) throw error;
    console.warn('比赛情报 API 请求失败，使用开发种子数据。', error);
    return fallback;
  }
}

function matchPath(matchId: string, suffix: string) {
  return `/api/matches/${encodeURIComponent(matchId)}${suffix}`;
}

export async function fetchMatchIntelligence(
  matchId: string,
  match?: MatchIdentity,
  init?: RequestInit,
): Promise<MatchIntelligence> {
  const mock = getMockMatchIntelligence(matchId, match);
  const [lineups, injuries, groupStanding, liveStats, events, insights, diagnostics] = await Promise.all([
    requestEnvelope<MatchLineupsResponse>(matchPath(matchId, '/lineups'), mock.lineups, init),
    requestEnvelope<MatchInjuriesResponse>(matchPath(matchId, '/injuries'), mock.injuries, init),
    requestEnvelope<GroupStandingResponse>(matchPath(matchId, '/standings'), mock.groupStanding, init),
    requestEnvelope<LiveStatsResponse>(matchPath(matchId, '/stats'), mock.liveStats, init),
    requestEnvelope<MatchEventsResponse>(matchPath(matchId, '/events'), mock.events, init),
    requestPlain<MatchInsightsResponse>(matchPath(matchId, '/insights'), markDevSeed(mock.insights), init),
    requestPlain<MatchDiagnosticsResponse>(matchPath(matchId, '/data-diagnostics'), mock.diagnostics, init),
  ]);

  return {
    lineups,
    injuries,
    groupStanding,
    liveStats,
    events,
    insights: allowMockFallback && insights.dataSource === 'mock' ? markDevSeed(insights) : insights,
    diagnostics,
  };
}
