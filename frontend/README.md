# Odds Watcher 前端原型

这是“世界杯盘口监控看板”的高保真网页原型，使用 React + TypeScript + Tailwind CSS 实现。页面会优先请求本地 FastAPI 后台，后台不可用或 SQLite 暂无数据时回退到本地 mock。

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

## 组件结构

- `Header`：顶部导航、更新时间、时区、导出和设置按钮
- `MatchCard`：比赛选择卡片
- `MatchOverview`：单场比赛标题、时间、数据来源、状态和市场总结
- `OddsSummaryCard`：胜平负、亚洲让球、大小球方向摘要
- `MarketTabs`：盘口类型切换
- `OddsTrendChart`：Recharts 折线图和 tooltip
- `OddsTable`：盘口变化表格，响应式切换为移动端卡片
- `AlertPanel`：右侧异动提醒面板
- `ActionBar`：底部操作按钮
- `ThemePanel`：黑色、白色、自定义背景主题切换
- `RawDataModal`：展示后台原始采集快照
- `AddMatchModal`：提交新增监控比赛到后台配置
- `Toast`：按钮操作的成功、失败和状态反馈

## 后台联动

前端默认请求 `http://127.0.0.1:8013`，可通过 `VITE_API_BASE_URL` 覆盖。已接入的按钮和接口包括：

- 比赛卡片：`GET /api/matches/{matchId}`
- 盘口 Tab：`GET /api/matches/{matchId}/odds?market=...`
- 导出 CSV：`GET /api/matches/{matchId}/export.csv?market=...`
- 导出图表：`GET /api/matches/{matchId}/chart.png?market=...`
- 查看原始数据：`GET /api/matches/{matchId}/raw?market=...`
- 添加监控比赛：`POST /api/config/matches`

## Mock Data

`src/data/mockOdds.ts` 模拟 18:00 到 21:00，每 10 分钟一条盘口快照，包含：

- 胜平负：主胜、平局、客胜
- 亚洲让球：主队 -1、客队 +1
- 大小球：大球 2.5、小球 2.5
- 双方进球：是、否

## 后续接入真实采集接口建议

1. 保持 `MatchData`、`MarketData`、`OddsTableRow` 等类型作为前端消费契约。
2. 后端继续提供按比赛、盘口类型、时间范围查询的接口，避免前端一次加载全部历史数据。
3. 实时刷新可以先使用定时轮询，每 10 分钟请求一次最新快照；后续如需实时性再改为 WebSocket 或 SSE。
