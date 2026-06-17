from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class SourceFetchResult:
    source: str
    data_type: str
    internal_match_id: str
    external_match_id: str
    request_url: str
    fetched_at: str
    http_status: int | None = None
    payload: dict[str, Any] | list[Any] | None = None
    error_message: str | None = None


@dataclass(slots=True)
class SourceMatchMapping:
    internal_match_id: str
    source: str
    external_match_id: str
    external_league_id: str | None = None
    home_team_name: str | None = None
    away_team_name: str | None = None
    home_team_id: str | None = None
    away_team_id: str | None = None
    kickoff_utc: str | None = None
    mapping_status: str = "mapped"
    confidence_score: float = 1.0


@dataclass(slots=True)
class NormalizedLineupPlayer:
    match_id: str
    source: str
    external_match_id: str
    team_id: str | None
    team_name: str | None
    team_side: str | None
    player_id: str | None
    player_name: str
    shirt_number: str | None = None
    position: str | None = None
    is_starting: bool = False
    is_captain: bool = False
    sort_order: int | None = None


@dataclass(slots=True)
class NormalizedLineup:
    match_id: str
    source: str
    external_match_id: str
    fetched_at: str
    status: str
    home_formation: str | None = None
    away_formation: str | None = None
    players: list[NormalizedLineupPlayer] = field(default_factory=list)


@dataclass(slots=True)
class NormalizedMatchEvent:
    match_id: str
    source: str
    external_match_id: str
    external_event_id: str | None
    event_time: str
    minute: int | None
    stoppage_minute: int | None
    team_id: str | None
    team_name: str | None
    team_side: str | None
    event_type: str
    player_id: str | None
    player_name: str | None
    related_player_id: str | None
    related_player_name: str | None
    description: str | None
    raw: dict[str, Any]


@dataclass(slots=True)
class NormalizedMatchStats:
    match_id: str
    source: str
    external_match_id: str
    stat_time: str
    team_id: str | None
    team_name: str | None
    team_side: str | None
    minute: int | None = None
    possession: float | None = None
    shots: int | None = None
    shots_on_target: int | None = None
    shots_off_target: int | None = None
    blocked_shots: int | None = None
    corners: int | None = None
    attacks: int | None = None
    dangerous_attacks: int | None = None
    fouls: int | None = None
    offsides: int | None = None
    total_passes: int | None = None
    accurate_passes: int | None = None
    pass_accuracy: float | None = None
    yellow_cards: int | None = None
    red_cards: int | None = None
    xg: float | None = None


@dataclass(slots=True)
class NormalizedBundle:
    mapping: SourceMatchMapping
    lineup: NormalizedLineup | None = None
    events: list[NormalizedMatchEvent] = field(default_factory=list)
    stats: list[NormalizedMatchStats] = field(default_factory=list)


@dataclass(slots=True)
class IngestSummary:
    source: str
    internal_match_id: str
    external_match_id: str
    raw_payloads: int = 0
    lineup_players: int = 0
    events: int = 0
    stats: int = 0
    errors: list[str] = field(default_factory=list)
