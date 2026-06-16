from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import time
from collections import OrderedDict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from logging_config import setup_logging
from sgodds_collector import (
    CURRENT_ODDS_URL,
    MatchConfig,
    SG_TIMEZONE,
    parse_current_odds_matches,
)
from team_translations import translate_match_name, translate_team


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.json"
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "sgodds_odds.sqlite3"
logger = setup_logging("odds_watcher.backend", "backend.log")

MARKET_ORDER = ("1x2", "asian", "totals", "btts")
MARKET_DEFINITIONS: dict[str, dict[str, Any]] = {
    "1x2": {
        "label": "1X2",
        "description": "胜平负市场，用来观察主胜、平局、客胜方向变化。",
        "aliases": ("01 | 1X2", "1X2"),
    },
    "asian": {
        "label": "亚洲让球",
        "description": "亚洲让球盘口，重点观察让球方向是否被持续压低。",
        "aliases": ("Asian Handicap (Account Only)",),
    },
    "totals": {
        "label": "大小球",
        "description": "大小球盘口，用来观察进球预期是否升温。",
        "aliases": ("12 | Total Goals Over/Under", "Total Goals Over/Under"),
    },
    "btts": {
        "label": "双方进球",
        "description": "双方进球 Yes / No，用来观察两队均有进球的市场预期。",
        "aliases": ("Will Both Teams Score",),
    },
}

app = FastAPI(title="Odds Watcher API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next: Any) -> Any:
    started_at = time.perf_counter()
    client = request.client
    client_text = f"{client.host}:{client.port}" if client else "-"
    host_text = request.url.netloc or request.headers.get("host", "-")

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "API 请求异常 client=%s host=%s method=%s path=%s status=500 duration_ms=%.2f",
            client_text,
            host_text,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "API 请求 client=%s host=%s method=%s path=%s status=%s duration_ms=%.2f",
        client_text,
        host_text,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


def database_path() -> Path:
    env_path = os.getenv("ODDS_DB_PATH")
    if env_path:
        path = Path(env_path)
        return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()

    if DEFAULT_CONFIG_PATH.exists():
        try:
            with DEFAULT_CONFIG_PATH.open("r", encoding="utf-8") as file:
                config = json.load(file)
            configured = config.get("database")
            if configured:
                path = Path(configured)
                return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()
        except (OSError, json.JSONDecodeError):
            pass

    return DEFAULT_DATABASE_PATH


def connect_readonly() -> sqlite3.Connection:
    path = database_path()
    if not path.exists():
        raise FileNotFoundError(str(path))

    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def load_config_document() -> dict[str, Any]:
    if not DEFAULT_CONFIG_PATH.exists():
        return {
            "interval_seconds": 600,
            "output_dir": "data",
            "database": str(DEFAULT_DATABASE_PATH.relative_to(PROJECT_ROOT)),
            "request_timeout_seconds": 30,
            "request_pause_seconds": 2,
            "matches": [],
            "hidden_matches": [],
        }

    with DEFAULT_CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not isinstance(config.get("matches"), list):
        config["matches"] = []
    if not isinstance(config.get("hidden_matches"), list):
        config["hidden_matches"] = []
    return config


def write_config_document(config: dict[str, Any]) -> None:
    with DEFAULT_CONFIG_PATH.open("w", encoding="utf-8") as file:
        json.dump(config, file, ensure_ascii=False, indent=2)
        file.write("\n")


def has_snapshots_table(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'odds_snapshots'
        LIMIT 1
        """
    ).fetchone()
    return row is not None


def has_match_metadata_table(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'match_metadata'
        LIMIT 1
        """
    ).fetchone()
    return row is not None


def slugify(value: str, default: str = "match") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or default


def match_hash(match_url: str) -> str:
    return hashlib.sha1(match_url.encode("utf-8")).hexdigest()[:6]


def parse_match_teams(match_name: str) -> tuple[str, str]:
    parts = re.split(r"\s+(?:vs|v)\s+", match_name, maxsplit=1, flags=re.IGNORECASE)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return match_name, ""


def snapshot_match_name(meta: dict[str, Any]) -> str:
    return str(meta.get("snapshotName") or meta["name"])


def localize_match_text(meta: dict[str, Any], value: str) -> str:
    replacements = [
        (str(meta.get("homeTeamEnglish") or ""), str(meta.get("homeTeam") or "")),
        (str(meta.get("awayTeamEnglish") or ""), str(meta.get("awayTeam") or "")),
    ]
    text = value
    for source, target in sorted(replacements, key=lambda item: len(item[0]), reverse=True):
        if source and target and source != target:
            text = text.replace(source, target)
    return text


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def format_datetime(value: str | None) -> str:
    parsed = parse_time(value)
    if parsed:
        return parsed.strftime("%Y-%m-%d %H:%M")
    return value or ""


def format_point_time(value: str | None) -> str:
    parsed = parse_time(value)
    if parsed:
        return parsed.strftime("%Y-%m-%d %H:%M")
    return value or ""


def pct(opening_odds: float, current_odds: float) -> float:
    if opening_odds == 0:
        return 0.0
    return round(((current_odds - opening_odds) / opening_odds) * 100, 1)


def normalize_market_value(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def normalize_market_key(market: str | None) -> str:
    if not market:
        return "1x2"
    market_text = market.strip().lower()
    for key, definition in MARKET_DEFINITIONS.items():
        candidates = [key, definition["label"], *definition["aliases"]]
        if market_text in {candidate.strip().lower() for candidate in candidates}:
            return key

    normalized = normalize_market_value(market)
    if not normalized:
        return "1x2"
    for key, definition in MARKET_DEFINITIONS.items():
        candidates = [key, definition["label"], *definition["aliases"]]
        normalized_candidates = {normalize_market_value(candidate) for candidate in candidates}
        normalized_candidates.discard("")
        if normalized in normalized_candidates or any(
            candidate and normalized.startswith(candidate) for candidate in normalized_candidates
        ):
            return key
    return normalized if normalized in MARKET_DEFINITIONS else "1x2"


def market_key_for_type(market_type: str) -> str | None:
    market_text = market_type.strip().lower()
    for key, definition in MARKET_DEFINITIONS.items():
        aliases = [definition["label"], *definition["aliases"]]
        if market_text in {alias.strip().lower() for alias in aliases}:
            return key

    normalized = normalize_market_value(market_type)
    if not normalized:
        return None
    for key, definition in MARKET_DEFINITIONS.items():
        aliases = [definition["label"], *definition["aliases"]]
        normalized_aliases = {normalize_market_value(alias) for alias in aliases}
        normalized_aliases.discard("")
        if normalized in normalized_aliases or any(normalized.startswith(alias) for alias in normalized_aliases):
            return key
    return None


def list_match_metas() -> list[dict[str, Any]]:
    hidden_urls: set[str] = set()
    try:
        hidden_urls = hidden_match_urls(load_config_document())
    except (OSError, json.JSONDecodeError):
        hidden_urls = set()

    try:
        with connect_readonly() as connection:
            if not has_snapshots_table(connection):
                return []
            metadata_select = """
                    metadata.match_name_en,
                    metadata.match_name_zh,
                    metadata.home_team_en,
                    metadata.away_team_en,
                    metadata.home_team_zh,
                    metadata.away_team_zh,
                    metadata.match_time,
                    metadata.league,
                    metadata.match_no,
                    metadata.source_type
            """
            metadata_join = "LEFT JOIN match_metadata AS metadata ON metadata.match_url = grouped.match_url"
            if not has_match_metadata_table(connection):
                metadata_select = """
                    NULL AS match_name_en,
                    NULL AS match_name_zh,
                    NULL AS home_team_en,
                    NULL AS away_team_en,
                    NULL AS home_team_zh,
                    NULL AS away_team_zh,
                    NULL AS match_time,
                    NULL AS league,
                    NULL AS match_no,
                    NULL AS source_type
                """
                metadata_join = ""
            rows = connection.execute(
                f"""
                WITH grouped AS (
                    SELECT
                        match_name,
                        match_url,
                        MAX(collected_at) AS collected_at,
                        MAX(page_updated_at) AS page_updated_at,
                        COUNT(*) AS row_count
                    FROM odds_snapshots
                    GROUP BY match_name, match_url
                )
                SELECT
                    grouped.match_name,
                    grouped.match_url,
                    grouped.collected_at,
                    grouped.page_updated_at,
                    grouped.row_count,
                    {metadata_select}
                FROM grouped
                {metadata_join}
                ORDER BY collected_at DESC, match_name
                """
            ).fetchall()
    except (FileNotFoundError, sqlite3.Error):
        return []

    metas: list[dict[str, Any]] = []
    for row in rows:
        match_url = row["match_url"]
        if match_url in hidden_urls:
            continue
        base_id = slugify(row["match_name"])
        home_en, away_en = parse_match_teams(row["match_name_en"] or row["match_name"])
        home_zh = row["home_team_zh"] or translate_team(home_en)
        away_zh = row["away_team_zh"] or translate_team(away_en)
        name_zh = row["match_name_zh"] or translate_match_name(row["match_name"])
        metas.append(
            {
                "id": f"{base_id}-{match_hash(match_url)}",
                "legacyId": base_id,
                "snapshotName": row["match_name"],
                "name": name_zh,
                "englishName": row["match_name_en"] or row["match_name"],
                "url": match_url,
                "homeTeam": home_zh,
                "awayTeam": away_zh,
                "homeTeamEnglish": home_en,
                "awayTeamEnglish": away_en,
                "matchTime": row["match_time"],
                "league": row["league"],
                "matchNo": row["match_no"],
                "sourceType": row["source_type"] or "unknown",
                "collectedAt": row["collected_at"],
                "pageUpdatedAt": row["page_updated_at"],
                "rowCount": row["row_count"],
            }
        )
    return metas


def find_match_meta(match_id: str) -> dict[str, Any] | None:
    metas = list_match_metas()
    for meta in metas:
        if meta["id"] == match_id:
            return meta
    legacy_matches = [meta for meta in metas if meta.get("legacyId") == match_id]
    if len(legacy_matches) == 1:
        return legacy_matches[0]
    return None


def available_market_rows(connection: sqlite3.Connection, meta: dict[str, Any]) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT market_type, COUNT(*) AS row_count
        FROM odds_snapshots
        WHERE match_name = ? AND match_url = ?
        GROUP BY market_type
        ORDER BY MIN(id)
        """,
        (snapshot_match_name(meta), meta["url"]),
    ).fetchall()


def resolve_actual_market_type(
    connection: sqlite3.Connection,
    meta: dict[str, Any],
    market_key: str,
) -> str | None:
    rows = available_market_rows(connection, meta)
    market_types = [row["market_type"] for row in rows]
    definition = MARKET_DEFINITIONS[market_key]
    for alias in definition["aliases"]:
        if alias in market_types:
            return alias

    normalized_aliases = [normalize_market_value(alias) for alias in definition["aliases"]]
    for market_type in market_types:
        normalized_type = normalize_market_value(market_type)
        if normalized_type in normalized_aliases or any(
            alias and normalized_type.startswith(alias) for alias in normalized_aliases
        ):
            return market_type
    return None


def build_market_data(
    connection: sqlite3.Connection,
    meta: dict[str, Any],
    market_key: str,
) -> dict[str, Any]:
    definition = MARKET_DEFINITIONS[market_key]
    actual_market_type = resolve_actual_market_type(connection, meta, market_key)
    if not actual_market_type:
        return {
            "key": market_key,
            "label": definition["label"],
            "description": definition["description"],
            "selections": [],
        }

    rows = connection.execute(
        """
        SELECT
            collected_at,
            option_name,
            opening_odds,
            current_odds
        FROM odds_snapshots
        WHERE match_name = ? AND match_url = ? AND market_type = ?
        ORDER BY collected_at, id
        """,
        (snapshot_match_name(meta), meta["url"], actual_market_type),
    ).fetchall()

    selections: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for row in rows:
        option_name = row["option_name"]
        display_option = localize_match_text(meta, option_name)
        selection = selections.setdefault(
            option_name,
            {
                "option": display_option,
                "openingOdds": float(row["opening_odds"]),
                "points": [],
            },
        )
        selection["points"].append(
            {
                "time": format_point_time(row["collected_at"]),
                "odds": float(row["current_odds"]),
            }
        )

    return {
        "key": market_key,
        "label": definition["label"],
        "description": definition["description"],
        "selections": list(selections.values()),
    }


def latest_rows(
    connection: sqlite3.Connection,
    meta: dict[str, Any],
    market_type: str | None = None,
) -> list[sqlite3.Row]:
    outer_params: list[Any] = [snapshot_match_name(meta), meta["url"]]
    subquery_params: list[Any] = [snapshot_match_name(meta), meta["url"]]
    market_filter = ""
    subquery_market_filter = ""
    if market_type:
        market_filter = "AND market_type = ?"
        subquery_market_filter = "AND market_type = ?"
        outer_params.append(market_type)
        subquery_params.append(market_type)

    return connection.execute(
        f"""
        SELECT
            collected_at,
            market_type,
            option_name,
            opening_odds,
            current_odds,
            change_percent
        FROM odds_snapshots
        WHERE match_name = ?
          AND match_url = ?
          {market_filter}
          AND collected_at = (
              SELECT MAX(collected_at)
              FROM odds_snapshots
              WHERE match_name = ? AND match_url = ?
              {subquery_market_filter}
          )
        ORDER BY ABS(change_percent) DESC, id
        """,
        (*outer_params, *subquery_params),
    ).fetchall()


def interpret_change(market_key: str, option: str, change_percent: float, home: str, away: str) -> str:
    if change_percent < 0:
        interpretation = f"{option} 赔率下降，市场热度上升"
    elif change_percent > 0:
        interpretation = f"{option} 赔率上升，市场热度回落"
    else:
        interpretation = f"{option} 赔率保持稳定"

    if market_key == "1x2" and option == home and change_percent <= -8:
        return f"市场明显偏向 {home}"
    if market_key == "1x2" and away and option == away and change_percent >= 8:
        return f"市场明显不看好 {away}"
    if market_key == "totals" and option.lower().startswith("over") and change_percent < 0:
        return "进球预期上升"
    return interpretation


def build_table_rows(market_data: dict[str, Any], home: str, away: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    market_key = str(market_data["key"])
    for selection in market_data["selections"]:
        opening_odds = float(selection["openingOdds"])
        for point in selection["points"]:
            current_odds = float(point["odds"])
            change_percent = pct(opening_odds, current_odds)
            rows.append(
                {
                    "time": point["time"],
                    "marketType": market_data["label"],
                    "option": selection["option"],
                    "openingOdds": opening_odds,
                    "currentOdds": current_odds,
                    "changePercent": change_percent,
                    "interpretation": interpret_change(
                        market_key,
                        selection["option"],
                        change_percent,
                        home,
                        away,
                    ),
                }
            )
    return rows


def query_snapshot_rows(
    connection: sqlite3.Connection,
    meta: dict[str, Any],
    market_key: str | None,
) -> list[sqlite3.Row]:
    params: list[Any] = [snapshot_match_name(meta), meta["url"]]
    market_filter = ""
    if market_key:
        actual_market_type = resolve_actual_market_type(connection, meta, market_key)
        if not actual_market_type:
            return []
        market_filter = "AND market_type = ?"
        params.append(actual_market_type)

    return connection.execute(
        f"""
        SELECT
            id,
            collected_at,
            page_updated_at,
            match_name,
            match_url,
            market_type,
            option_name,
            opening_odds,
            current_odds,
            change_percent,
            raw_html_path
        FROM odds_snapshots
        WHERE match_name = ?
          AND match_url = ?
          {market_filter}
        ORDER BY collected_at DESC, market_type, option_name, id
        """,
        params,
    ).fetchall()


def snapshot_rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "collectedAt": row["collected_at"],
            "pageUpdatedAt": row["page_updated_at"],
            "matchName": row["match_name"],
            "matchUrl": row["match_url"],
            "marketType": row["market_type"],
            "optionName": row["option_name"],
            "openingOdds": float(row["opening_odds"]),
            "currentOdds": float(row["current_odds"]),
            "changePercent": float(row["change_percent"]),
            "rawHtmlPath": row["raw_html_path"],
        }
        for row in rows
    ]


def optional_payload_text(payload: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = str(payload.get(key, "")).strip()
        if value:
            return value
    return None


def normalize_config_match(raw_match: Any) -> dict[str, str | None] | None:
    if isinstance(raw_match, str):
        url = raw_match.strip()
        if not url:
            return None
        return {"name": "", "url": url}

    if isinstance(raw_match, dict):
        url = str(raw_match.get("url", "")).strip()
        if not url:
            return None
        return {
            "name": str(raw_match.get("name", "")).strip(),
            "url": url,
            "matchTime": optional_payload_text(raw_match, "matchTime", "match_time"),
            "league": optional_payload_text(raw_match, "league"),
            "matchNo": optional_payload_text(raw_match, "matchNo", "match_no"),
        }

    return None


def normalize_hidden_match(raw_match: Any) -> dict[str, str | None] | None:
    if isinstance(raw_match, str):
        url = raw_match.strip()
        if not url:
            return None
        return {"name": "", "nameZh": None, "url": url, "hiddenAt": None, "reason": None}

    if isinstance(raw_match, dict):
        url = str(raw_match.get("url", "")).strip()
        if not url:
            return None
        return {
            "name": str(raw_match.get("name", "")).strip(),
            "nameZh": optional_payload_text(raw_match, "nameZh", "name_zh"),
            "url": url,
            "hiddenAt": optional_payload_text(raw_match, "hiddenAt", "hidden_at"),
            "reason": optional_payload_text(raw_match, "reason"),
        }

    return None


def hidden_match_urls(config: dict[str, Any]) -> set[str]:
    return {
        str(match["url"])
        for match in (
            normalize_hidden_match(item)
            for item in config.get("hidden_matches", [])
        )
        if match is not None
    }


def sg_today() -> date:
    return datetime.now(SG_TIMEZONE).date()


def discovery_match_to_dict(match: MatchConfig, config: dict[str, Any]) -> dict[str, Any]:
    monitored_urls = {
        str(item["url"])
        for item in (
            normalize_config_match(raw_match)
            for raw_match in config.get("matches", [])
        )
        if item is not None
    }
    hidden_urls = hidden_match_urls(config)
    name = match.name or ""
    home, away = parse_match_teams(name)
    return {
        "name": name,
        "nameZh": translate_match_name(name),
        "url": match.url,
        "matchTime": match.match_time,
        "league": match.league,
        "matchNo": match.match_no,
        "homeTeam": home,
        "awayTeam": away,
        "homeTeamZh": translate_team(home) if home else "",
        "awayTeamZh": translate_team(away) if away else "",
        "monitored": match.url in monitored_urls,
        "hidden": match.url in hidden_urls,
    }


def build_summary_cards(connection: sqlite3.Connection, meta: dict[str, Any]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    title_map = {
        "1x2": "胜平负方向",
        "asian": "亚洲让球方向",
        "totals": "大小球方向",
    }
    for market_key, title in title_map.items():
        actual_market_type = resolve_actual_market_type(connection, meta, market_key)
        if not actual_market_type:
            continue
        rows = latest_rows(connection, meta, actual_market_type)
        if not rows:
            continue
        row = rows[0]
        option = localize_match_text(meta, row["option_name"])
        change_percent = float(row["change_percent"])
        cards.append(
            {
                "title": title,
                "openingOdds": f"{option} / {float(row['opening_odds']):.2f}",
                "currentOdds": f"{option} / {float(row['current_odds']):.2f}",
                "changePercent": change_percent,
                "explanation": interpret_change(
                    market_key,
                    option,
                    change_percent,
                    str(meta.get("homeTeam") or ""),
                    str(meta.get("awayTeam") or ""),
                ),
            }
        )
    return cards


def alert_level(change_percent: float) -> str:
    absolute_change = abs(change_percent)
    if absolute_change >= 15:
        return "高风险"
    if absolute_change >= 8:
        return "重要"
    return "普通"


def build_alerts(connection: sqlite3.Connection, meta: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [
        row
        for row in latest_rows(connection, meta)
        if abs(float(row["change_percent"])) >= 5
    ][:8]
    alerts: list[dict[str, Any]] = []
    for row in rows:
        change_percent = float(row["change_percent"])
        option = row["option_name"]
        alerts.append(
            {
                "id": slugify(
                    f"{meta['id']}-{row['market_type']}-{option}-{row['collected_at']}",
                    "alert",
                ),
                "time": format_point_time(row["collected_at"]),
                "level": alert_level(change_percent),
                "message": (
                    f"{row['market_type']} {localize_match_text(meta, option)} 从 {float(row['opening_odds']):.2f} "
                    f"到 {float(row['current_odds']):.2f}，变化 {change_percent:+.1f}%。"
                ),
            }
        )
    return sorted(alerts, key=lambda item: item["time"], reverse=True)


def build_tags(alerts: list[dict[str, Any]], summary_cards: list[dict[str, Any]]) -> list[dict[str, str]]:
    tags: list[dict[str, str]] = []
    if any(card["changePercent"] < -5 for card in summary_cards):
        tags.append({"label": "降赔升温", "tone": "success"})
    if alerts:
        tags.append({"label": "盘口异动", "tone": "warning"})
    if any(alert["level"] == "高风险" for alert in alerts):
        tags.append({"label": "高风险", "tone": "danger"})
    return tags or [{"label": "数据更新", "tone": "neutral"}]


def build_direction(connection: sqlite3.Connection, meta: dict[str, Any]) -> str:
    preferred_market = resolve_actual_market_type(connection, meta, "1x2")
    rows = latest_rows(connection, meta, preferred_market) if preferred_market else latest_rows(connection, meta)
    if not rows:
        return "暂无真实赔率数据"
    row = rows[0]
    option = localize_match_text(meta, row["option_name"])
    change_percent = float(row["change_percent"])
    if change_percent < 0:
        return f"市场偏向 {option}"
    if change_percent > 0:
        return f"市场降低 {option} 热度"
    return f"{option} 方向暂稳"


def build_market_summary(connection: sqlite3.Connection, meta: dict[str, Any]) -> str:
    rows = latest_rows(connection, meta)[:3]
    if not rows:
        return "SQLite 暂无采集数据，前端会保留本地 mock 数据作为兜底。"
    parts = [
        f"{row['market_type']} {localize_match_text(meta, row['option_name'])} 变化 {float(row['change_percent']):+.1f}%"
        for row in rows
    ]
    return "；".join(parts)


def build_match_data(meta: dict[str, Any]) -> dict[str, Any]:
    try:
        with connect_readonly() as connection:
            if not has_snapshots_table(connection):
                raise HTTPException(status_code=404, detail="odds_snapshots table not found")
            home = str(meta.get("homeTeam") or "")
            away = str(meta.get("awayTeam") or "")
            markets = {
                market_key: build_market_data(connection, meta, market_key)
                for market_key in MARKET_ORDER
            }
            summary_cards = build_summary_cards(connection, meta)
            alerts = build_alerts(connection, meta)
            updated_at = meta["collectedAt"] or meta["pageUpdatedAt"]
            match_time = meta.get("matchTime")
            return {
                "id": meta["id"],
                "name": meta["name"],
                "englishName": meta.get("englishName"),
                "homeTeam": home,
                "awayTeam": away,
                "homeTeamEnglish": meta.get("homeTeamEnglish"),
                "awayTeamEnglish": meta.get("awayTeamEnglish"),
                "matchTime": (
                    f"比赛时间 {format_datetime(str(match_time))}"
                    if match_time
                    else f"数据更新 {format_datetime(updated_at)}"
                ),
                "score": "未开赛",
                "status": "未开赛",
                "direction": build_direction(connection, meta),
                "tags": build_tags(alerts, summary_cards),
                "dataSource": "sgodds SQLite",
                "updatedAt": format_datetime(updated_at),
                "league": meta.get("league"),
                "matchNo": meta.get("matchNo"),
                "sourceType": meta.get("sourceType"),
                "marketSummary": build_market_summary(connection, meta),
                "summaryCards": summary_cards,
                "markets": markets,
                "alerts": alerts,
            }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"database not found: {exc}") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"database error: {exc}") from exc


@app.get("/api/health")
def health() -> dict[str, Any]:
    path = database_path()
    database_exists = path.exists()
    table_exists = False
    match_count = 0
    if database_exists:
        try:
            with connect_readonly() as connection:
                table_exists = has_snapshots_table(connection)
                if table_exists:
                    row = connection.execute(
                        "SELECT COUNT(DISTINCT match_name || '|' || match_url) AS count FROM odds_snapshots"
                    ).fetchone()
                    match_count = int(row["count"] or 0)
        except sqlite3.Error:
            table_exists = False

    return {
        "status": "ok",
        "databasePath": str(path),
        "databaseExists": database_exists,
        "tableExists": table_exists,
        "matchCount": match_count,
    }


@app.get("/api/matches")
def matches() -> list[dict[str, Any]]:
    return [build_match_data(meta) for meta in list_match_metas()]


@app.get("/api/matches/{match_id}")
def match_detail(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")
    return build_match_data(meta)


@app.get("/api/matches/{match_id}/markets")
def match_markets(match_id: str) -> list[dict[str, Any]]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            rows = available_market_rows(connection, meta)
    except (FileNotFoundError, sqlite3.Error):
        return []

    return [
        {
            "key": market_key_for_type(row["market_type"]),
            "label": MARKET_DEFINITIONS.get(market_key_for_type(row["market_type"]) or "", {}).get(
                "label",
                row["market_type"],
            ),
            "marketType": row["market_type"],
            "rowCount": row["row_count"],
        }
        for row in rows
    ]


@app.get("/api/matches/{match_id}/odds")
def match_odds(
    match_id: str,
    market: str | None = Query(default="1X2"),
) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    market_key = normalize_market_key(market)
    try:
        with connect_readonly() as connection:
            home = str(meta.get("homeTeam") or "")
            away = str(meta.get("awayTeam") or "")
            series = build_market_data(connection, meta, market_key)
            return {
                "matchId": meta["id"],
                "market": market_key,
                "series": series,
                "rows": build_table_rows(series, home, away),
            }
    except (FileNotFoundError, sqlite3.Error):
        definition = MARKET_DEFINITIONS[market_key]
        return {
            "matchId": meta["id"],
            "market": market_key,
            "series": {
                "key": market_key,
                "label": definition["label"],
                "description": definition["description"],
                "selections": [],
            },
            "rows": [],
        }


@app.get("/api/matches/{match_id}/summary")
def match_summary(match_id: str) -> list[dict[str, Any]]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_summary_cards(connection, meta)
    except (FileNotFoundError, sqlite3.Error):
        return []


@app.get("/api/matches/{match_id}/alerts")
def match_alerts(match_id: str) -> list[dict[str, Any]]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_alerts(connection, meta)
    except (FileNotFoundError, sqlite3.Error):
        return []


@app.get("/api/matches/{match_id}/raw")
def match_raw_rows(
    match_id: str,
    market: str | None = Query(default=None),
) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    market_key = normalize_market_key(market) if market else None
    try:
        with connect_readonly() as connection:
            rows = query_snapshot_rows(connection, meta, market_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"database not found: {exc}") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"database error: {exc}") from exc

    return {
        "matchId": meta["id"],
        "market": market_key or "all",
        "rows": snapshot_rows_to_dicts(rows),
    }


@app.get("/api/matches/{match_id}/export.csv")
def export_match_csv(
    match_id: str,
    market: str | None = Query(default=None),
) -> Response:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    market_key = normalize_market_key(market) if market else None
    try:
        with connect_readonly() as connection:
            rows = query_snapshot_rows(connection, meta, market_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"database not found: {exc}") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"database error: {exc}") from exc

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "collected_at",
            "page_updated_at",
            "match_name",
            "match_url",
            "market_type",
            "option_name",
            "opening_odds",
            "current_odds",
            "change_percent",
            "raw_html_path",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["collected_at"],
                row["page_updated_at"],
                row["match_name"],
                row["match_url"],
                row["market_type"],
                row["option_name"],
                row["opening_odds"],
                row["current_odds"],
                row["change_percent"],
                row["raw_html_path"],
            ]
        )

    filename = f"odds_{match_id}_{market_key or 'all'}.csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/matches/{match_id}/chart.png")
def export_match_chart(
    match_id: str,
    market: str | None = Query(default="1x2"),
) -> Response:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    market_key = normalize_market_key(market)
    try:
        with connect_readonly() as connection:
            market_data = build_market_data(connection, meta, market_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"database not found: {exc}") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"database error: {exc}") from exc

    if not market_data["selections"]:
        raise HTTPException(status_code=404, detail="market data not found")

    import matplotlib

    matplotlib.use("Agg")
    matplotlib.rcParams["font.sans-serif"] = [
        "Microsoft YaHei",
        "SimHei",
        "Noto Sans CJK SC",
        "Arial Unicode MS",
        "DejaVu Sans",
    ]
    matplotlib.rcParams["axes.unicode_minus"] = False
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(10, 5.5))
    for selection in market_data["selections"]:
        points = selection["points"]
        ax.plot(
            [point["time"] for point in points],
            [point["odds"] for point in points],
            marker="o",
            linewidth=1.8,
            label=selection["option"],
        )

    ax.set_title(f"{meta['name']} - {market_data['label']}")
    ax.set_xlabel("Time")
    ax.set_ylabel("Odds")
    ax.grid(True, linestyle="--", alpha=0.35)
    ax.legend()
    fig.tight_layout()

    image = io.BytesIO()
    fig.savefig(image, format="png", dpi=150)
    plt.close(fig)
    image.seek(0)

    filename = f"odds_{match_id}_{market_key}.png"
    return Response(
        content=image.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/discovery/matches")
def discovery_matches(days: int = Query(default=7, ge=1, le=14)) -> dict[str, Any]:
    try:
        config = load_config_document()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"config read failed: {exc}") from exc

    try:
        response = requests.get(CURRENT_ODDS_URL, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"sgodds discovery failed: {exc}") from exc

    today = sg_today()
    target_dates = [today + timedelta(days=offset) for offset in range(1, days + 1)]
    groups = []
    for target_date in target_dates:
        matches = parse_current_odds_matches(response.text, target_date)
        groups.append(
            {
                "date": target_date.isoformat(),
                "matches": [discovery_match_to_dict(match, config) for match in matches],
            }
        )

    return {
        "source": CURRENT_ODDS_URL,
        "timezone": "Asia/Singapore",
        "days": days,
        "dates": groups,
    }


@app.post("/api/config/matches")
def add_config_match(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    url = str(payload.get("url", "")).strip()
    name = str(payload.get("name", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
    if not name:
        name = re.sub(r"[-_]+", " ", url.rstrip("/").split("/")[-1]).strip() or url

    try:
        config = load_config_document()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"config read failed: {exc}") from exc

    matches = config.setdefault("matches", [])
    hidden_matches = config.setdefault("hidden_matches", [])
    normalized_matches = [match for match in (normalize_config_match(item) for item in matches) if match is not None]
    hidden_matches[:] = [
        hidden_match
        for hidden_match in hidden_matches
        if not (
            (normalized_hidden := normalize_hidden_match(hidden_match)) is not None
            and normalized_hidden["url"] == url
        )
    ]
    for existing_match in normalized_matches:
        if existing_match["url"] == url:
            try:
                write_config_document(config)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc
            return {
                "status": "exists",
                "message": "监控比赛已存在",
                "match": existing_match,
                "matches": normalized_matches,
            }

    match = {"name": name, "url": url}
    for payload_key, config_key in (
        ("matchTime", "matchTime"),
        ("match_time", "matchTime"),
        ("league", "league"),
        ("matchNo", "matchNo"),
        ("match_no", "matchNo"),
    ):
        value = str(payload.get(payload_key, "")).strip()
        if value:
            match[config_key] = value
    matches.append(match)
    try:
        write_config_document(config)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc

    return {
        "status": "added",
        "message": "监控比赛已添加，采集程序会在下一轮读取配置",
        "match": match,
        "matches": [*normalized_matches, match],
    }


@app.delete("/api/config/matches/{match_id}")
def hide_config_match(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        config = load_config_document()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"config read failed: {exc}") from exc

    target_url = str(meta["url"])
    matches = config.setdefault("matches", [])
    hidden_matches = config.setdefault("hidden_matches", [])
    kept_matches: list[Any] = []
    for raw_match in matches:
        normalized = normalize_config_match(raw_match)
        if normalized is not None and normalized["url"] == target_url:
            continue
        kept_matches.append(raw_match)
    config["matches"] = kept_matches

    normalized_hidden = [
        hidden_match
        for hidden_match in (normalize_hidden_match(item) for item in hidden_matches)
        if hidden_match is not None and hidden_match["url"] != target_url
    ]
    hidden_match = {
        "name": str(meta.get("englishName") or meta.get("name") or ""),
        "nameZh": str(meta.get("name") or ""),
        "url": target_url,
        "hiddenAt": datetime.now(SG_TIMEZONE).isoformat(timespec="seconds"),
        "reason": "user_hidden",
    }
    config["hidden_matches"] = [*normalized_hidden, hidden_match]

    try:
        write_config_document(config)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc

    return {
        "status": "hidden",
        "message": "比赛已隐藏并停止后续采集，历史数据已保留",
        "match": hidden_match,
    }
