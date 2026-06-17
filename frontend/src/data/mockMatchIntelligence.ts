import type {
  GroupStandingResponse,
  LiveStatsResponse,
  MatchEventsResponse,
  MatchIdentity,
  MatchDiagnosticsResponse,
  MatchInjuriesResponse,
  MatchInsightsResponse,
  MatchIntelligence,
  MatchLineupsResponse,
  PlayerItem,
} from '../types/matchIntelligence';

function player(name: string, role?: string, note?: string): PlayerItem {
  return { name, role, note };
}

function teamNames(matchId: string, match?: MatchIdentity) {
  if (match) return { home: match.homeTeam, away: match.awayTeam };
  if (matchId === 'spain-cape-verde') return { home: '西班牙', away: '佛得角' };
  if (matchId === 'germany-ivory-coast') return { home: '德国', away: '科特迪瓦' };
  return { home: '比利时', away: '埃及' };
}

function lineups(matchId: string, home: string, away: string): MatchLineupsResponse {
  const homeMissing =
    matchId === 'spain-cape-verde'
      ? [player('主力中锋', '关键前锋', '未进入首发')]
      : [player('主力门将', '门将', '赛前伤疑')];

  return {
    matchId,
    dataSource: 'mock',
    explanation:
      matchId === 'spain-cape-verde'
        ? `${home}主力中锋未首发，破密集防守能力可能下降。`
        : `${home}首发已接近确认，但关键位置仍有缺席风险，盘口热度需要谨慎看待。`,
    lineups: [
      {
        matchId,
        teamName: home,
        collectedAt: '2026-06-20 20:55',
        formation: '4-3-3',
        lineupConfirmed: true,
        starters: [
          player('一号门将', 'GK'),
          player('右后卫', 'DF'),
          player('中卫A', 'DF'),
          player('中卫B', 'DF'),
          player('左后卫', 'DF'),
          player('防守中场', 'MF'),
          player('中场核心', 'MF'),
          player('前腰', 'MF'),
          player('右边锋', 'FW'),
          player('中锋', 'FW'),
          player('左边锋', 'FW'),
        ],
        substitutes: [player('替补前锋'), player('替补中场'), player('替补门将')],
        keyPlayersMissing: homeMissing,
      },
      {
        matchId,
        teamName: away,
        collectedAt: '2026-06-20 20:55',
        formation: '5-4-1',
        lineupConfirmed: true,
        starters: [
          player('门将', 'GK'),
          player('右翼卫', 'DF'),
          player('中卫1', 'DF'),
          player('中卫2', 'DF'),
          player('中卫3', 'DF'),
          player('左翼卫', 'DF'),
          player('后腰', 'MF'),
          player('中场A', 'MF'),
          player('中场B', 'MF'),
          player('反击边锋', 'FW'),
          player('单箭头', 'FW'),
        ],
        substitutes: [player('替补边锋'), player('替补后腰'), player('替补中卫')],
        keyPlayersMissing: [],
      },
    ],
  };
}

function injuries(matchId: string, home: string, away: string): MatchInjuriesResponse {
  const injuriesList = [
    {
      matchId,
      teamName: home,
      playerName: '主力门将',
      status: '伤疑',
      reason: '肌肉不适',
      expectedReturn: '赛前评估',
    },
    {
      matchId,
      teamName: away,
      playerName: '轮换中场',
      status: '缺阵',
      reason: '停赛',
      expectedReturn: '下一场',
    },
  ];

  return {
    matchId,
    injuries: injuriesList,
    summary: {
      total: injuriesList.length,
      byTeam: {
        [home]: 1,
        [away]: 1,
      },
    },
    explanation: `${home}关键位置存在赛前评估风险，${away}有一名轮换中场停赛。`,
    dataSource: 'mock',
  };
}

function groupStanding(matchId: string, home: string, away: string): GroupStandingResponse {
  return {
    matchId,
    dataSource: 'mock',
    explanation: `${home}当前仍有争取净胜球动力，${away}更倾向稳守拿分。`,
    teams: [
      {
        groupName: 'G组',
        teamName: home,
        rank: 2,
        points: 3,
        played: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        goalsFor: 3,
        goalsAgainst: 2,
        goalDifference: 1,
        motivationLevel: 'high',
        motivationText: '后续赛程更难，本场存在抢分和争取净胜球动力。',
      },
      {
        groupName: 'G组',
        teamName: away,
        rank: 3,
        points: 1,
        played: 2,
        wins: 0,
        draws: 1,
        losses: 1,
        goalsFor: 1,
        goalsAgainst: 3,
        goalDifference: -2,
        motivationLevel: 'medium',
        motivationText: '需要避免大比分失利，防守稳定性比主动压上更重要。',
      },
    ],
  };
}

function liveStats(matchId: string, home: string, away: string): LiveStatsResponse {
  const timeline = [
    {
      matchId,
      collectedAt: '2026-06-20 22:20',
      minute: 20,
      teamName: home,
      possession: 63,
      shots: 4,
      shotsOnTarget: 1,
      corners: 3,
      dangerousAttacks: 18,
      xg: 0.34,
      yellowCards: 0,
      redCards: 0,
    },
    {
      matchId,
      collectedAt: '2026-06-20 22:20',
      minute: 20,
      teamName: away,
      possession: 37,
      shots: 2,
      shotsOnTarget: 1,
      corners: 1,
      dangerousAttacks: 8,
      xg: 0.21,
      yellowCards: 1,
      redCards: 0,
    },
    {
      matchId,
      collectedAt: '2026-06-20 22:38',
      minute: 38,
      teamName: home,
      possession: 66,
      shots: 7,
      shotsOnTarget: 2,
      corners: 5,
      dangerousAttacks: 31,
      xg: 0.62,
      yellowCards: 0,
      redCards: 0,
    },
    {
      matchId,
      collectedAt: '2026-06-20 22:38',
      minute: 38,
      teamName: away,
      possession: 34,
      shots: 3,
      shotsOnTarget: 1,
      corners: 1,
      dangerousAttacks: 12,
      xg: 0.28,
      yellowCards: 2,
      redCards: 0,
    },
  ];

  return {
    matchId,
    timeline,
    latest: timeline.slice(-2),
    explanation: `${home}控球率高，但射正和 xG 没有同步拉开，当前压制质量一般。`,
    dataSource: 'mock',
  };
}

function events(matchId: string, home: string, away: string): MatchEventsResponse {
  return {
    matchId,
    dataSource: 'mock',
    explanation: '事件时间线用于和盘口异动对照，当前为 mock 事件。',
    events: [
      {
        id: 'lineup',
        matchId,
        eventTime: '2026-06-20 20:55',
        minute: null,
        teamName: home,
        eventType: 'lineup_confirmed',
        description: `${home}首发公布，阵型为 4-3-3。`,
      },
      {
        id: 'yellow-away',
        matchId,
        eventTime: '2026-06-20 22:18',
        minute: 18,
        teamName: away,
        eventType: 'yellow_card',
        playerName: '后腰',
        description: `${away}后腰吃到黄牌，防守动作受限。`,
      },
      {
        id: 'var-home',
        matchId,
        eventTime: '2026-06-20 22:34',
        minute: 34,
        teamName: home,
        eventType: 'var',
        description: `${home}禁区内倒地，VAR 检查后未判点球。`,
      },
    ],
  };
}

function insights(matchId: string, home: string, away: string): MatchInsightsResponse {
  return {
    matchId,
    generatedAt: '2026-06-20 22:40',
    dataSource: 'mock',
    items: [
      {
        id: 'market',
        category: 'market',
        title: '盘口方向',
        message: `市场越来越看好${home}，主胜和让球方向都有降赔。`,
        severity: 'success',
      },
      {
        id: 'lineup',
        category: 'lineup',
        title: '首发影响',
        message: `${home}关键位置存在缺席风险，盘口热度需要谨慎看待。`,
        severity: 'warning',
      },
      {
        id: 'motivation',
        category: 'motivation',
        title: '小组动力',
        message: `${home}后续赛程更难，本场存在抢分和争取净胜球动力。`,
        severity: 'warning',
      },
      {
        id: 'live',
        category: 'live_stats',
        title: '赛中真实压制',
        message: `${home}控球率高，但射正偏少，实际压制不足。`,
        severity: 'warning',
      },
      {
        id: 'away',
        category: 'live_stats',
        title: '弱队防守',
        message: `${away}虽然赔率走高，但防守数据仍保持稳定。`,
        severity: 'info',
      },
      {
        id: 'correlation',
        category: 'correlation',
        title: '盘口与事件一致性',
        message: `${home}胜赔下降，但赛中威胁数据没有同步增强，盘口热度和比赛实际走势存在偏差。`,
        severity: 'warning',
      },
    ],
    correlations: [
      {
        id: 'mock-lineup-correlation',
        matchId,
        eventId: 'lineup',
        linkType: 'lineup_related',
        explanation: `${home}首发公布后胜赔继续下降，盘口变化可能与首发利好有关。`,
        confidence: 0.62,
      },
      {
        id: 'mock-market-gap',
        matchId,
        linkType: 'market_only',
        explanation: `${home}赔率下降幅度大于技术统计提升幅度，盘口热度和比赛实际走势存在偏差。`,
        confidence: 0.54,
      },
    ],
  };
}

function diagnostics(matchId: string, mode: 'dev_seed' | 'empty' | 'error' = 'dev_seed', errorMessage?: string): MatchDiagnosticsResponse {
  const now = mode === 'dev_seed' ? '2026-06-20 22:40' : new Date().toISOString();
  const sourceNames = [
    { name: 'odds', label: '盘口快照' },
    { name: 'lineups', label: '首发名单' },
    { name: 'events', label: '比赛事件' },
    { name: 'stats', label: '技术统计' },
    { name: 'injuries', label: '伤停信息' },
    { name: 'standings', label: '小组积分' },
  ];

  return {
    matchId,
    externalMatchId: mode === 'dev_seed' ? `dev-seed-${matchId}` : null,
    sourceMap: mode === 'dev_seed' ? { provider: 'dev_seed', externalMatchId: `dev-seed-${matchId}` } : {},
    sources: sourceNames.map((source, index) => ({
      name: source.name,
      configured: mode === 'dev_seed',
      lastFetchedAt: mode === 'dev_seed' ? now : null,
      lastIngestedAt: mode === 'dev_seed' ? now : null,
      lastQueriedAt: now,
      rowCount: mode === 'dev_seed' ? Math.max(1, index + 1) : 0,
      matchId,
      externalMatchId: mode === 'dev_seed' ? `dev-seed-${matchId}` : null,
      error: mode === 'error' ? errorMessage ?? 'API 请求失败' : null,
      status: mode === 'dev_seed' ? 'dev_seed' : mode === 'error' ? 'fetch_failed' : 'no_rows',
      statusLabel: mode === 'dev_seed' ? `${source.label}使用开发种子数据` : mode === 'error' ? `${source.label}请求失败` : `${source.label}暂无入库数据`,
      reason:
        mode === 'dev_seed'
          ? '仅开发环境显式启用 VITE_ENABLE_MOCK_FALLBACK=true 时展示。'
          : mode === 'error'
            ? errorMessage ?? '后端 API 请求失败，页面不使用 mock 冒充真实数据。'
            : '数据库当前没有该模块记录，或尚未建立内部 match_id 与外部赛事 ID 映射。',
      suggestedAction:
        mode === 'dev_seed'
          ? '接入真实数据源后，将该模块写入对应 SQLite 表。'
          : mode === 'error'
            ? '检查后端服务、网络代理和 DataDiagnostics 中的失败信息。'
            : '先补充 match_source_map，再实现对应采集器或导入脚本。',
    })),
    summary: {
      normal: mode === 'dev_seed' ? sourceNames.length : 0,
      needsAttention: mode === 'dev_seed' ? 0 : sourceNames.length,
    },
    updatedAt: now,
  };
}

export function getEmptyMatchIntelligence(matchId: string): MatchIntelligence {
  return {
    lineups: {
      matchId,
      lineups: [],
      explanation: '暂无首发名单数据，等待阵容数据源接入。',
      dataSource: 'empty',
    },
    injuries: {
      matchId,
      injuries: [],
      summary: { total: 0, byTeam: {} },
      explanation: '伤停数据缺失，当前无法评估伤病影响。',
      dataSource: 'empty',
    },
    groupStanding: {
      matchId,
      teams: [],
      explanation: '暂无小组积分数据，出线压力和净胜球动力等待数据源补充。',
      dataSource: 'empty',
    },
    liveStats: {
      matchId,
      timeline: [],
      latest: [],
      explanation: '技术统计数据缺失，当前无法评估真实压制质量。',
      dataSource: 'empty',
    },
    events: {
      matchId,
      events: [],
      explanation: '暂无比赛事件，等待事件数据源接入。',
      dataSource: 'empty',
    },
    insights: {
      matchId,
      generatedAt: '',
      items: [],
      correlations: [],
      dataSource: 'empty',
    },
    diagnostics: diagnostics(matchId, 'empty'),
  };
}

export function getErrorMatchIntelligence(matchId: string, errorMessage: string): MatchIntelligence {
  const empty = getEmptyMatchIntelligence(matchId);
  return {
    ...empty,
    diagnostics: diagnostics(matchId, 'error', errorMessage),
  };
}

export function getMockMatchIntelligence(matchId: string, match?: MatchIdentity): MatchIntelligence {
  const { home, away } = teamNames(matchId, match);
  return {
    lineups: lineups(matchId, home, away),
    injuries: injuries(matchId, home, away),
    groupStanding: groupStanding(matchId, home, away),
    liveStats: liveStats(matchId, home, away),
    events: events(matchId, home, away),
    insights: insights(matchId, home, away),
    diagnostics: diagnostics(matchId, 'dev_seed'),
  };
}
