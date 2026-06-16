# sgodds 盘口赔率采集与联调工具

这是一个本地项目，用于采集 sgodds 指定比赛页面的盘口赔率，写入 SQLite，并通过 FastAPI 提供给前端看板展示。

## 项目结构

- `sgodds_collector.py`：独立采集程序，负责自动发现明日比赛、采集 sgodds 页面并写入 SQLite。
- `backend/api.py`：轻量 FastAPI 服务，只读取 SQLite 并输出前端需要的 JSON。
- `frontend/`：React + Vite + TypeScript + Tailwind + Recharts 前端页面。
- `data/sgodds_odds.sqlite3`：默认 SQLite 数据库位置。
- `scripts/dev.py`：Windows 本地开发一键启动脚本。
- `config.json`：手动采集配置，包含数据库路径、输出目录和用户新增比赛 URL。

## 安装 Python 依赖

```powershell
python -m pip install -r requirements.txt
```

## 安装前端依赖

```powershell
cd frontend
npm install
```

## 启动后端 API

```powershell
python -m uvicorn backend.api:app --reload --host 127.0.0.1 --port 8013
```

健康检查：

```powershell
curl http://127.0.0.1:8013/api/health
```

主要 API：

- `GET /api/health`
- `GET /api/matches`
- `GET /api/matches/{matchId}`
- `GET /api/matches/{matchId}/markets`
- `GET /api/matches/{matchId}/odds?market=1X2`
- `GET /api/matches/{matchId}/summary`
- `GET /api/matches/{matchId}/alerts`
- `GET /api/matches/{matchId}/raw?market=1x2`
- `GET /api/matches/{matchId}/export.csv?market=1x2`
- `GET /api/matches/{matchId}/chart.png?market=1x2`
- `GET /api/discovery/matches?days=7`
- `POST /api/config/matches`
- `DELETE /api/config/matches/{matchId}`

后端默认读取 `config.json` 中的 `database` 字段；也可以用环境变量覆盖：

`config.json` 里的 `output_dir` 和 `database` 如果是相对路径，采集器和后端都会按 `config.json` 所在目录解析，避免从其他工作目录启动时写入不同的数据目录。

```powershell
$env:ODDS_DB_PATH="data/sgodds_odds.sqlite3"
python -m uvicorn backend.api:app --reload --host 127.0.0.1 --port 8013
```

## 启动前端

前端默认请求 `http://127.0.0.1:8013`。如需调整，复制或参考 `frontend/.env.example`：

```powershell
VITE_API_BASE_URL=http://127.0.0.1:8013
```

启动：

```powershell
cd frontend
npm run dev
```

如果 API 请求失败或 SQLite 暂无数据，前端会自动回退到 `frontend/src/data/mockOdds.ts`。页面会每 60 秒自动刷新比赛列表和当前盘口明细。

前端按钮联调说明：

- 顶部“导出”和底部“导出 CSV”会请求 `export.csv` 并下载后台返回的 CSV。
- “导出图表”会请求 `chart.png` 并下载后台生成的赔率折线图。
- “查看原始数据”会请求 `raw` 并在页面弹窗展示 SQLite 快照行。
- “添加监控比赛”默认请求 `GET /api/discovery/matches?days=7` 查询未来 7 天候选比赛，用户可按日期下拉选择比赛；提交后会请求 `POST /api/config/matches`，将比赛名称、URL、比赛时间、联赛和场次编号追加到 `config.json`，采集程序会在下一轮和自动发现的比赛一起采集。
- “隐藏并停采”会请求 `DELETE /api/config/matches/{matchId}`，把比赛 URL 写入 `config.json` 的 `hidden_matches`，前端列表和后续采集都会过滤该比赛；SQLite、原始 HTML 和历史日志不会删除。
- “设置”会打开前端主题设置面板，支持黑色、白色和自定义背景主题。

## 一键启动前后端和采集程序

默认启动 FastAPI 后端、Vite 前端和采集程序。采集程序会每 10 分钟执行一轮采集：

```powershell
python scripts/dev.py
```

如需只启动后端和前端，不启动采集程序：

```powershell
python scripts/dev.py --without-collector
```

`--with-collector` 参数仍可使用，用于兼容旧命令。按 `Ctrl+C` 会同时关闭已启动的前端、后端和采集进程。

采集程序每轮会先请求 `https://sgodds.com/football/current-odds`，按 `Asia/Singapore` 日期自动发现“明天”的全部比赛，并与 `config.json` 中手动添加的比赛去重合并后采集。

## 单独启动采集程序

立即采集一次：

```powershell
python sgodds_collector.py collect-once
```

每 10 分钟循环采集：

```powershell
python sgodds_collector.py run
```

自动发现结果会追加记录到 `data/auto_matches.json`，不会覆盖 `config.json` 中的手动比赛。比赛中文名、主客队中文名、比赛时间、联赛、来源类型等元数据会写入 SQLite 的 `match_metadata` 表；赔率快照继续追加写入 `odds_snapshots` 表。

## 后台日志

后台日志会同时打印到控制台并追加写入本地文件：

- 后端 API 请求日志：`data/logs/backend.log`
- 采集程序日志：`data/logs/collector.log`

API 请求日志记录客户端地址、请求 host/port、method、path、HTTP 状态码和耗时，不记录 query 参数。采集日志记录每轮采集开始、比赛 URL、原始 HTML 保存路径、写入 SQLite 的行数、告警和异常。

导出 CSV：

```powershell
python sgodds_collector.py export-csv
python sgodds_collector.py export-csv --match "Iran vs New Zealand"
```

生成赔率折线图：

```powershell
python sgodds_collector.py plot --match "Iran vs New Zealand"
python sgodds_collector.py plot --match "Iran vs New Zealand" --market "01 | 1X2" --option "Iran"
```

## 确认联调成功

1. 启动后端，访问 `http://127.0.0.1:8013/api/health`，确认 `status` 为 `ok`。
2. 访问 `http://127.0.0.1:8013/api/matches`，确认返回 SQLite 中的比赛数据。
3. 启动前端，打开 Vite 输出的本地地址。
4. 在页面切换比赛卡片和盘口 Tab，确认图表、表格、摘要卡片和异动提醒正常展示。
5. 停掉后端刷新前端，确认页面不会白屏，并回退到本地 mock data。

## 本地数据

- SQLite：`data/sgodds_odds.sqlite3`
- 原始 HTML：`data/raw_html/`
- 自动发现比赛状态：`data/auto_matches.json`
- 隐藏并停采配置：`config.json` 的 `hidden_matches`
- CSV 导出：`data/exports/`
- 折线图：`data/plots/`
- 日志文件：`data/logs/`

SQLite 表 `odds_snapshots` 保存采集时间、页面更新时间、比赛 URL、比赛名、盘口类型、选项、开盘赔率、当前赔率、变化百分比和原始 HTML 路径；`match_metadata` 保存比赛中英文名称、主客队中英文名称、比赛时间、联赛、来源类型等元数据。采集数据、自动发现记录和原始 HTML 会追加保存在本地，程序不会自动删除历史数据。
