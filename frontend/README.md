# Odds Watcher 前端原型

这是“世界杯盘口监控看板”的前端应用，使用 React + TypeScript + Tailwind CSS 实现。页面默认请求相对路径 `/api`，由 Vite proxy 或部署网关转发到 FastAPI 后端。

生产模式下不会在 API 失败时自动回退到 mock。只有本地开发显式设置 `VITE_ENABLE_MOCK_FALLBACK=true` 时，页面才会使用开发种子数据保持结构可见。

## 安装与运行

```powershell
cd frontend
npm install
npm run dev
```

构建：

```powershell
npm run build
```

如需特殊跨域部署，可参考 `.env.example`：

```env
VITE_API_BASE_URL=
ODDS_API_PROXY_TARGET=http://127.0.0.1:8013
VITE_ENABLE_MOCK_FALLBACK=false
```

## 组件结构

- `Header`：顶部导航、更新时间、时区和设置入口
- `MatchCard`：比赛选择卡片，支持隐藏看板、暂停采集和恢复采集
- `MatchOverview`：单场比赛标题、时间、状态、市场总结和数据完整度
- `OddsSummaryCard`：胜平负、亚洲让球、大小球方向摘要
- `MarketTabs`：盘口类型切换
- `OddsTrendChart`：Recharts 折线图和 tooltip
- `OddsTable`：盘口变化表格，响应式切换为移动端卡片
- `AlertPanel`：盘口异动提醒面板，展示风险等级、市场权重和置信度
- `DataStatusPanel`：首发、伤停、技术统计等模块的数据状态
- `DataDiagnosticsPanel`：内部 match_id、外部赛事映射、行数和失败原因诊断
- `ActionBar`：导出、原始数据和添加监控比赛操作
- `ThemePanel`：黑色、白色、自定义背景主题切换
- `RawDataModal`：展示后台原始采集快照
- `AddMatchModal`：提交新增监控比赛到后台配置
- `Toast`：按钮操作的成功、失败和状态反馈

## 后台联动

前端默认请求 `/api`。开发环境的 `vite.config.ts` 默认代理到 `http://127.0.0.1:8013`，如需指向其他本地后端端口，可设置 `ODDS_API_PROXY_TARGET`。已接入的接口包括：

- 比赛列表：`GET /api/matches`
- 比赛详情：`GET /api/matches/{matchId}`
- 盘口 Tab：`GET /api/matches/{matchId}/odds?market=...&limit=300`
- 导出 CSV：`GET /api/matches/{matchId}/export.csv?market=...`
- 导出图表：`GET /api/matches/{matchId}/chart.png?market=...`
- 查看原始数据：`GET /api/matches/{matchId}/raw?market=...`
- 赛前情报：`GET /api/matches/{matchId}/lineups`
- 伤停信息：`GET /api/matches/{matchId}/injuries`
- 小组积分：`GET /api/matches/{matchId}/standings`
- 技术统计：`GET /api/matches/{matchId}/stats`
- 比赛事件：`GET /api/matches/{matchId}/events`
- 综合洞察：`GET /api/matches/{matchId}/insights`
- 数据诊断：`GET /api/matches/{matchId}/data-diagnostics`
- 添加监控比赛：`POST /api/config/matches`
- 隐藏看板比赛：`DELETE /api/config/matches/{matchId}`
- 暂停采集：`POST /api/config/matches/{matchId}/pause`
- 恢复采集：`DELETE /api/config/matches/{matchId}/pause`

## 开发种子数据

`src/data/mockOdds.ts` 和 `src/data/mockMatchIntelligence.ts` 只用于本地开发兜底。启用方式：

```env
VITE_ENABLE_MOCK_FALLBACK=true
```

启用后，数据状态会标记为 `dev_seed`，避免和真实采集数据混淆。生产环境应保持该开关为 `false`。

## 后续接入建议

1. 保持 `MatchData`、`MarketData`、`OddsTableRow`、`MatchIntelligence` 等类型作为前端消费契约。
2. 后端继续按比赛、盘口类型和 limit 查询历史盘口，避免前端一次加载全量历史数据。
3. 新数据源接入后先补齐 `data-diagnostics` 状态，再逐步替换开发种子数据。
