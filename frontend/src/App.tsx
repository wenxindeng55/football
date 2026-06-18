import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Eye, EyeOff, Search, TrendingDown } from 'lucide-react';
import {
  addMonitorMatch,
  downloadChart,
  downloadCsv,
  fetchHealth,
  fetchMatch,
  fetchMatches,
  fetchOdds,
  hideMonitorMatch,
  pauseMonitorMatch,
  resumeMonitorMatch,
  type AddMonitorMatchPayload,
  type ApiHealth,
} from './api/oddsApi';
import { fetchAuthSession, logoutAdmin, type AuthUser } from './api/authApi';
import { fetchMatchIntelligence } from './api/matchIntelligenceApi';
import { ActionBar } from './components/ActionBar';
import { AddMatchModal } from './components/AddMatchModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AlertPanel } from './components/AlertPanel';
import { ConfirmActionDialog } from './components/ConfirmActionDialog';
import { DataDiagnosticsPanel } from './components/DataDiagnosticsPanel';
import { EmptyState, LoadingState } from './components/DataStatus';
import type { DataHealthItem } from './components/DataHealthSummary';
import { DataStatusPanel } from './components/DataStatusPanel';
import { GroupMotivationPanel } from './components/GroupMotivationPanel';
import { Header } from './components/Header';
import { InjuryPanel } from './components/InjuryPanel';
import { LineupPanel } from './components/LineupPanel';
import { LiveStatsPanel } from './components/LiveStatsPanel';
import { MarketTabs } from './components/MarketTabs';
import { MobileMatchSelector } from './components/MobileMatchSelector';
import { MatchEventTimeline } from './components/MatchEventTimeline';
import { MatchDateGroup } from './components/MatchDateGroup';
import { MatchInsightPanel } from './components/MatchInsightPanel';
import { MatchOverview } from './components/MatchOverview';
import { OddsSummaryCard } from './components/OddsSummaryCard';
import { OddsEventCorrelationPanel } from './components/OddsEventCorrelationPanel';
import { OddsTable } from './components/OddsTable';
import { RawOddsPanel } from './components/RawOddsPanel';
import { ThemePanel, type ThemeMode } from './components/ThemePanel';
import { Toast, type ToastMessage } from './components/Toast';
import { getEmptyMatchIntelligence, getErrorMatchIntelligence, getMockMatchIntelligence } from './data/mockMatchIntelligence';
import { getMarketRows, matches as mockMatches } from './data/mockOdds';
import type { MatchIntelligence } from './types/matchIntelligence';
import type { MarketData, MarketKey, MatchData, OddsTableRow } from './types/odds';
import { localizeMatch, localizeMarket, localizeOddsRows } from './utils/display';
import { filterMatchesByScheduleWindow, filterMatchesForDashboard, groupMatchesBySchedule } from './utils/matchSchedule';

type ActionKey = 'csv' | 'chart' | 'raw' | 'add';
type DetailTabKey = 'overview' | 'prematch' | 'alerts' | 'odds' | 'correlation' | 'raw' | 'diagnostics';
type MetricTone = 'default' | 'good' | 'warning' | 'danger';

const REFRESH_INTERVAL_MS = 60_000;
const localizedMockMatches = mockMatches.map(localizeMatch);
const allowMockFallback = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true';
const LazyOddsTrendChart = lazy(() =>
  import('./components/OddsTrendChart').then((module) => ({ default: module.OddsTrendChart })),
);
const detailTabs: Array<{ key: DetailTabKey; label: string }> = [
  { key: 'overview', label: '总览' },
  { key: 'prematch', label: '赛前情报' },
  { key: 'alerts', label: '盘口异动' },
  { key: 'odds', label: '赔率走势' },
  { key: 'correlation', label: '事件联动' },
  { key: 'raw', label: '原始数据' },
  { key: 'diagnostics', label: '数据诊断' },
];

function hexToRgbParts(hex: string) {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '9 14 24';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `${red} ${green} ${blue}`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function currentWindowMockMatches() {
  const currentWindowMatches = filterMatchesByScheduleWindow(localizedMockMatches);
  return currentWindowMatches.length > 0 ? currentWindowMatches : localizedMockMatches;
}

function visibleMatchList(matches: MatchData[], showFinishedMatches: boolean) {
  return showFinishedMatches ? matches : matches.filter((match) => match.status !== '已完赛');
}

function nextVisibleMatchId(matches: MatchData[], showFinishedMatches: boolean, currentId: string) {
  const visible = visibleMatchList(matches, showFinishedMatches);
  return visible.some((match) => match.id === currentId) ? currentId : visible[0]?.id ?? '';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function tagRiskWeight(tone: MatchData['tags'][number]['tone']) {
  if (tone === 'danger') return 18;
  if (tone === 'warning') return 10;
  if (tone === 'success') return 2;
  return 0;
}

function alertRiskWeight(level: MatchData['alerts'][number]['level']) {
  if (level === '高风险') return 18;
  if (level === '重要') return 10;
  return 3;
}

function maxMarketMovePercent(match: MatchData) {
  const summaryMax = match.summaryCards.reduce((max, item) => Math.max(max, Math.abs(item.changePercent)), 0);
  const marketMax = Object.values(match.markets).reduce((marketMaxValue, market) => {
    const selectionMax = market.selections.reduce((selectionMaxValue, selection) => {
      if (!selection.openingOdds) return selectionMaxValue;
      const pointMax = selection.points.reduce((pointMaxValue, point) => {
        const change = Math.abs(((point.odds - selection.openingOdds) / selection.openingOdds) * 100);
        return Math.max(pointMaxValue, change);
      }, 0);
      return Math.max(selectionMaxValue, pointMax);
    }, 0);
    return Math.max(marketMaxValue, selectionMax);
  }, 0);

  return Math.max(summaryMax, marketMax);
}

function deriveMatchRiskScore(match: MatchData) {
  const tagScore = Math.min(22, match.tags.reduce((score, tag) => score + tagRiskWeight(tag.tone), 0));
  const alertScore = Math.min(26, match.alerts.reduce((score, alert) => score + alertRiskWeight(alert.level), 0));
  const moveScore = Math.min(30, Math.sqrt(maxMarketMovePercent(match)) * 4);
  const completenessScore = match.dataCompleteness
    ? (1 - clamp(match.dataCompleteness.score / Math.max(match.dataCompleteness.maxScore, 1), 0, 1)) * 10
    : 5;
  const liveScore = match.status === '进行中' ? 4 : 0;
  const pausedPenalty = match.paused ? -10 : 0;

  return clamp(Math.round(10 + tagScore + alertScore + moveScore + completenessScore + liveScore + pausedPenalty), 0, 100);
}

function metricToneClass(tone: MetricTone) {
  if (tone === 'danger') return 'border-odds-danger/35 bg-odds-danger/10 text-odds-danger';
  if (tone === 'warning') return 'border-odds-warning/35 bg-odds-warning/10 text-odds-warning';
  if (tone === 'good') return 'border-odds-success/35 bg-odds-success/10 text-odds-success';
  return 'border-odds-accent/30 bg-odds-accent/10 text-odds-accent';
}

function filterMatchesByQuery(matches: MatchData[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return matches;

  return matches.filter((match) => {
    const searchableText = [
      match.name,
      match.englishName,
      match.homeTeam,
      match.awayTeam,
      match.homeTeamEnglish,
      match.awayTeamEnglish,
      match.league,
      match.matchNo,
      match.matchTime,
      match.status,
      match.direction,
      ...match.tags.map((tag) => tag.label),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

function App() {
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [initialMatchesLoading, setInitialMatchesLoading] = useState(true);
  const [apiMatchIds, setApiMatchIds] = useState<string[]>([]);
  const [activeMarket, setActiveMarket] = useState<MarketKey>('1x2');
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTabKey>('overview');
  const [liveMarket, setLiveMarket] = useState<MarketData | null>(null);
  const [liveRows, setLiveRows] = useState<OddsTableRow[] | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [matchIntelligence, setMatchIntelligence] = useState<MatchIntelligence>(() => getEmptyMatchIntelligence(''));
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addingMatch, setAddingMatch] = useState(false);
  const [hidingMatchId, setHidingMatchId] = useState<string | null>(null);
  const [pauseConfirmMatchId, setPauseConfirmMatchId] = useState<string | null>(null);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('odds-theme') as ThemeMode | null) ?? 'dark');
  const [customBackground, setCustomBackground] = useState(() => localStorage.getItem('odds-custom-bg') ?? '#0b1220');
  const [showFinishedMatches, setShowFinishedMatches] = useState(
    () => localStorage.getItem('odds-show-finished') === 'true',
  );
  const [matchSearch, setMatchSearch] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [openAddAfterLogin, setOpenAddAfterLogin] = useState(false);

  const showToast = useCallback((tone: ToastMessage['tone'], text: string) => {
    setToast({ id: Date.now(), tone, text });
  }, []);
  const canManage = authUser?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    fetchAuthSession()
      .then((session) => {
        if (!cancelled) setAuthUser(session.authenticated ? session.user : null);
      })
      .catch((error) => {
        console.warn('管理员登录状态检查失败。', error);
        if (!cancelled) setAuthUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function requireAdminForAction(message = '请先登录管理员账号。') {
    if (canManage) return true;
    showToast('info', message);
    setLoginModalOpen(true);
    return false;
  }

  function handleLoginSuccess(user: AuthUser) {
    setAuthUser(user);
    setLoginModalOpen(false);
    showToast('success', '管理员登录成功。');
    if (openAddAfterLogin) {
      setOpenAddAfterLogin(false);
      setAddModalOpen(true);
    }
  }

  async function handleLogout() {
    try {
      await logoutAdmin();
      showToast('info', '管理员已退出登录。');
    } catch (error) {
      console.warn('管理员退出登录失败。', error);
      showToast('error', '退出登录失败，请稍后重试。');
    } finally {
      setAuthUser(null);
      setAddModalOpen(false);
      setOpenAddAfterLogin(false);
    }
  }

  const loadMatches = useCallback(async () => {
    try {
      const apiMatches = await fetchMatches();
      if (apiMatches.length === 0) {
        const fallbackMatches = allowMockFallback ? currentWindowMockMatches() : [];
        console.warn(
          allowMockFallback
            ? '后端 API 暂无比赛数据，使用开发种子比赛。'
            : '后端 API 暂无比赛数据，生产模式不使用 mock fallback。',
        );
        setApiMatchIds([]);
        setMatches(fallbackMatches);
        setSelectedMatchId((currentId) => nextVisibleMatchId(fallbackMatches, showFinishedMatches, currentId));
        setLiveMarket(null);
        setLiveRows(null);
        return;
      }

      const localizedMatches = filterMatchesForDashboard(apiMatches.map(localizeMatch));
      setApiMatchIds(localizedMatches.map((match) => match.id));
      setMatches(localizedMatches);
      setSelectedMatchId((currentId) => nextVisibleMatchId(localizedMatches, showFinishedMatches, currentId));
    } catch (error) {
      const fallbackMatches = allowMockFallback ? currentWindowMockMatches() : [];
      setApiMatchIds([]);
      console.warn(
        allowMockFallback
          ? '后端 API 请求失败，使用开发种子比赛。'
          : '后端 API 请求失败，生产模式不使用 mock fallback。',
        error,
      );
      setMatches((currentMatches) => {
        if (currentMatches.length > 0) return currentMatches;
        setSelectedMatchId(nextVisibleMatchId(fallbackMatches, showFinishedMatches, ''));
        return fallbackMatches;
      });
    } finally {
      setInitialMatchesLoading(false);
    }
  }, [showFinishedMatches]);

  useEffect(() => {
    void loadMatches();
    const timer = window.setInterval(() => {
      void loadMatches();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadMatches]);

  useEffect(() => {
    let cancelled = false;

    const loadHealth = () => {
      fetchHealth()
        .then((health) => {
          if (cancelled) return;
          setApiHealth(health);
          setHealthError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setHealthError(message);
          setApiHealth(null);
        });
    };

    loadHealth();
    const timer = window.setInterval(loadHealth, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--custom-bg-rgb', hexToRgbParts(customBackground));
    localStorage.setItem('odds-theme', theme);
    localStorage.setItem('odds-custom-bg', customBackground);
  }, [customBackground, theme]);

  useEffect(() => {
    localStorage.setItem('odds-show-finished', String(showFinishedMatches));
  }, [showFinishedMatches]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const finishedMatches = useMemo(() => matches.filter((match) => match.status === '已完赛'), [matches]);
  const visibleMatches = useMemo(
    () => visibleMatchList(matches, showFinishedMatches),
    [matches, showFinishedMatches],
  );
  const matchRiskScores = useMemo(
    () => Object.fromEntries(visibleMatches.map((match) => [match.id, deriveMatchRiskScore(match)])),
    [visibleMatches],
  );
  const radarMatches = useMemo(() => {
    const filtered = filterMatchesByQuery(visibleMatches, matchSearch);
    return [...filtered].sort((left, right) => {
      const scoreDiff = (matchRiskScores[right.id] ?? 0) - (matchRiskScores[left.id] ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return left.matchTime.localeCompare(right.matchTime) || left.name.localeCompare(right.name);
    });
  }, [matchRiskScores, matchSearch, visibleMatches]);
  const visibleMatchIds = useMemo(() => new Set(visibleMatches.map((match) => match.id)), [visibleMatches]);
  const hasVisibleMatches = visibleMatches.length > 0;

  useEffect(() => {
    if (!hasVisibleMatches || visibleMatchIds.has(selectedMatchId)) return;
    setSelectedMatchId(visibleMatches[0].id);
    setActiveMarket('1x2');
    setActiveDetailTab('overview');
    setLiveMarket(null);
    setLiveRows(null);
  }, [hasVisibleMatches, selectedMatchId, visibleMatchIds, visibleMatches]);

  const selectedMatch = useMemo(
    () =>
      visibleMatches.find((match) => match.id === selectedMatchId) ??
      visibleMatches[0] ??
      matches.find((match) => match.id === selectedMatchId) ??
      matches[0] ??
      localizedMockMatches[0],
    [matches, selectedMatchId, visibleMatches],
  );
  const matchGroups = useMemo(
    () =>
      groupMatchesBySchedule(radarMatches).map((group) => ({
        ...group,
        matches: [...group.matches].sort((left, right) => (matchRiskScores[right.id] ?? 0) - (matchRiskScores[left.id] ?? 0)),
      })),
    [matchRiskScores, radarMatches],
  );
  const hasRadarMatches = radarMatches.length > 0;
  const selectedMatchFromApi = apiMatchIds.includes(selectedMatch.id);
  const selectedRiskScore = matchRiskScores[selectedMatch.id] ?? deriveMatchRiskScore(selectedMatch);
  const dashboardMetrics = useMemo(() => {
    const highRiskSignals = visibleMatches.reduce(
      (total, match) =>
        total + match.alerts.filter((alert) => alert.level === '高风险').length + match.tags.filter((tag) => tag.tone === 'danger').length,
      0,
    );
    const heatSignals = visibleMatches.reduce(
      (total, match) => total + match.summaryCards.filter((summary) => summary.changePercent < 0).length,
      0,
    );
    const activeCollectors = visibleMatches.filter((match) => !match.paused).length;
    const highestRisk = visibleMatches.reduce((max, match) => Math.max(max, matchRiskScores[match.id] ?? 0), 0);

    return [
      {
        label: '监控比赛',
        value: String(visibleMatches.length),
        hint: `${activeCollectors} 场采集中`,
        tone: 'good' as MetricTone,
        Icon: Activity,
      },
      {
        label: '高风险信号',
        value: String(highRiskSignals),
        hint: highestRisk > 0 ? `最高风险 ${highestRisk}/100` : '暂无风险评分',
        tone: highRiskSignals > 0 ? 'danger' as MetricTone : 'default' as MetricTone,
        Icon: AlertTriangle,
      },
      {
        label: '降赔升温',
        value: String(heatSignals),
        hint: '来自盘口摘要与赔率序列',
        tone: heatSignals > 0 ? 'warning' as MetricTone : 'default' as MetricTone,
        Icon: TrendingDown,
      },
      {
        label: showFinishedMatches ? '已显示完赛' : '已隐藏完赛',
        value: String(finishedMatches.length),
        hint: showFinishedMatches ? '当前纳入赛事雷达' : '可一键恢复显示',
        tone: 'default' as MetricTone,
        Icon: showFinishedMatches ? Eye : EyeOff,
      },
    ];
  }, [finishedMatches.length, matchRiskScores, showFinishedMatches, visibleMatches]);

  useEffect(() => {
    if (!hasVisibleMatches || !selectedMatchId) {
      setMatchIntelligence(getEmptyMatchIntelligence(selectedMatchId));
      setIntelligenceLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const fallback = allowMockFallback ? getMockMatchIntelligence(selectedMatch.id, selectedMatch) : getEmptyMatchIntelligence(selectedMatch.id);
    setMatchIntelligence(selectedMatchFromApi ? getEmptyMatchIntelligence(selectedMatch.id) : fallback);

    const loadIntelligence = () => {
      setIntelligenceLoading(true);
      fetchMatchIntelligence(selectedMatch.id, selectedMatch, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) setMatchIntelligence(data);
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.warn('比赛情报同步失败。', error);
            const message = error instanceof Error ? error.message : String(error);
            setMatchIntelligence(selectedMatchFromApi ? getErrorMatchIntelligence(selectedMatch.id, message) : fallback);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIntelligenceLoading(false);
        });
    };

    loadIntelligence();
    const timer = window.setInterval(loadIntelligence, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    hasVisibleMatches,
    selectedMatch.id,
    selectedMatch.name,
    selectedMatch.homeTeam,
    selectedMatch.awayTeam,
    selectedMatchFromApi,
    selectedMatchId,
  ]);
  const headerUpdatedAt =
    initialMatchesLoading && matches.length === 0 ? '加载中' : hasVisibleMatches ? selectedMatch.updatedAt : '接口返回 0 条';
  const healthItems = useMemo<DataHealthItem[]>(() => {
    const sourceByType = (dataType: string) =>
      matchIntelligence.diagnostics.sources.find((source) => source.dataType === dataType || source.name === dataType);
    const sourceStatus = (dataType: string): DataHealthItem => {
      const labels: Record<string, string> = {
        lineups: '首发',
        events: '事件',
        stats: '统计',
      };
      const source = sourceByType(dataType);
      if (!source) return { label: labels[dataType] ?? dataType, value: '接口未调用', tone: 'info' };
      const status = source.status.toLowerCase();
      if (source.rowCount > 0 && !status.includes('failed') && !status.includes('error')) {
        return { label: labels[dataType] ?? dataType, value: '正常', tone: 'success' };
      }
      if (status.includes('not_configured')) return { label: labels[dataType] ?? dataType, value: '未配置', tone: 'warning' };
      if (status.includes('mapping')) return { label: labels[dataType] ?? dataType, value: '映射失败', tone: 'warning' };
      if (status.includes('failed') || status.includes('error')) return { label: labels[dataType] ?? dataType, value: '采集失败', tone: 'danger' };
      return { label: labels[dataType] ?? dataType, value: '缺失', tone: 'warning' };
    };
    const completenessScore = selectedMatch.dataCompleteness
      ? selectedMatch.dataCompleteness.score / Math.max(selectedMatch.dataCompleteness.maxScore, 1)
      : 0;
    const oddsNormal = Boolean(apiHealth?.databaseExists && apiHealth.tableExists && apiHealth.matchCount > 0);

    return [
      {
        label: '盘口',
        value: oddsNormal ? '正常' : healthError ? '接口未调用' : '缺失',
        tone: oddsNormal ? 'success' : healthError ? 'danger' : 'warning',
      },
      sourceStatus('lineups'),
      sourceStatus('events'),
      sourceStatus('stats'),
      {
        label: '数据完整度',
        value: selectedMatch.dataCompleteness?.label ?? '0/100',
        tone: completenessScore >= 0.7 ? 'success' : completenessScore >= 0.4 ? 'warning' : 'danger',
      },
    ];
  }, [apiHealth, healthError, matchIntelligence.diagnostics.sources, selectedMatch.dataCompleteness]);

  useEffect(() => {
    const controller = new AbortController();
    const requestMatchId = selectedMatch.id;
    setLiveMarket(null);
    setLiveRows(null);

    if (!apiMatchIds.includes(requestMatchId)) {
      setMarketLoading(false);
      return () => controller.abort();
    }

    const loadOdds = () => {
      setMarketLoading(true);
      fetchOdds(requestMatchId, activeMarket, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          setLiveMarket(localizeMarket(response.series));
          setLiveRows(localizeOddsRows(response.rows));
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.warn('盘口明细 API 请求失败，继续使用当前页面数据。', error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setMarketLoading(false);
        });
    };

    loadOdds();
    const timer = window.setInterval(loadOdds, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeMarket, apiMatchIds, selectedMatch.id]);

  const market =
    liveMarket ??
    selectedMatch.markets[activeMarket] ??
    selectedMatch.markets['1x2'] ??
    localizedMockMatches[0].markets[activeMarket] ??
    localizedMockMatches[0].markets['1x2'];
  const tableRows = useMemo(
    () => liveRows ?? (selectedMatch.markets[activeMarket] ? getMarketRows(selectedMatch, activeMarket) : []),
    [activeMarket, liveRows, selectedMatch],
  );

  async function handleSelectMatch(id: string) {
    setSelectedMatchId(id);
    setActiveMarket('1x2');
    setActiveDetailTab('overview');
    setLiveMarket(null);
    setLiveRows(null);

    if (!apiMatchIds.includes(id)) return;

    try {
      const detail = localizeMatch(await fetchMatch(id));
      setMatches((currentMatches) => currentMatches.map((match) => (match.id === id ? detail : match)));
    } catch (error) {
      console.warn('比赛详情 API 请求失败，继续使用当前比赛数据。', error);
    }
  }

  async function handleExportCsv() {
    if (!requireAdminForAction('导出 CSV 需要管理员登录。')) return;
    setLoadingAction('csv');
    try {
      const { blob, filename } = await downloadCsv(selectedMatch.id, activeMarket);
      saveBlob(blob, filename ?? `odds_${selectedMatch.id}_${activeMarket}.csv`);
      showToast('success', 'CSV 已从后台导出。');
    } catch (error) {
      console.warn('CSV 导出失败。', error);
      showToast('error', 'CSV 导出失败，请确认后台已启动且当前比赛存在真实采集数据。');
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleExportChart() {
    if (!requireAdminForAction('导出图表需要管理员登录。')) return;
    setLoadingAction('chart');
    try {
      const { blob, filename } = await downloadChart(selectedMatch.id, activeMarket);
      saveBlob(blob, filename ?? `odds_${selectedMatch.id}_${activeMarket}.png`);
      showToast('success', '图表已从后台生成并下载。');
    } catch (error) {
      console.warn('图表导出失败。', error);
      showToast('error', '图表导出失败，请确认后台当前盘口有真实采集数据。');
    } finally {
      setLoadingAction(null);
    }
  }

  function handleViewRawData() {
    if (!requireAdminForAction('查看原始数据需要管理员登录。')) return;
    setActiveDetailTab('raw');
    showToast('info', '已切换到原始数据页签，表格将按 20 条分页读取。');
  }

  function handleOpenAddMatch() {
    if (!canManage) {
      setOpenAddAfterLogin(true);
      requireAdminForAction('添加监控比赛需要管理员登录。');
      return;
    }
    setAddModalOpen(true);
  }

  async function handleAddMonitorMatch(payload: AddMonitorMatchPayload) {
    if (!requireAdminForAction('添加监控比赛需要管理员登录。')) return;
    if (!payload.url) {
      showToast('error', '请填写比赛 URL。');
      return;
    }

    setAddingMatch(true);
    try {
      const response = await addMonitorMatch(payload);
      showToast(response.status === 'added' ? 'success' : 'info', response.message);
      setAddModalOpen(false);
      await loadMatches();
    } catch (error) {
      console.warn('添加监控比赛失败。', error);
      showToast('error', '添加监控比赛失败，请确认后台配置文件可写。');
      throw error;
    } finally {
      setAddingMatch(false);
    }
  }

  async function handleHideMonitorMatch(matchId: string) {
    if (!requireAdminForAction('隐藏比赛需要管理员登录。')) return;
    const match = matches.find((item) => item.id === matchId);
    if (!match) return;
    const confirmed = window.confirm(`确认从看板隐藏「${match.name}」吗？采集状态不会改变，历史数据会保留。`);
    if (!confirmed) return;

    setHidingMatchId(matchId);
    try {
      const response = await hideMonitorMatch(matchId);
      showToast('success', response.message);
      const nextMatches = matches.filter((item) => item.id !== matchId);
      const fallbackMatches = allowMockFallback ? currentWindowMockMatches() : [];
      const displayMatches = nextMatches.length > 0 ? nextMatches : fallbackMatches;
      setApiMatchIds((currentIds) => currentIds.filter((id) => id !== matchId));
      setMatches(displayMatches);
      if (selectedMatchId === matchId) {
        setSelectedMatchId(nextVisibleMatchId(displayMatches, showFinishedMatches, ''));
        setActiveDetailTab('overview');
        setLiveMarket(null);
        setLiveRows(null);
      }
      await loadMatches();
    } catch (error) {
      console.warn('隐藏比赛失败。', error);
      showToast('error', '隐藏比赛失败，请确认后台配置文件可写。');
    } finally {
      setHidingMatchId(null);
    }
  }

  function handlePauseMonitorMatch(matchId: string) {
    if (!requireAdminForAction('暂停采集需要管理员登录。')) return;
    const match = matches.find((item) => item.id === matchId);
    if (!match) return;
    setPauseConfirmMatchId(matchId);
  }

  async function confirmPauseMonitorMatch() {
    const matchId = pauseConfirmMatchId;
    if (!matchId) return;
    setHidingMatchId(matchId);
    try {
      const response = await pauseMonitorMatch(matchId);
      showToast('success', response.message);
      setMatches((currentMatches) => currentMatches.map((item) => (item.id === matchId ? { ...item, paused: true } : item)));
      await loadMatches();
    } catch (error) {
      console.warn('暂停采集失败。', error);
      showToast('error', '暂停采集失败，请确认后台配置文件可写。');
    } finally {
      setHidingMatchId(null);
      setPauseConfirmMatchId(null);
    }
  }

  async function handleResumeMonitorMatch(matchId: string) {
    if (!requireAdminForAction('恢复采集需要管理员登录。')) return;
    setHidingMatchId(matchId);
    try {
      const response = await resumeMonitorMatch(matchId);
      showToast('success', response.message);
      setMatches((currentMatches) => currentMatches.map((item) => (item.id === matchId ? { ...item, paused: false } : item)));
      await loadMatches();
    } catch (error) {
      console.warn('恢复采集失败。', error);
      showToast('error', '恢复采集失败，请确认后台配置文件可写。');
    } finally {
      setHidingMatchId(null);
    }
  }

  const intelligenceStatusCards = [
    {
      moduleName: '首发名单',
      sourceStatus: matchIntelligence.lineups.sourceStatus,
      dataSource: matchIntelligence.lineups.dataSource,
      updatedAt: matchIntelligence.lineups.updatedAt,
      rowCount: matchIntelligence.lineups.lineups.length,
      reason: matchIntelligence.lineups.explanation,
    },
    {
      moduleName: '伤停信息',
      sourceStatus: matchIntelligence.injuries.sourceStatus,
      dataSource: matchIntelligence.injuries.dataSource,
      updatedAt: matchIntelligence.injuries.updatedAt,
      rowCount: matchIntelligence.injuries.injuries.length,
      reason: matchIntelligence.injuries.explanation,
    },
    {
      moduleName: '技术统计',
      sourceStatus: matchIntelligence.liveStats.sourceStatus,
      dataSource: matchIntelligence.liveStats.dataSource,
      updatedAt: matchIntelligence.liveStats.updatedAt,
      rowCount: matchIntelligence.liveStats.timeline.length,
      reason: matchIntelligence.liveStats.explanation,
    },
  ];

  function renderMarketToolbar() {
    return (
      <section className="surface bg-odds-panel2/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-odds-text">盘口类型</h3>
            <p className="mt-1 text-sm text-odds-muted">
              点击 Tab 后，图表和表格同步切换。{marketLoading ? '正在同步后台数据...' : ''}
            </p>
          </div>
          <MarketTabs activeMarket={activeMarket} onChange={setActiveMarket} />
        </div>
      </section>
    );
  }

  function renderOddsWorkspace(includeChart: boolean) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {renderMarketToolbar()}
        {includeChart ? (
          <Suspense
            fallback={
              <section className="surface p-5">
                <LoadingState title="正在加载赔率走势图..." />
              </section>
            }
          >
            <LazyOddsTrendChart market={market} />
          </Suspense>
        ) : null}
        <OddsTable rows={tableRows} />
      </div>
    );
  }

  const detailTabContent = (() => {
    switch (activeDetailTab) {
      case 'prematch':
        return (
          <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <LineupPanel data={matchIntelligence.lineups} />
            <div className="flex min-w-0 flex-col gap-5">
              <InjuryPanel data={matchIntelligence.injuries} />
              <GroupMotivationPanel data={matchIntelligence.groupStanding} />
            </div>
          </section>
        );
      case 'alerts':
        return (
          <section className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="grid min-w-0 content-start items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {selectedMatch.summaryCards.map((summary) => (
                <OddsSummaryCard key={summary.title} summary={summary} />
              ))}
            </div>
            <AlertPanel alerts={selectedMatch.alerts} />
          </section>
        );
      case 'odds':
        return renderOddsWorkspace(true);
      case 'correlation':
        return (
          <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              <MatchEventTimeline data={matchIntelligence.events} />
              <LiveStatsPanel data={matchIntelligence.liveStats} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <OddsEventCorrelationPanel data={matchIntelligence.insights} />
              <MatchInsightPanel data={matchIntelligence.insights} loading={intelligenceLoading} />
            </div>
          </section>
        );
      case 'raw':
        return <RawOddsPanel matchId={selectedMatch.id} canRead={canManage} />;
      case 'diagnostics':
        return <DataDiagnosticsPanel data={matchIntelligence.diagnostics} />;
      case 'overview':
      default:
        return (
          <div className="flex min-w-0 flex-col gap-5">
            <MatchOverview match={selectedMatch} riskScore={selectedRiskScore} />
            <section className="grid min-w-0 gap-4 lg:grid-cols-3">
              {selectedMatch.summaryCards.map((summary) => (
                <OddsSummaryCard key={summary.title} summary={summary} />
              ))}
            </section>
            <MatchInsightPanel data={matchIntelligence.insights} loading={intelligenceLoading} />
            <LiveStatsPanel data={matchIntelligence.liveStats} />
            <section className="grid min-w-0 gap-3 lg:grid-cols-3">
              {intelligenceStatusCards.map((item) => (
                <DataStatusPanel
                  key={item.moduleName}
                  moduleName={item.moduleName}
                  sourceStatus={item.sourceStatus}
                  dataSource={item.dataSource}
                  updatedAt={item.updatedAt}
                  rowCount={item.rowCount}
                  reason={item.reason}
                  compact
                />
              ))}
            </section>
          </div>
        );
    }
  })();
  const pauseConfirmMatch = pauseConfirmMatchId ? matches.find((match) => match.id === pauseConfirmMatchId) : null;

  return (
    <main className="min-h-screen min-w-0 px-3 py-4 text-odds-text sm:px-5 lg:px-6 lg:py-7">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <Header
          updatedAt={headerUpdatedAt}
          timezone="Asia/Singapore"
          healthItems={healthItems}
          exporting={loadingAction === 'csv'}
          exportDisabled={!hasVisibleMatches || !canManage}
          adminUsername={authUser?.username ?? null}
          authChecking={authChecking}
          onExportCsv={handleExportCsv}
          onOpenSettings={() => setThemePanelOpen(true)}
          onLogin={() => setLoginModalOpen(true)}
          onLogout={() => void handleLogout()}
        />

        {hasVisibleMatches ? (
          <MobileMatchSelector
            matches={radarMatches.length > 0 ? radarMatches : visibleMatches}
            selectedMatchId={selectedMatch.id}
            riskScores={matchRiskScores}
            onSelect={(id) => void handleSelectMatch(id)}
          />
        ) : null}

        <section className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
          {dashboardMetrics.map((metric) => {
            const Icon = metric.Icon;
            return (
              <article key={metric.label} className="surface min-w-0 overflow-hidden p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-odds-muted">{metric.label}</p>
                    <p className="mt-2 truncate text-3xl font-extrabold tracking-normal text-odds-text">{metric.value}</p>
                  </div>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${metricToneClass(metric.tone)}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 truncate text-xs text-odds-muted">{metric.hint}</p>
              </article>
            );
          })}
        </section>

        <div className="grid min-w-0 gap-5 xl:grid-cols-[430px_minmax(0,1fr)] xl:items-start">
          <aside className="surface hidden min-w-0 overflow-hidden xl:sticky xl:top-6 xl:block xl:max-h-[calc(100vh-3rem)]">
            <div className="border-b border-odds-border px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:flex-col 2xl:flex-row">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-odds-text">赛事雷达</h2>
                  <p className="mt-1 text-xs text-odds-muted">按风险和盘口变化排序</p>
                </div>
                <label className="focus-within:ring-2 focus-within:ring-odds-accent/50 flex h-10 min-w-0 items-center gap-2 rounded-lg border border-odds-border bg-odds-control/45 px-3 text-sm text-odds-muted transition sm:min-w-[210px] lg:min-w-0 2xl:min-w-[210px]">
                  <Search className="h-4 w-4 shrink-0 text-odds-accent" />
                  <input
                    value={matchSearch}
                    onChange={(event) => setMatchSearch(event.target.value)}
                    placeholder="搜索球队 / 时间"
                    className="min-w-0 flex-1 bg-transparent text-odds-text placeholder:text-odds-muted focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] min-w-0 overflow-y-auto p-4 sm:p-5 xl:max-h-[calc(100vh-10rem)]">
              {finishedMatches.length > 0 ? (
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-odds-border bg-odds-control/35 p-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch 2xl:flex-row 2xl:items-center">
                  <div className="flex min-w-0 items-center gap-2 text-sm text-odds-text2">
                    {showFinishedMatches ? (
                      <Eye className="h-4 w-4 shrink-0 text-odds-accent" />
                    ) : (
                      <EyeOff className="h-4 w-4 shrink-0 text-odds-muted" />
                    )}
                    <span className="truncate">
                      {showFinishedMatches
                        ? `已显示 ${finishedMatches.length} 场已完赛`
                        : `已隐藏 ${finishedMatches.length} 场已完赛`}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showFinishedMatches}
                    onClick={() => setShowFinishedMatches((current) => !current)}
                    className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-odds-border bg-odds-control px-3 py-2 text-xs text-odds-text2 transition hover:border-odds-accent/50 hover:text-odds-text"
                  >
                    {showFinishedMatches ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {showFinishedMatches ? '隐藏已完赛' : '显示已完赛'}
                  </button>
                </div>
              ) : null}

              {initialMatchesLoading && matches.length === 0 ? (
                <LoadingState title="正在加载比赛数据..." />
              ) : hasVisibleMatches && hasRadarMatches ? (
                <div className="grid min-w-0 gap-5">
                  {matchGroups.map((group) => (
                    <MatchDateGroup
                      key={group.key}
                      group={group}
                      selectedMatchId={selectedMatch.id}
                      riskScores={matchRiskScores}
                      onSelect={(id) => void handleSelectMatch(id)}
                      onHide={(id) => void handleHideMonitorMatch(id)}
                      onPause={(id) => void handlePauseMonitorMatch(id)}
                      onResume={(id) => void handleResumeMonitorMatch(id)}
                      hidingMatchId={hidingMatchId}
                      canManage={canManage}
                    />
                  ))}
                </div>
              ) : hasVisibleMatches ? (
                <EmptyState
                  title="赛事雷达"
                  reasonCode="api_zero_rows"
                  reason="接口已有比赛数据，但当前搜索条件返回 0 条。"
                  rowCount={0}
                  suggestedAction="清空搜索关键词，或检查球队名称、时间和联赛字段。"
                />
              ) : (
                <EmptyState
                  title="赛事雷达"
                  reasonCode={healthError ? 'api_not_called' : 'database_no_records'}
                  reason="当前没有今天或明天的未完赛比赛。"
                  rowCount={0}
                  suggestedAction="确认后端 API 是否启动，并检查 SQLite 采集数据是否包含当前日期窗口。"
                  tone={healthError ? 'danger' : 'warning'}
                />
              )}
            </div>
          </aside>

          {hasVisibleMatches ? (
            <section className="surface min-w-0 overflow-hidden">
              <div className="sticky top-0 z-20 border-b border-odds-border bg-odds-panel/95 backdrop-blur">
                <div className="flex min-w-0 gap-2 overflow-x-auto px-3 pt-3">
                  {detailTabs.map((tab) => {
                    const active = activeDetailTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveDetailTab(tab.key)}
                        className={`focus-ring relative shrink-0 border-b-2 px-2 pb-3 pt-2 text-sm font-semibold transition ${
                          active
                            ? 'border-odds-accent text-odds-text'
                            : 'border-transparent text-odds-muted hover:border-odds-border hover:text-odds-text2'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <ActionBar
                loadingAction={loadingAction}
                canManage={canManage}
                onExportCsv={handleExportCsv}
                onExportChart={handleExportChart}
                onViewRawData={handleViewRawData}
                onAddMatch={handleOpenAddMatch}
                embedded
                title="快捷操作"
                description="导出、回看和扩展监控对象"
              />
              <div className="p-4 sm:p-5">{detailTabContent}</div>
            </section>
          ) : (
            <section className="surface min-w-0 p-4 sm:p-5">
              {initialMatchesLoading ? (
                <LoadingState title="正在加载比赛数据..." />
              ) : (
                <EmptyState
                  title="单场详情"
                  reasonCode={healthError ? 'api_not_called' : 'database_no_records'}
                  reason="当前没有可选比赛，因此不会调用单场详情、情报、赔率和诊断接口。"
                  rowCount={0}
                  suggestedAction="确认后端 API、SQLite 数据和当前日期窗口是否有可监控比赛。"
                  tone={healthError ? 'danger' : 'warning'}
                />
              )}
            </section>
          )}
        </div>
      </div>

      <ThemePanel
        open={themePanelOpen}
        theme={theme}
        customBackground={customBackground}
        onThemeChange={setTheme}
        onCustomBackgroundChange={setCustomBackground}
        onClose={() => setThemePanelOpen(false)}
      />
      <ConfirmActionDialog
        open={Boolean(pauseConfirmMatch)}
        title="暂停采集"
        message={
          pauseConfirmMatch
            ? `确认暂停采集「${pauseConfirmMatch.name}」吗？看板会保留历史数据，但后续采集会跳过该比赛。`
            : ''
        }
        confirmLabel="暂停采集"
        loading={Boolean(pauseConfirmMatchId && hidingMatchId === pauseConfirmMatchId)}
        onConfirm={() => void confirmPauseMonitorMatch()}
        onCancel={() => setPauseConfirmMatchId(null)}
      />
      <AdminLoginModal
        open={loginModalOpen}
        onClose={() => {
          setLoginModalOpen(false);
          setOpenAddAfterLogin(false);
        }}
        onSuccess={handleLoginSuccess}
      />
      <AddMatchModal
        open={addModalOpen}
        loading={addingMatch}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddMonitorMatch}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
    </main>
  );
}

export default App;
