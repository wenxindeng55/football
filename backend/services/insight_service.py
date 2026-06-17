from __future__ import annotations

from datetime import datetime
from typing import Any


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any, default: float = 0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _player_name(value: Any) -> str:
    if isinstance(value, dict):
        return _text(value.get("name") or value.get("playerName") or value.get("player_name"))
    return _text(value)


def _normalize_status(value: Any) -> str:
    return _text(value).lower().replace(" ", "_")


def _is_confirmed_lineup(lineups: list[dict[str, Any]]) -> bool:
    return any(bool(lineup.get("lineupConfirmed")) for lineup in lineups)


def _team_names(meta: dict[str, Any]) -> tuple[str, str]:
    return _text(meta.get("homeTeam")), _text(meta.get("awayTeam"))


def _find_team_lineup(lineups: list[dict[str, Any]], team_name: str) -> dict[str, Any] | None:
    for lineup in lineups:
        if _text(lineup.get("teamName")) == team_name:
            return lineup
    return None


def _market_direction(odds_rows: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, Any]:
    home, away = _team_names(meta)
    if not odds_rows:
        return {
            "team": "",
            "message": "暂无盘口快照，市场方向需要等待采集数据。",
            "severity": "info",
        }

    sorted_rows = sorted(odds_rows, key=lambda row: abs(_number(row.get("changePercent"))), reverse=True)
    best = sorted_rows[0]
    option = _text(best.get("optionName"))
    change = _number(best.get("changePercent"))
    display_option = option or home or away or "当前方向"
    if change < 0:
        return {
            "team": display_option,
            "message": f"市场越来越看好{display_option}，最新赔率变化为 {change:+.1f}%。",
            "severity": "success",
        }
    if change > 0:
        return {
            "team": display_option,
            "message": f"{display_option}赔率走高，市场热度正在回落，最新变化为 {change:+.1f}%。",
            "severity": "warning",
        }
    return {
        "team": display_option,
        "message": f"{display_option}赔率暂时稳定，盘口方向还不明显。",
        "severity": "info",
    }


def _lineup_message(
    lineups: list[dict[str, Any]],
    market_team: str,
    meta: dict[str, Any],
) -> tuple[str, str]:
    if not lineups:
        return "暂无首发名单数据，等待阵容数据源接入后再校验盘口热度。", "info"

    strong_team = market_team or _team_names(meta)[0]
    lineup = _find_team_lineup(lineups, strong_team) or lineups[0]
    missing_players = [_player_name(item) for item in lineup.get("keyPlayersMissing", [])]
    missing_players = [name for name in missing_players if name]
    if missing_players:
        return (
            f"{_text(lineup.get('teamName'))}存在关键球员缺席：{', '.join(missing_players)}，盘口热度需要谨慎看待。",
            "warning",
        )
    if _is_confirmed_lineup(lineups):
        return "双方首发已有确认信息，当前阵型和关键缺席情况未显示明显负面信号。", "success"
    return "首发名单尚未完全确认，赛前盘口变化需要等待阵容信息校验。", "info"


def _injury_message(injuries: list[dict[str, Any]]) -> tuple[str, str]:
    if not injuries:
        return "暂无伤停数据，暂不把伤病因素作为主要判断依据。", "info"

    hard_statuses = {"out", "suspended", "missing", "缺阵", "停赛", "伤缺"}
    hard_injuries = [
        item
        for item in injuries
        if _normalize_status(item.get("status")) in hard_statuses or _text(item.get("status")) in hard_statuses
    ]
    if hard_injuries:
        teams: dict[str, int] = {}
        for item in hard_injuries:
            team = _text(item.get("teamName")) or "未知球队"
            teams[team] = teams.get(team, 0) + 1
        parts = [f"{team}{count}人" for team, count in teams.items()]
        return f"伤停名单中存在明确缺阵或停赛：{'，'.join(parts)}，需要结合首发确认。", "warning"
    return "伤停名单暂未显示明确缺阵，阵容风险处于可观察状态。", "info"


def _standing_message(standings: list[dict[str, Any]]) -> tuple[str, str]:
    if not standings:
        return "暂无小组积分数据，出线压力和净胜球动力等待数据源补充。", "info"

    high_rows = [
        row
        for row in standings
        if _normalize_status(row.get("motivationLevel")) in {"high", "strong", "must_win", "高", "强"}
        or "净胜球" in _text(row.get("motivationText"))
        or "抢分" in _text(row.get("motivationText"))
    ]
    if high_rows:
        team = _text(high_rows[0].get("teamName")) or "该队"
        text = _text(high_rows[0].get("motivationText")) or "存在抢分和争取净胜球动力。"
        return f"{team}{text}", "warning"
    leader = max(standings, key=lambda row: (_number(row.get("points")), _number(row.get("goalDifference"))))
    return f"{_text(leader.get('teamName'))}当前积分形势相对更好，小组动力暂未显示极端压力。", "info"


def _live_stats_message(
    latest_stats: list[dict[str, Any]],
    market_team: str,
    meta: dict[str, Any],
) -> tuple[str, str]:
    if len(latest_stats) < 2:
        return "暂无完整赛中技术统计，暂不能判断真实压制质量。", "info"

    strong_team = market_team or _team_names(meta)[0]
    strong = next((row for row in latest_stats if _text(row.get("teamName")) == strong_team), latest_stats[0])
    others = [row for row in latest_stats if row is not strong]
    opponent = others[0] if others else latest_stats[1]

    possession = _number(strong.get("possession"))
    shots = _number(strong.get("shots"))
    shots_on_target = _number(strong.get("shotsOnTarget"))
    corners = _number(strong.get("corners"))
    dangerous_attacks = _number(strong.get("dangerousAttacks"))
    xg = _number(strong.get("xg"))

    if possession >= 58 and shots_on_target <= 2 and xg < 0.8:
        return f"{_text(strong.get('teamName'))}控球率高，但射正和 xG 偏低，可能是无效控球。", "warning"

    if (
        shots >= _number(opponent.get("shots")) + 4
        and shots_on_target >= _number(opponent.get("shotsOnTarget")) + 2
        and corners >= _number(opponent.get("corners")) + 2
        and dangerous_attacks >= _number(opponent.get("dangerousAttacks")) + 12
    ):
        return f"{_text(strong.get('teamName'))}射门、射正、角球和危险进攻明显领先，持续压制下进球风险上升。", "danger"

    return "赛中技术统计未形成单边压制，盘口变化需要继续结合事件时间线。", "info"


def _correlations(
    explicit_links: list[dict[str, Any]],
    events: list[dict[str, Any]],
    odds_rows: list[dict[str, Any]],
    lineups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if explicit_links:
        return explicit_links

    inferred: list[dict[str, Any]] = []
    biggest_change = max((_number(row.get("changePercent")) for row in odds_rows), key=abs, default=0)
    has_lineup_event = any(_text(event.get("eventType")) == "lineup_confirmed" for event in events) or _is_confirmed_lineup(lineups)
    if has_lineup_event and biggest_change <= -5:
        inferred.append(
            {
                "id": "inferred-lineup-market",
                "linkType": "lineup_related",
                "explanation": "首发信息出现后盘口同步降赔，盘口变化可能与首发利好有关。",
                "confidence": 0.58,
            }
        )

    red_card_events = [event for event in events if _text(event.get("eventType")) == "red_card"]
    if red_card_events and abs(biggest_change) >= 8:
        inferred.append(
            {
                "id": "inferred-red-card-market",
                "eventId": red_card_events[0].get("id"),
                "event": {
                    "eventType": red_card_events[0].get("eventType"),
                    "minute": red_card_events[0].get("minute"),
                    "teamName": red_card_events[0].get("teamName"),
                    "description": red_card_events[0].get("description"),
                },
                "linkType": "red_card_related",
                "explanation": "红牌事件附近盘口变化较大，盘口变化可能由红牌事件触发。",
                "confidence": 0.66,
            }
        )

    goal_events = [event for event in events if _text(event.get("eventType")) == "goal"]
    if goal_events and not inferred:
        event = goal_events[0]
        inferred.append(
            {
                "id": "inferred-goal-event",
                "eventId": event.get("id"),
                "event": {
                    "eventType": event.get("eventType"),
                    "minute": event.get("minute"),
                    "teamName": event.get("teamName"),
                    "description": event.get("description"),
                },
                "linkType": "goal_related" if odds_rows else "unknown",
                "explanation": (
                    "已记录进球事件，可继续观察进球后盘口方向是否同步变化。"
                    if odds_rows
                    else "已记录进球事件，但当前没有可对照的盘口快照，联动强度暂不能确认。"
                ),
                "confidence": 0.5 if odds_rows else 0.25,
            }
        )

    if events and not inferred:
        event = events[0]
        inferred.append(
            {
                "id": "inferred-event-only",
                "eventId": event.get("id"),
                "event": {
                    "eventType": event.get("eventType"),
                    "minute": event.get("minute"),
                    "teamName": event.get("teamName"),
                    "description": event.get("description"),
                },
                "linkType": "unknown",
                "explanation": "已有比赛事件入库，但暂未找到足够明显的盘口同步变化。",
                "confidence": 0.28,
            }
        )

    if not inferred and odds_rows:
        inferred.append(
            {
                "id": "inferred-market-only",
                "linkType": "market_only",
                "explanation": "当前盘口有变化，但暂未找到明确比赛事件触发点，可能是市场资金行为。",
                "confidence": 0.42,
            }
        )
    return inferred


def build_match_insights(
    *,
    match_id: str,
    meta: dict[str, Any],
    odds_rows: list[dict[str, Any]],
    lineups: list[dict[str, Any]],
    injuries: list[dict[str, Any]],
    standings: list[dict[str, Any]],
    latest_stats: list[dict[str, Any]],
    events: list[dict[str, Any]],
    explicit_links: list[dict[str, Any]],
) -> dict[str, Any]:
    market = _market_direction(odds_rows, meta)
    lineup_message, lineup_severity = _lineup_message(lineups, _text(market.get("team")), meta)
    injury_message, injury_severity = _injury_message(injuries)
    standing_message, standing_severity = _standing_message(standings)
    live_message, live_severity = _live_stats_message(latest_stats, _text(market.get("team")), meta)
    correlations = _correlations(explicit_links, events, odds_rows, lineups)
    consistency = (
        correlations[0]["explanation"]
        if correlations
        else "盘口变化和比赛事件之间暂无可用关联，需要等待事件或盘口快照补充。"
    )

    return {
        "matchId": match_id,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "dataSource": "rules-engine",
        "items": [
            {
                "id": "market-direction",
                "category": "market",
                "title": "盘口方向",
                "message": market["message"],
                "severity": market["severity"],
            },
            {
                "id": "lineup-impact",
                "category": "lineup",
                "title": "首发影响",
                "message": lineup_message,
                "severity": lineup_severity,
            },
            {
                "id": "injury-impact",
                "category": "injury",
                "title": "伤停影响",
                "message": injury_message,
                "severity": injury_severity,
            },
            {
                "id": "group-motivation",
                "category": "motivation",
                "title": "小组动力",
                "message": standing_message,
                "severity": standing_severity,
            },
            {
                "id": "live-pressure",
                "category": "live_stats",
                "title": "赛中真实压制",
                "message": live_message,
                "severity": live_severity,
            },
            {
                "id": "event-market-consistency",
                "category": "correlation",
                "title": "盘口与事件一致性",
                "message": consistency,
                "severity": "info",
            },
        ],
        "correlations": correlations,
    }
