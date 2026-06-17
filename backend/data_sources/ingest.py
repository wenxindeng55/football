from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Iterable

from backend.data_sources.types import (
    IngestSummary,
    NormalizedBundle,
    NormalizedLineup,
    NormalizedLineupPlayer,
    NormalizedMatchEvent,
    NormalizedMatchStats,
    SourceFetchResult,
    SourceMatchMapping,
)


def ingest_match_intelligence(
    connection: sqlite3.Connection,
    *,
    results: Iterable[SourceFetchResult],
    bundle: NormalizedBundle,
) -> IngestSummary:
    summary = IngestSummary(
        source=bundle.mapping.source,
        internal_match_id=bundle.mapping.internal_match_id,
        external_match_id=bundle.mapping.external_match_id,
    )
    result_list = list(results)
    summary.raw_payloads = save_raw_payloads(connection, result_list)
    update_source_health(connection, result_list)
    upsert_match_source_map(connection, bundle.mapping)
    if bundle.lineup:
        summary.lineup_players = upsert_lineup(connection, bundle.lineup)
    summary.events = upsert_events(connection, bundle.events)
    summary.stats = insert_stats(connection, bundle.stats)
    for result in result_list:
        if result.error_message:
            summary.errors.append(f"{result.data_type}: {result.error_message}")
        insert_fetch_job_log(
            connection,
            result=result,
            status="error" if result.error_message else "success",
            rows_written=rows_written_for_type(summary, result.data_type),
            message=result.error_message,
        )
    return summary


def save_raw_payloads(connection: sqlite3.Connection, results: Iterable[SourceFetchResult]) -> int:
    now = utc_now()
    count = 0
    for result in results:
        connection.execute(
            """
            INSERT INTO raw_source_payloads (
                source, data_type, internal_match_id, external_match_id, request_url,
                http_status, fetched_at, payload_json, error_message, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.source,
                result.data_type,
                result.internal_match_id,
                result.external_match_id,
                result.request_url,
                result.http_status,
                result.fetched_at,
                json.dumps(result.payload if result.payload is not None else {}, ensure_ascii=False),
                result.error_message,
                now,
            ),
        )
        count += 1
    return count


def update_source_health(connection: sqlite3.Connection, results: Iterable[SourceFetchResult]) -> None:
    for result in results:
        row = connection.execute(
            """
            SELECT id
            FROM source_health
            WHERE source = ? AND data_type = ?
            """,
            (result.source, result.data_type),
        ).fetchone()
        is_success = result.error_message is None and (result.http_status is None or result.http_status < 400)
        if row:
            if is_success:
                connection.execute(
                    """
                    UPDATE source_health
                    SET last_success_at = ?, success_count = success_count + 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (result.fetched_at, utc_now(), row[0]),
                )
            else:
                connection.execute(
                    """
                    UPDATE source_health
                    SET last_error_at = ?, last_error_message = ?, error_count = error_count + 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (result.fetched_at, result.error_message, utc_now(), row[0]),
                )
            continue
        connection.execute(
            """
            INSERT INTO source_health (
                source, data_type, last_success_at, last_error_at, last_error_message,
                success_count, error_count, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.source,
                result.data_type,
                result.fetched_at if is_success else None,
                result.fetched_at if not is_success else None,
                result.error_message,
                1 if is_success else 0,
                0 if is_success else 1,
                utc_now(),
            ),
        )


def insert_fetch_job_log(
    connection: sqlite3.Connection,
    *,
    result: SourceFetchResult,
    status: str,
    rows_written: int,
    message: str | None,
) -> None:
    now = utc_now()
    connection.execute(
        """
        INSERT INTO fetch_job_logs (
            job_name, source, data_type, internal_match_id, external_match_id,
            status, started_at, finished_at, rows_written, message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "manual_match_intelligence_fetch",
            result.source,
            result.data_type,
            result.internal_match_id,
            result.external_match_id,
            status,
            result.fetched_at,
            now,
            rows_written,
            message,
            now,
        ),
    )


def upsert_match_source_map(connection: sqlite3.Connection, mapping: SourceMatchMapping) -> None:
    now = utc_now()
    row = connection.execute(
        """
        SELECT id
        FROM match_source_map
        WHERE internal_match_id = ?
          AND (source = ? OR source IS NULL)
        ORDER BY CASE WHEN source = ? THEN 0 ELSE 1 END, id
        LIMIT 1
        """,
        (mapping.internal_match_id, mapping.source, mapping.source),
    ).fetchone()
    values = (
        mapping.source,
        mapping.external_match_id,
        mapping.external_league_id,
        mapping.home_team_name,
        mapping.away_team_name,
        mapping.kickoff_utc,
        mapping.mapping_status,
        mapping.source,
        mapping.external_match_id,
        mapping.source,
        mapping.external_match_id,
        mapping.source,
        mapping.external_match_id,
        mapping.home_team_name,
        mapping.away_team_name,
        mapping.kickoff_utc,
        mapping.confidence_score,
        now,
    )
    if row:
        connection.execute(
            """
            UPDATE match_source_map
            SET source = ?,
                external_match_id = ?,
                external_league_id = ?,
                home_team_name = ?,
                away_team_name = ?,
                kickoff_utc = ?,
                mapping_status = ?,
                lineup_source = ?,
                lineup_external_match_id = ?,
                stats_source = ?,
                stats_external_match_id = ?,
                events_source = ?,
                events_external_match_id = ?,
                home_team_name_normalized = ?,
                away_team_name_normalized = ?,
                match_time_utc = ?,
                confidence_score = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (*values, row[0]),
        )
        return
    connection.execute(
        """
        INSERT INTO match_source_map (
            internal_match_id, source, external_match_id, external_league_id,
            home_team_name, away_team_name, kickoff_utc, mapping_status,
            lineup_source, lineup_external_match_id, stats_source, stats_external_match_id,
            events_source, events_external_match_id, home_team_name_normalized,
            away_team_name_normalized, match_time_utc, confidence_score, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (mapping.internal_match_id, *values[:-1], now, now),
    )


def upsert_lineup(connection: sqlite3.Connection, lineup: NormalizedLineup) -> int:
    now = utc_now()
    row = connection.execute(
        """
        SELECT id
        FROM match_lineups
        WHERE match_id = ? AND source = ? AND external_match_id = ?
        LIMIT 1
        """,
        (lineup.match_id, lineup.source, lineup.external_match_id),
    ).fetchone()
    lineup_confirmed = 1 if lineup.status in {"confirmed", "official"} else 0
    if row:
        lineup_id = int(row[0])
        connection.execute(
            """
            UPDATE match_lineups
            SET collected_at = ?, home_formation = ?, away_formation = ?, status = ?,
                lineup_confirmed = ?, fetched_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                lineup.fetched_at,
                lineup.home_formation,
                lineup.away_formation,
                lineup.status,
                lineup_confirmed,
                lineup.fetched_at,
                now,
                lineup_id,
            ),
        )
    else:
        cursor = connection.execute(
            """
            INSERT INTO match_lineups (
                match_id, collected_at, team_name, formation, lineup_confirmed,
                starters_json, substitutes_json, key_players_missing_json, source_url,
                source, external_match_id, home_formation, away_formation, status,
                fetched_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lineup.match_id,
                lineup.fetched_at,
                "__match__",
                None,
                lineup_confirmed,
                lineup.source,
                lineup.external_match_id,
                lineup.home_formation,
                lineup.away_formation,
                lineup.status,
                lineup.fetched_at,
                now,
                now,
            ),
        )
        lineup_id = int(cursor.lastrowid)
    count = 0
    for player in lineup.players:
        upsert_lineup_player(connection, lineup_id, player)
        count += 1
    return count


def upsert_lineup_player(connection: sqlite3.Connection, lineup_id: int, player: NormalizedLineupPlayer) -> None:
    now = utc_now()
    row = connection.execute(
        """
        SELECT id
        FROM lineup_players
        WHERE match_id = ?
          AND source = ?
          AND external_match_id = ?
          AND COALESCE(player_id, '') = COALESCE(?, '')
          AND team_side IS ?
          AND player_name = ?
          AND is_starting = ?
        LIMIT 1
        """,
        (
            player.match_id,
            player.source,
            player.external_match_id,
            player.player_id,
            player.team_side,
            player.player_name,
            1 if player.is_starting else 0,
        ),
    ).fetchone()
    values = (
        lineup_id,
        player.team_id,
        player.team_name,
        player.team_side,
        player.external_match_id,
        player.player_id,
        player.player_name,
        player.shirt_number,
        player.position,
        1 if player.is_starting else 0,
        1 if player.is_captain else 0,
        player.sort_order,
        player.source,
        now,
    )
    if row:
        connection.execute(
            """
            UPDATE lineup_players
            SET lineup_id = ?, team_id = ?, team_name = ?, team_side = ?,
                external_match_id = ?, player_id = ?, player_name = ?,
                shirt_number = ?, position = ?, is_starting = ?, is_captain = ?,
                sort_order = ?, source = ?, updated_at = ?
            WHERE id = ?
            """,
            (*values, row[0]),
        )
        return
    connection.execute(
        """
        INSERT INTO lineup_players (
            lineup_id, match_id, team_id, team_name, team_side, external_match_id,
            player_id, player_name, shirt_number, position, is_starting, is_captain,
            sort_order, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            lineup_id,
            player.match_id,
            player.team_id,
            player.team_name,
            player.team_side,
            player.external_match_id,
            player.player_id,
            player.player_name,
            player.shirt_number,
            player.position,
            1 if player.is_starting else 0,
            1 if player.is_captain else 0,
            player.sort_order,
            player.source,
            now,
            now,
        ),
    )


def upsert_events(connection: sqlite3.Connection, events: Iterable[NormalizedMatchEvent]) -> int:
    count = 0
    for event in events:
        upsert_event(connection, event)
        count += 1
    return count


def upsert_event(connection: sqlite3.Connection, event: NormalizedMatchEvent) -> None:
    now = utc_now()
    row = None
    if event.external_event_id:
        row = connection.execute(
            """
            SELECT id
            FROM match_events
            WHERE match_id = ? AND source = ? AND external_event_id = ?
            LIMIT 1
            """,
            (event.match_id, event.source, event.external_event_id),
        ).fetchone()
    if not row:
        row = connection.execute(
            """
            SELECT id
            FROM match_events
            WHERE match_id = ?
              AND source = ?
              AND external_match_id = ?
              AND event_type = ?
              AND COALESCE(minute, -1) = COALESCE(?, -1)
              AND COALESCE(player_name, '') = COALESCE(?, '')
            LIMIT 1
            """,
            (
                event.match_id,
                event.source,
                event.external_match_id,
                event.event_type,
                event.minute,
                event.player_name,
            ),
        ).fetchone()
    values = (
        event.external_match_id,
        event.event_time,
        event.minute,
        event.team_name,
        event.event_type,
        event.player_name,
        event.description,
        json.dumps(event.raw, ensure_ascii=False),
        event.source,
        event.external_event_id,
        event.team_id,
        event.team_side,
        event.player_id,
        event.related_player_id,
        event.related_player_name,
        event.stoppage_minute,
        now,
    )
    if row:
        connection.execute(
            """
            UPDATE match_events
            SET external_match_id = ?, event_time = ?, minute = ?, team_name = ?,
                event_type = ?, player_name = ?, description = ?, raw_json = ?,
                source = ?, external_event_id = ?, team_id = ?, team_side = ?,
                player_id = ?, related_player_id = ?, related_player_name = ?,
                stoppage_minute = ?, updated_at = ?
            WHERE id = ?
            """,
            (*values, row[0]),
        )
        return
    connection.execute(
        """
        INSERT INTO match_events (
            match_id, external_match_id, event_time, minute, team_name, event_type,
            player_name, description, raw_json, source, external_event_id, team_id,
            team_side, player_id, related_player_id, related_player_name,
            stoppage_minute, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (event.match_id, *values[:-1], now, now),
    )


def insert_stats(connection: sqlite3.Connection, stats: Iterable[NormalizedMatchStats]) -> int:
    now = utc_now()
    count = 0
    for stat in stats:
        connection.execute(
            """
            INSERT INTO match_stats (
                match_id, source, external_match_id, team_id, team_side, stat_time,
                minute, team_name, possession, shots, shots_on_target, shots_off_target,
                blocked_shots, corners, attacks, dangerous_attacks, fouls, offsides,
                total_passes, accurate_passes, pass_accuracy, yellow_cards, red_cards,
                xg, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                stat.match_id,
                stat.source,
                stat.external_match_id,
                stat.team_id,
                stat.team_side,
                stat.stat_time,
                stat.minute,
                stat.team_name,
                stat.possession,
                stat.shots,
                stat.shots_on_target,
                stat.shots_off_target,
                stat.blocked_shots,
                stat.corners,
                stat.attacks,
                stat.dangerous_attacks,
                stat.fouls,
                stat.offsides,
                stat.total_passes,
                stat.accurate_passes,
                stat.pass_accuracy,
                stat.yellow_cards,
                stat.red_cards,
                stat.xg,
                now,
                now,
            ),
        )
        count += 1
    return count


def rows_written_for_type(summary: IngestSummary, data_type: str) -> int:
    if data_type == "lineups":
        return summary.lineup_players
    if data_type == "events":
        return summary.events
    if data_type == "stats":
        return summary.stats
    return 0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
