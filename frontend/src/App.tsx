import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addMonitorMatch,
  downloadChart,
  downloadCsv,
  fetchMatch,
  fetchMatches,
  fetchOdds,
  fetchRawOdds,
  hideMonitorMatch,
  type AddMonitorMatchPayload,
  type RawOddsRow,
} from './api/oddsApi';
import { ActionBar } from './components/ActionBar';
import { AddMatchModal } from './components/AddMatchModal';
import { AlertPanel } from './components/AlertPanel';
import { Header } from './components/Header';
import { MarketTabs } from './components/MarketTabs';
import { MatchDateGroup } from './components/MatchDateGroup';
import { MatchOverview } from './components/MatchOverview';
import { OddsSummaryCard } from './components/OddsSummaryCard';
import { OddsTable } from './components/OddsTable';
import { OddsTrendChart } from './components/OddsTrendChart';
import { RawDataModal } from './components/RawDataModal';
import { ThemePanel, type ThemeMode } from './components/ThemePanel';
import { Toast, type ToastMessage } from './components/Toast';
import { getMarketRows, matches as mockMatches } from './data/mockOdds';
import type { MarketData, MarketKey, MatchData, OddsTableRow } from './types/odds';
import { localizeMatch, localizeMarket, localizeOddsRows } from './utils/display';
import { groupMatchesBySchedule } from './utils/matchSchedule';

type ActionKey = 'csv' | 'chart' | 'raw' | 'add';

const REFRESH_INTERVAL_MS = 60_000;
const localizedMockMatches = mockMatches.map(localizeMatch);

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

function App() {
  const [matches, setMatches] = useState<MatchData[]>(localizedMockMatches);
  const [selectedMatchId, setSelectedMatchId] = useState(localizedMockMatches[0].id);
  const [apiMatchIds, setApiMatchIds] = useState<string[]>([]);
  const [activeMarket, setActiveMarket] = useState<MarketKey>('1x2');
  const [liveMarket, setLiveMarket] = useState<MarketData | null>(null);
  const [liveRows, setLiveRows] = useState<OddsTableRow[] | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null);
  const [rawRows, setRawRows] = useState<RawOddsRow[]>([]);
  const [rawModalOpen, setRawModalOpen] = useState(false);
  const [rawLoading, setRawLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addingMatch, setAddingMatch] = useState(false);
  const [hidingMatchId, setHidingMatchId] = useState<string | null>(null);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('odds-theme') as ThemeMode | null) ?? 'dark');
  const [customBackground, setCustomBackground] = useState(() => localStorage.getItem('odds-custom-bg') ?? '#0b1220');
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((tone: ToastMessage['tone'], text: string) => {
    setToast({ id: Date.now(), tone, text });
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const apiMatches = await fetchMatches();
      if (apiMatches.length === 0) {
        console.warn('后端 API 暂无比赛数据，继续使用本地 mock data。');
        setApiMatchIds([]);
        setMatches(localizedMockMatches);
        setSelectedMatchId((currentId) =>
          localizedMockMatches.some((match) => match.id === currentId) ? currentId : localizedMockMatches[0].id,
        );
        setLiveMarket(null);
        setLiveRows(null);
        return;
      }

      const localizedMatches = apiMatches.map(localizeMatch);
      setApiMatchIds(localizedMatches.map((match) => match.id));
      setMatches(localizedMatches);
      setSelectedMatchId((currentId) =>
        localizedMatches.some((match) => match.id === currentId) ? currentId : localizedMatches[0].id,
      );
    } catch (error) {
      setApiMatchIds([]);
      console.warn('后端 API 请求失败，继续使用本地 mock data。', error);
    }
  }, []);

  useEffect(() => {
    void loadMatches();
    const timer = window.setInterval(() => {
      void loadMatches();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadMatches]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--custom-bg-rgb', hexToRgbParts(customBackground));
    localStorage.setItem('odds-theme', theme);
    localStorage.setItem('odds-custom-bg', customBackground);
  }, [customBackground, theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? localizedMockMatches[0],
    [matches, selectedMatchId],
  );
  const matchGroups = useMemo(() => groupMatchesBySchedule(matches), [matches]);

  useEffect(() => {
    let cancelled = false;
    setLiveMarket(null);
    setLiveRows(null);

    if (!apiMatchIds.includes(selectedMatchId)) {
      setMarketLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMarketLoading(true);

    fetchOdds(selectedMatchId, activeMarket)
      .then((response) => {
        if (cancelled) return;
        setLiveMarket(localizeMarket(response.series));
        setLiveRows(localizeOddsRows(response.rows));
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('盘口明细 API 请求失败，继续使用当前页面数据。', error);
        }
      })
      .finally(() => {
        if (!cancelled) setMarketLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeMarket, apiMatchIds, selectedMatchId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!apiMatchIds.includes(selectedMatchId)) return;

      fetchOdds(selectedMatchId, activeMarket)
        .then((response) => {
          setLiveMarket(localizeMarket(response.series));
          setLiveRows(localizeOddsRows(response.rows));
        })
        .catch((error) => {
          console.warn('盘口明细自动刷新失败，继续使用当前页面数据。', error);
        });
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [activeMarket, apiMatchIds, selectedMatchId]);

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

  async function handleViewRawData() {
    setRawModalOpen(true);
    setRawLoading(true);
    setLoadingAction('raw');
    try {
      const response = await fetchRawOdds(selectedMatch.id, activeMarket);
      setRawRows(response.rows);
      showToast('success', '原始数据已从后台读取。');
    } catch (error) {
      console.warn('原始数据读取失败。', error);
      setRawRows([]);
      showToast('error', '原始数据读取失败，请确认后台已启动且 SQLite 有当前比赛数据。');
    } finally {
      setRawLoading(false);
      setLoadingAction(null);
    }
  }

  async function handleAddMonitorMatch(payload: AddMonitorMatchPayload) {
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
    const match = matches.find((item) => item.id === matchId);
    if (!match) return;
    const confirmed = window.confirm(`确认隐藏并停止采集「${match.name}」吗？历史数据会保留。`);
    if (!confirmed) return;

    setHidingMatchId(matchId);
    try {
      const response = await hideMonitorMatch(matchId);
      showToast('success', response.message);
      const nextMatches = matches.filter((item) => item.id !== matchId);
      const displayMatches = nextMatches.length > 0 ? nextMatches : localizedMockMatches;
      setApiMatchIds((currentIds) => currentIds.filter((id) => id !== matchId));
      setMatches(displayMatches);
      if (selectedMatchId === matchId) {
        setSelectedMatchId(displayMatches[0].id);
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

  return (
    <main className="min-h-screen min-w-0 px-3 py-4 text-odds-text sm:px-5 lg:px-6 lg:py-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <Header
          updatedAt={selectedMatch.updatedAt}
          timezone="Asia/Singapore"
          exporting={loadingAction === 'csv'}
          onExportCsv={handleExportCsv}
          onOpenSettings={() => setThemePanelOpen(true)}
        />

        <section className="flex min-w-0 flex-col gap-5">
          {matchGroups.map((group) => (
            <MatchDateGroup
              key={group.key}
              group={group}
              selectedMatchId={selectedMatch.id}
              onSelect={(id) => void handleSelectMatch(id)}
              onHide={(id) => void handleHideMonitorMatch(id)}
              hidingMatchId={hidingMatchId}
            />
          ))}
        </section>

        <MatchOverview match={selectedMatch} />

        <section className="grid min-w-0 gap-4 lg:grid-cols-3">
          {selectedMatch.summaryCards.map((summary) => (
            <OddsSummaryCard key={summary.title} summary={summary} />
          ))}
        </section>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="surface p-4 sm:p-5">
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

            <OddsTrendChart market={market} />
            <OddsTable rows={tableRows} />
            <ActionBar
              loadingAction={loadingAction}
              onExportCsv={handleExportCsv}
              onExportChart={handleExportChart}
              onViewRawData={handleViewRawData}
              onAddMatch={() => setAddModalOpen(true)}
            />
          </div>

          <AlertPanel alerts={selectedMatch.alerts} />
        </section>
      </div>

      <ThemePanel
        open={themePanelOpen}
        theme={theme}
        customBackground={customBackground}
        onThemeChange={setTheme}
        onCustomBackgroundChange={setCustomBackground}
        onClose={() => setThemePanelOpen(false)}
      />
      <RawDataModal open={rawModalOpen} rows={rawRows} loading={rawLoading} onClose={() => setRawModalOpen(false)} />
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
