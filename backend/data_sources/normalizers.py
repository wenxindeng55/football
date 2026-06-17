from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from backend.data_sources.types import (
    NormalizedBundle,
    NormalizedLineup,
    NormalizedLineupPlayer,
    NormalizedMatchEvent,
    NormalizedMatchStats,
    SourceFetchResult,
    SourceMatchMapping,
)


EVENT_TYPE_MAP = {
    "goal": "goal",
    "normal goal": "goal",
    "yellow card": "yellow_card",
    "red card": "red_card",
    "substitution": "substitution",
    "injury": "injury",
    "var": "var",
    "penalty": "penalty",
}

STAT_FIELD_MAP = {
    "ball possession": ("possession", "float"),
    "possession": ("possession", "float"),
    "shots on goal": ("shots_on_target", "int"),
    "shots on target": ("shots_on_target", "int"),
    "shots off goal": ("shots_off_target", "int"),
    "shots off target": ("shots_off_target", "int"),
    "total shots": ("shots", "int"),
    "blocked shots": ("blocked_shots", "int"),
    "corner kicks": ("corners", "int"),
    "corners": ("corners", "int"),
    "fouls": ("fouls", "int"),
    "offsides": ("offsides", "int"),
    "yellow cards": ("yellow_cards", "int"),
    "red cards": ("red_cards", "int"),
    "total passes": ("total_passes", "int"),
    "passes accurate": ("accurate_passes", "int"),
    "passes %": ("pass_accuracy", "float"),
    "pass accuracy": ("pass_accuracy", "float"),
    "expected goals": ("xg", "float"),
    "xg": ("xg", "float"),
}


def normalize_thesportsdb_bundle(
    results: Mapping[str, SourceFetchResult],
    *,
    internal_match_id: str,
    external_match_id: str,
) -> NormalizedBundle:
    event_payload = payload_dict(results.get("event"))
    event_row = first_item(event_payload, "events") or {}
    source = results.get("event").source if results.get("event") else "thesportsdb"
    fetched_at = max((result.fetched_at for result in results.values()), default=utc_now())
    mapping = normalize_match_mapping(event_row, internal_match_id, external_match_id, source)
    lineup = normalize_lineups(
        payload_dict(results.get("lineups")),
        mapping=mapping,
        fetched_at=results.get("lineups").fetched_at if results.get("lineups") else fetched_at,
    )
    events = normalize_timeline(
        payload_dict(results.get("events")),
        mapping=mapping,
        fetched_at=results.get("events").fetched_at if results.get("events") else fetched_at,
    )
    stats = normalize_stats(
        payload_dict(results.get("stats")),
        mapping=mapping,
        fetched_at=results.get("stats").fetched_at if results.get("stats") else fetched_at,
    )
    return NormalizedBundle(mapping=mapping, lineup=lineup, events=events, stats=stats)


def normalize_match_mapping(
    event_row: Mapping[str, Any],
    internal_match_id: str,
    external_match_id: str,
    source: str,
) -> SourceMatchMapping:
    home_name = text(event_row.get("strHomeTeam"))
    away_name = text(event_row.get("strAwayTeam"))
    kickoff = parse_kickoff(event_row)
    return SourceMatchMapping(
        internal_match_id=internal_match_id,
        source=source,
        external_match_id=text(event_row.get("idEvent")) or external_match_id,
        external_league_id=text(event_row.get("idLeague")),
        home_team_name=home_name,
        away_team_name=away_name,
        home_team_id=text(event_row.get("idHomeTeam")),
        away_team_id=text(event_row.get("idAwayTeam")),
        kickoff_utc=kickoff,
        mapping_status="mapped" if event_row else "external_id_only",
        confidence_score=1.0 if event_row else 0.65,
    )


def normalize_lineups(
    payload: Mapping[str, Any],
    *,
    mapping: SourceMatchMapping,
    fetched_at: str,
) -> NormalizedLineup | None:
    rows = list_items(payload, "lineup", "lineups", "players")
    if not rows:
        return None
    players: list[NormalizedLineupPlayer] = []
    starter_counts = {"home": 0, "away": 0}
    for index, row in enumerate(rows, start=1):
        side = side_from_home_flag(row)
        player_name = text(row.get("strPlayer"))
        if not player_name:
            continue
        is_starting = yes_no(row.get("strSubstitute")) is False
        if is_starting and side in starter_counts:
            starter_counts[side] += 1
        players.append(
            NormalizedLineupPlayer(
                match_id=mapping.internal_match_id,
                source=mapping.source,
                external_match_id=mapping.external_match_id,
                team_id=text(row.get("idTeam")),
                team_name=team_name_for_side(mapping, side),
                team_side=side,
                player_id=text(row.get("idPlayer")),
                player_name=player_name,
                shirt_number=text(row.get("intSquadNumber")),
                position=text(row.get("strPosition")),
                is_starting=is_starting,
                is_captain=bool("captain" in text(row.get("strPosition")).lower()),
                sort_order=int_or_none(row.get("intSquadNumber")) or index,
            )
        )
    status = "confirmed" if starter_counts["home"] >= 11 and starter_counts["away"] >= 11 else "partial"
    return NormalizedLineup(
        match_id=mapping.internal_match_id,
        source=mapping.source,
        external_match_id=mapping.external_match_id,
        fetched_at=fetched_at,
        status=status,
        players=players,
    )


def normalize_timeline(
    payload: Mapping[str, Any],
    *,
    mapping: SourceMatchMapping,
    fetched_at: str,
) -> list[NormalizedMatchEvent]:
    rows = list_items(payload, "timeline", "events")
    events: list[NormalizedMatchEvent] = []
    kickoff = parse_iso_datetime(mapping.kickoff_utc) or parse_iso_datetime(fetched_at)
    for row in rows:
        minute = int_or_none(row.get("intTime"))
        stoppage_minute = int_or_none(row.get("intExtra"))
        side = side_from_home_flag(row)
        event_type = normalize_event_type(text(row.get("strTimelineDetail")) or text(row.get("strTimeline")))
        event_time = event_time_from_minute(kickoff, minute, stoppage_minute, fetched_at)
        events.append(
            NormalizedMatchEvent(
                match_id=mapping.internal_match_id,
                source=mapping.source,
                external_match_id=mapping.external_match_id,
                external_event_id=text(row.get("idTimeline")),
                event_time=event_time,
                minute=minute,
                stoppage_minute=stoppage_minute,
                team_id=text(row.get("idTeam")),
                team_name=team_name_for_side(mapping, side) or text(row.get("strTeam")),
                team_side=side,
                event_type=event_type,
                player_id=text(row.get("idPlayer")),
                player_name=text(row.get("strPlayer")),
                related_player_id=text(row.get("idAssist")),
                related_player_name=text(row.get("strAssist")),
                description=event_description(row, event_type, mapping, side),
                raw=dict(row),
            )
        )
    return events


def normalize_stats(
    payload: Mapping[str, Any],
    *,
    mapping: SourceMatchMapping,
    fetched_at: str,
) -> list[NormalizedMatchStats]:
    rows = list_items(payload, "eventstats", "stats", "statistics")
    if not rows:
        return []
    by_side = {
        "home": NormalizedMatchStats(
            match_id=mapping.internal_match_id,
            source=mapping.source,
            external_match_id=mapping.external_match_id,
            stat_time=fetched_at,
            team_id=mapping.home_team_id,
            team_name=mapping.home_team_name,
            team_side="home",
        ),
        "away": NormalizedMatchStats(
            match_id=mapping.internal_match_id,
            source=mapping.source,
            external_match_id=mapping.external_match_id,
            stat_time=fetched_at,
            team_id=mapping.away_team_id,
            team_name=mapping.away_team_name,
            team_side="away",
        ),
    }
    for row in rows:
        stat_name = text(row.get("strStat")).lower()
        field_info = STAT_FIELD_MAP.get(stat_name)
        if not field_info:
            continue
        field_name, value_type = field_info
        setattr(by_side["home"], field_name, parsed_value(row.get("intHome"), value_type))
        setattr(by_side["away"], field_name, parsed_value(row.get("intAway"), value_type))
    return [stat for stat in by_side.values() if has_any_stat(stat)]


def payload_dict(result: SourceFetchResult | None) -> dict[str, Any]:
    payload = result.payload if result else None
    return payload if isinstance(payload, dict) else {}


def first_item(payload: Mapping[str, Any], *keys: str) -> dict[str, Any] | None:
    rows = list_items(payload, *keys)
    return rows[0] if rows else None


def list_items(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    for value in payload.values():
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    return []


def parse_kickoff(event_row: Mapping[str, Any]) -> str | None:
    timestamp = text(event_row.get("strTimestamp"))
    if timestamp:
        parsed = parse_iso_datetime(timestamp)
        if parsed:
            return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")
    date_value = text(event_row.get("dateEvent"))
    time_value = text(event_row.get("strTime"))
    if date_value and time_value:
        parsed = parse_iso_datetime(f"{date_value}T{time_value}")
        if parsed:
            return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")
    return None


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def event_time_from_minute(kickoff: datetime | None, minute: int | None, stoppage: int | None, fallback: str) -> str:
    if not kickoff or minute is None:
        return fallback
    return (kickoff + timedelta(minutes=minute + (stoppage or 0))).astimezone(timezone.utc).isoformat(timespec="seconds")


def normalize_event_type(value: str) -> str:
    lower = value.lower().strip()
    mapped = EVENT_TYPE_MAP.get(lower)
    if mapped:
        return mapped
    return lower.replace(" ", "_") or "unknown"


def event_description(row: Mapping[str, Any], event_type: str, mapping: SourceMatchMapping, side: str | None) -> str:
    minute = text(row.get("intTime"))
    team_name = team_name_for_side(mapping, side) or text(row.get("strTeam"))
    player = text(row.get("strPlayer"))
    assist = text(row.get("strAssist"))
    label = {
        "goal": "进球",
        "yellow_card": "黄牌",
        "red_card": "红牌",
        "substitution": "换人",
        "injury": "伤停",
        "var": "VAR",
        "penalty": "点球",
    }.get(event_type, text(row.get("strTimeline")) or event_type)
    parts = [f"{minute}'" if minute else "", team_name, label]
    if player:
        parts.append(player)
    if assist:
        parts.append(f"助攻：{assist}")
    return " ".join(part for part in parts if part)


def team_name_for_side(mapping: SourceMatchMapping, side: str | None) -> str | None:
    if side == "home":
        return mapping.home_team_name
    if side == "away":
        return mapping.away_team_name
    return None


def side_from_home_flag(row: Mapping[str, Any]) -> str | None:
    home_flag = yes_no(row.get("strHome"))
    if home_flag is True:
        return "home"
    if home_flag is False:
        return "away"
    return None


def yes_no(value: Any) -> bool | None:
    normalized = text(value).lower()
    if normalized in {"yes", "true", "1", "home"}:
        return True
    if normalized in {"no", "false", "0", "away"}:
        return False
    return None


def has_any_stat(stat: NormalizedMatchStats) -> bool:
    return any(
        getattr(stat, field) is not None
        for field in (
            "possession",
            "shots",
            "shots_on_target",
            "shots_off_target",
            "blocked_shots",
            "corners",
            "attacks",
            "dangerous_attacks",
            "fouls",
            "offsides",
            "total_passes",
            "accurate_passes",
            "pass_accuracy",
            "yellow_cards",
            "red_cards",
            "xg",
        )
    )


def parsed_value(value: Any, value_type: str) -> int | float | None:
    if value_type == "float":
        return float_or_none(value)
    return int_or_none(value)


def int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    cleaned = text(value).replace("%", "").replace(",", "")
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    cleaned = text(value).replace("%", "").replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
