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
    match_status_for_time,
    parse_current_odds_matches,
)
from backend.services.insight_service import build_match_insights
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
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
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
            "dashboard_hidden_matches": [],
            "paused_matches": [],
        }

    with DEFAULT_CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not isinstance(config.get("matches"), list):
        config["matches"] = []
    if not isinstance(config.get("hidden_matches"), list):
        config["hidden_matches"] = []
    if not isinstance(config.get("dashboard_hidden_matches"), list):
        config["dashboard_hidden_matches"] = []
    if not isinstance(config.get("paused_matches"), list):
        config["paused_matches"] = []
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


def has_table(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
        """,
        (table_name,),
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
    config: dict[str, Any] = {"matches": [], "hidden_matches": []}
    hidden_urls: set[str] = set()
    paused_urls: set[str] = set()
    try:
        config = load_config_document()
        hidden_urls = dashboard_hidden_match_urls(config)
        paused_urls = paused_match_urls(config)
    except (OSError, json.JSONDecodeError):
        hidden_urls = set()
        paused_urls = set()

    rows: list[sqlite3.Row] = []
    try:
        with connect_readonly() as connection:
            if not has_snapshots_table(connection):
                return configured_match_metas(config, set())
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
        return configured_match_metas(config, set())

    metas: list[dict[str, Any]] = []
    existing_urls: set[str] = set()
    for row in rows:
        match_url = row["match_url"]
        if match_url in hidden_urls:
            continue
        existing_urls.add(match_url)
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
                "paused": match_url in paused_urls,
            }
        )
    metas.extend(configured_match_metas(config, existing_urls))
    def meta_sort_key(meta: dict[str, Any]) -> tuple[float, str]:
        parsed = parse_time(str(meta.get("matchTime") or ""))
        return (parsed.timestamp() if parsed else float("inf"), str(meta.get("name") or ""))

    return sorted(metas, key=meta_sort_key)


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
    limit: int | None = None,
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

    params: list[Any] = [snapshot_match_name(meta), meta["url"], actual_market_type]
    if limit:
        rows = connection.execute(
            """
            WITH limited AS (
                SELECT
                    id,
                    collected_at,
                    option_name,
                    opening_odds,
                    current_odds
                FROM odds_snapshots
                WHERE match_name = ? AND match_url = ? AND market_type = ?
                ORDER BY collected_at DESC, id DESC
                LIMIT ?
            )
            SELECT collected_at, option_name, opening_odds, current_odds
            FROM limited
            ORDER BY collected_at, id
            """,
            (*params, limit),
        ).fetchall()
    else:
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
            params,
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


def match_url_set(config: dict[str, Any], key: str) -> set[str]:
    return {
        str(match["url"])
        for match in (
            normalize_hidden_match(item)
            for item in config.get(key, [])
        )
        if match is not None
    }


def legacy_hidden_match_urls(config: dict[str, Any]) -> set[str]:
    return match_url_set(config, "hidden_matches")


def dashboard_hidden_match_urls(config: dict[str, Any]) -> set[str]:
    return legacy_hidden_match_urls(config) | match_url_set(config, "dashboard_hidden_matches")


def paused_match_urls(config: dict[str, Any]) -> set[str]:
    return legacy_hidden_match_urls(config) | match_url_set(config, "paused_matches")


def hidden_match_urls(config: dict[str, Any]) -> set[str]:
    return dashboard_hidden_match_urls(config)


def configured_match_metas(config: dict[str, Any], existing_urls: set[str]) -> list[dict[str, Any]]:
    hidden_urls = dashboard_hidden_match_urls(config)
    paused_urls = paused_match_urls(config)
    metas: list[dict[str, Any]] = []
    for raw_match in config.get("matches", []):
        match = normalize_config_match(raw_match)
        if match is None:
            continue
        url = str(match["url"])
        if url in hidden_urls or url in existing_urls:
            continue
        name_en = str(match.get("name") or "").strip() or re.sub(r"[-_]+", " ", url.rstrip("/").split("/")[-1]).strip()
        home_en, away_en = parse_match_teams(name_en)
        home_zh = translate_team(home_en) if home_en else ""
        away_zh = translate_team(away_en) if away_en else ""
        metas.append(
            {
                "id": f"{slugify(name_en)}-{match_hash(url)}",
                "legacyId": slugify(name_en),
                "snapshotName": name_en,
                "name": translate_match_name(name_en),
                "englishName": name_en,
                "url": url,
                "homeTeam": home_zh,
                "awayTeam": away_zh,
                "homeTeamEnglish": home_en,
                "awayTeamEnglish": away_en,
                "matchTime": match.get("matchTime"),
                "league": match.get("league"),
                "matchNo": match.get("matchNo"),
                "sourceType": "manual",
                "collectedAt": None,
                "pageUpdatedAt": None,
                "rowCount": 0,
                "paused": url in paused_urls,
            }
        )
    return metas


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
    hidden_urls = dashboard_hidden_match_urls(config)
    paused_urls = paused_match_urls(config)
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
        "paused": match.url in paused_urls,
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


def market_weight(market_type: str, option_name: str) -> dict[str, str | int]:
    market_text = f"{market_type} {option_name}".lower()
    market_key = market_key_for_type(market_type)
    if "any other" in market_text or "correct score" in market_text or "pick the score" in market_text:
        return {"label": "低流动性", "rank": 1, "confidence": "低"}
    if re.search(r"\b(?:7|8|9\+?|10\+?)\b", market_text) and "total goal" in market_text:
        return {"label": "低流动性", "rank": 1, "confidence": "低"}
    if market_key in {"1x2", "asian", "totals"}:
        return {"label": "核心", "rank": 3, "confidence": "高"}
    if market_key == "btts" or "halftime" in market_text or "half-time" in market_text or "total goal" in market_text:
        return {"label": "中等", "rank": 2, "confidence": "中"}
    return {"label": "低流动性", "rank": 1, "confidence": "低"}


def alert_level(change_percent: float, weight_rank: int = 3) -> str:
    absolute_change = abs(change_percent)
    if weight_rank <= 1:
        return "重要" if absolute_change >= 30 else "普通"
    if absolute_change >= 15 and weight_rank >= 2:
        return "高风险"
    if absolute_change >= 8:
        return "重要"
    return "普通"


def risk_payload(row: sqlite3.Row) -> dict[str, str]:
    weight = market_weight(row["market_type"], row["option_name"])
    change_percent = float(row["change_percent"])
    level = alert_level(change_percent, int(weight["rank"]))
    confirmation = (
        "需要确认胜平负、亚洲让球或大小球是否同步变化。"
        if weight["label"] == "低流动性"
        else "继续观察相邻时间点是否延续同方向变化。"
    )
    return {
        "riskLevel": level,
        "confidence": str(weight["confidence"]),
        "marketWeight": str(weight["label"]),
        "triggerReason": f"{row['market_type']} {row['option_name']} 变化 {change_percent:+.1f}%",
        "confirmationNeeded": confirmation,
    }


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
        risk = risk_payload(row)
        alerts.append(
            {
                "id": slugify(
                    f"{meta['id']}-{row['market_type']}-{option}-{row['collected_at']}",
                    "alert",
                ),
                "time": format_point_time(row["collected_at"]),
                "level": risk["riskLevel"],
                "message": (
                    f"{row['market_type']} {localize_match_text(meta, option)} 从 {float(row['opening_odds']):.2f} "
                    f"到 {float(row['current_odds']):.2f}，变化 {change_percent:+.1f}%。"
                    f" 市场权重：{risk['marketWeight']}；置信度：{risk['confidence']}；"
                    f"需要确认：{risk['confirmationNeeded']}"
                ),
                **risk,
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
    rows = sorted(
        latest_rows(connection, meta),
        key=lambda row: (int(market_weight(row["market_type"], row["option_name"])["rank"]), abs(float(row["change_percent"]))),
        reverse=True,
    )[:3]
    if not rows:
        return "暂无真实盘口采集数据，当前无法评估市场方向。"
    parts = [
        (
            f"{row['market_type']} {localize_match_text(meta, row['option_name'])} "
            f"变化 {float(row['change_percent']):+.1f}%"
            f"（{market_weight(row['market_type'], row['option_name'])['label']}）"
        )
        for row in rows
    ]
    return "；".join(parts)


def empty_market_data(market_key: str) -> dict[str, Any]:
    definition = MARKET_DEFINITIONS[market_key]
    return {
        "key": market_key,
        "label": definition["label"],
        "description": definition["description"],
        "selections": [],
    }


def empty_markets() -> dict[str, dict[str, Any]]:
    return {market_key: empty_market_data(market_key) for market_key in MARKET_ORDER}


def build_data_completeness(connection: sqlite3.Connection, meta: dict[str, Any]) -> dict[str, Any]:
    match_id = str(meta["id"])
    checks = [
        ("盘口数据", 30, has_snapshots_table(connection) and int(meta.get("rowCount") or 0) > 0),
        (
            "首发数据",
            20,
            count_source_rows(connection, "lineup_players", match_id) > 0
            or count_source_rows(connection, "match_lineups", match_id) > 0,
        ),
        ("事件数据", 20, count_source_rows(connection, "match_events", match_id) > 0),
        (
            "技术统计",
            15,
            count_source_rows(connection, "match_stats", match_id) > 0
            or count_source_rows(connection, "match_live_stats", match_id) > 0,
        ),
        (
            "伤停数据",
            10,
            count_source_rows(connection, "injuries_suspensions", match_id) > 0
            or count_source_rows(connection, "match_injuries", match_id) > 0,
        ),
        ("小组积分", 5, len(query_group_standings(connection, meta)) > 0),
    ]
    score = sum(weight for _label, weight, present in checks if present)
    missing = [label for label, _weight, present in checks if not present]
    return {
        "score": score,
        "maxScore": 100,
        "missing": missing,
        "label": f"{score}/100",
    }


def build_match_payload(
    meta: dict[str, Any],
    *,
    direction: str,
    tags: list[dict[str, str]],
    data_source: str,
    updated_at: str,
    market_summary: str,
    summary_cards: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    data_completeness: dict[str, Any],
) -> dict[str, Any]:
    match_time = meta.get("matchTime")
    match_status = match_status_for_time(str(match_time) if match_time else None)
    return {
        "id": meta["id"],
        "name": meta["name"],
        "englishName": meta.get("englishName"),
        "homeTeam": meta.get("homeTeam") or "",
        "awayTeam": meta.get("awayTeam") or "",
        "homeTeamEnglish": meta.get("homeTeamEnglish"),
        "awayTeamEnglish": meta.get("awayTeamEnglish"),
        "scheduledAt": format_datetime(str(match_time)) if match_time else None,
        "matchTime": (
            f"比赛时间 {format_datetime(str(match_time))}"
            if match_time
            else f"数据更新 {updated_at}"
        ),
        "score": match_status,
        "status": match_status,
        "direction": direction,
        "tags": tags,
        "dataSource": data_source,
        "updatedAt": updated_at,
        "league": meta.get("league"),
        "matchNo": meta.get("matchNo"),
        "sourceType": meta.get("sourceType"),
        "paused": bool(meta.get("paused")),
        "marketSummary": market_summary,
        "summaryCards": summary_cards,
        "markets": empty_markets(),
        "alerts": alerts,
        "dataCompleteness": data_completeness,
    }


def build_pending_match_data(meta: dict[str, Any]) -> dict[str, Any]:
    match_time = meta.get("matchTime")
    updated_at = meta.get("collectedAt") or meta.get("pageUpdatedAt") or match_time
    return build_match_payload(
        meta,
        direction="等待盘口采集",
        tags=[{"label": "等待采集", "tone": "neutral"}],
        data_source="config monitor",
        updated_at=format_datetime(str(updated_at)) if updated_at else "等待采集",
        market_summary="该比赛已加入监控列表，等待采集程序写入 odds_snapshots。",
        summary_cards=[],
        alerts=[],
        data_completeness={"score": 0, "maxScore": 100, "missing": ["盘口数据"], "label": "0/100"},
    )


def build_match_data(meta: dict[str, Any]) -> dict[str, Any]:
    try:
        with connect_readonly() as connection:
            if not has_snapshots_table(connection):
                return build_pending_match_data(meta)
            summary_cards = build_summary_cards(connection, meta)
            alerts = build_alerts(connection, meta)
            updated_at = meta["collectedAt"] or meta["pageUpdatedAt"]
            return build_match_payload(
                meta,
                direction=build_direction(connection, meta),
                tags=build_tags(alerts, summary_cards),
                data_source="sgodds SQLite",
                updated_at=format_datetime(updated_at),
                market_summary=build_market_summary(connection, meta),
                summary_cards=summary_cards,
                alerts=alerts,
                data_completeness=build_data_completeness(connection, meta),
            )
    except FileNotFoundError as exc:
        if int(meta.get("rowCount") or 0) == 0:
            return build_pending_match_data(meta)
        raise HTTPException(status_code=404, detail=f"database not found: {exc}") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"database error: {exc}") from exc


def json_list(value: str | None) -> list[Any]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def row_get(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    return row[key] if key in row.keys() else default


def api_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def envelope(
    data: Any,
    *,
    source_status: dict[str, Any],
    status: str | None = None,
    updated_at: str | None = None,
    diagnostics: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "data": data,
        "status": "error" if error else status or "ok",
        "sourceStatus": source_status,
        "updatedAt": updated_at,
        "diagnostics": diagnostics or {},
        "error": error,
    }


def match_team_candidates(meta: dict[str, Any]) -> list[str]:
    candidates = [
        meta.get("homeTeam"),
        meta.get("awayTeam"),
        meta.get("homeTeamEnglish"),
        meta.get("awayTeamEnglish"),
    ]
    result: list[str] = []
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def default_lineups_response(match_id: str) -> dict[str, Any]:
    data = {
        "matchId": match_id,
        "lineups": [],
        "explanation": "暂无首发名单数据，等待阵容数据源接入。",
        "dataSource": "empty",
    }
    return envelope(
        data,
        status="empty",
        source_status={"code": "no_rows", "label": "无记录", "reason": "数据库暂无首发记录"},
        updated_at=None,
        diagnostics={"matchId": match_id, "rowCount": 0, "suggestedAction": "检查 match_source_map 或接入 lineup importer"},
    )


def default_injuries_response(match_id: str) -> dict[str, Any]:
    data = {
        "matchId": match_id,
        "injuries": [],
        "summary": {"total": 0, "byTeam": {}},
        "explanation": "伤停数据缺失，当前无法评估伤病影响。",
        "dataSource": "empty",
    }
    return envelope(
        data,
        status="empty",
        source_status={"code": "not_configured", "label": "未配置", "reason": "当前未配置伤停数据源"},
        updated_at=None,
        diagnostics={"matchId": match_id, "rowCount": 0, "suggestedAction": "接入 injuries_suspensions 数据源"},
    )


def default_group_standing_response(match_id: str) -> dict[str, Any]:
    data = {
        "matchId": match_id,
        "teams": [],
        "explanation": "暂无小组积分数据，出线压力和净胜球动力等待数据源补充。",
        "dataSource": "empty",
    }
    return envelope(
        data,
        status="empty",
        source_status={"code": "no_rows", "label": "无记录", "reason": "数据库暂无小组积分记录"},
        updated_at=None,
        diagnostics={"matchId": match_id, "rowCount": 0, "suggestedAction": "接入 group_standings 数据源"},
    )


def default_live_stats_response(match_id: str) -> dict[str, Any]:
    data = {
        "matchId": match_id,
        "timeline": [],
        "latest": [],
        "explanation": "技术统计数据缺失，当前无法评估真实压制质量。",
        "dataSource": "empty",
    }
    return envelope(
        data,
        status="empty",
        source_status={"code": "no_rows", "label": "无记录", "reason": "数据库暂无技术统计记录"},
        updated_at=None,
        diagnostics={"matchId": match_id, "rowCount": 0, "suggestedAction": "接入 match_stats 数据源"},
    )


def default_events_response(match_id: str) -> dict[str, Any]:
    data = {
        "matchId": match_id,
        "events": [],
        "explanation": "暂无比赛事件，等待事件数据源接入。",
        "dataSource": "empty",
    }
    return envelope(
        data,
        status="empty",
        source_status={"code": "no_rows", "label": "无记录", "reason": "数据库暂无比赛事件记录"},
        updated_at=None,
        diagnostics={"matchId": match_id, "rowCount": 0, "suggestedAction": "接入 match_events importer"},
    )


def lineup_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "matchId": row["match_id"],
        "collectedAt": row_get(row, "collected_at") or row_get(row, "fetched_at") or row_get(row, "updated_at"),
        "teamName": row_get(row, "team_name"),
        "formation": row_get(row, "formation"),
        "lineupConfirmed": bool(row_get(row, "lineup_confirmed")) or row_get(row, "status") in {"confirmed", "official"},
        "status": row_get(row, "status"),
        "publishedAt": row_get(row, "published_at"),
        "source": row_get(row, "source"),
        "externalMatchId": row_get(row, "external_match_id"),
        "starters": json_list(row_get(row, "starters_json")),
        "substitutes": json_list(row_get(row, "substitutes_json")),
        "keyPlayersMissing": json_list(row_get(row, "key_players_missing_json")),
        "sourceUrl": row_get(row, "source_url"),
    }


def injury_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "matchId": row["match_id"],
        "collectedAt": row_get(row, "collected_at") or row_get(row, "fetched_at") or row_get(row, "updated_at"),
        "teamName": row_get(row, "team_name") or row_get(row, "team_side"),
        "teamSide": row_get(row, "team_side"),
        "playerName": row["player_name"],
        "status": row_get(row, "status") or row_get(row, "type"),
        "reason": row_get(row, "reason"),
        "expectedReturn": row_get(row, "expected_return"),
        "source": row_get(row, "source"),
        "sourceUrl": row_get(row, "source_url"),
    }


def standing_row_to_dict(row: sqlite3.Row, rank: int | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "groupName": row["group_name"],
        "teamName": row["team_name"],
        "collectedAt": row_get(row, "collected_at") or row_get(row, "fetched_at") or row_get(row, "updated_at"),
        "rank": row_get(row, "rank", rank) or rank,
        "points": int(row["points"] or 0),
        "played": int(row["played"] or 0),
        "wins": int(row_get(row, "wins", row_get(row, "won", 0)) or 0),
        "draws": int(row_get(row, "draws", row_get(row, "drawn", 0)) or 0),
        "losses": int(row_get(row, "losses", row_get(row, "lost", 0)) or 0),
        "goalsFor": int(row["goals_for"] or 0),
        "goalsAgainst": int(row["goals_against"] or 0),
        "goalDifference": int(row["goal_difference"] or 0),
        "motivationLevel": row_get(row, "motivation_level") or row_get(row, "qualification_status"),
        "motivationText": row_get(row, "motivation_text") or row_get(row, "qualification_status"),
        "qualificationStatus": row_get(row, "qualification_status"),
        "source": row_get(row, "source"),
    }


def live_stat_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "matchId": row["match_id"],
        "externalMatchId": row_get(row, "external_match_id"),
        "collectedAt": row_get(row, "collected_at") or row_get(row, "stat_time") or row_get(row, "updated_at"),
        "minute": row_get(row, "minute"),
        "teamName": row_get(row, "team_name") or row_get(row, "team_side"),
        "teamSide": row_get(row, "team_side"),
        "possession": row_get(row, "possession"),
        "shots": row_get(row, "shots"),
        "shotsOnTarget": row_get(row, "shots_on_target"),
        "shotsOffTarget": row_get(row, "shots_off_target"),
        "blockedShots": row_get(row, "blocked_shots"),
        "corners": row_get(row, "corners"),
        "attacks": row_get(row, "attacks"),
        "dangerousAttacks": row_get(row, "dangerous_attacks"),
        "fouls": row_get(row, "fouls"),
        "offsides": row_get(row, "offsides"),
        "totalPasses": row_get(row, "total_passes"),
        "accuratePasses": row_get(row, "accurate_passes"),
        "passAccuracy": row_get(row, "pass_accuracy"),
        "xg": row_get(row, "xg"),
        "yellowCards": row_get(row, "yellow_cards"),
        "redCards": row_get(row, "red_cards"),
        "source": row_get(row, "source"),
    }


def event_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "matchId": row["match_id"],
        "eventTime": row["event_time"],
        "minute": row["minute"],
        "stoppageMinute": row_get(row, "stoppage_minute"),
        "teamName": row_get(row, "team_name") or row_get(row, "team_side"),
        "teamSide": row_get(row, "team_side"),
        "eventType": row["event_type"],
        "playerName": row_get(row, "player_name"),
        "relatedPlayerName": row_get(row, "related_player_name"),
        "description": row_get(row, "description"),
        "source": row_get(row, "source"),
        "externalMatchId": row_get(row, "external_match_id"),
        "externalEventId": row_get(row, "external_event_id"),
        "raw": json_object(row_get(row, "raw_json")),
    }


def link_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = {
        "id": row["id"],
        "matchId": row["match_id"],
        "collectedAt": row["collected_at"],
        "oddsSnapshotId": row["odds_snapshot_id"],
        "eventId": row["event_id"],
        "linkType": row["link_type"],
        "explanation": row["explanation"],
        "confidence": float(row["confidence"] or 0),
    }
    if "event_type" in row.keys() and row["event_type"]:
        item["event"] = {
            "eventType": row["event_type"],
            "minute": row["event_minute"],
            "teamName": row["event_team_name"],
            "description": row["event_description"],
        }
    return item


def query_match_lineups(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if has_table(connection, "lineup_players"):
        player_rows = connection.execute(
            """
            SELECT *
            FROM lineup_players
            WHERE match_id = ?
            ORDER BY team_side, is_starting DESC, COALESCE(sort_order, id), id
            """,
            (match_id,),
        ).fetchall()
        if player_rows:
            lineup_meta = None
            if has_table(connection, "match_lineups"):
                lineup_meta = connection.execute(
                    """
                    SELECT *
                    FROM match_lineups
                    WHERE match_id = ?
                    ORDER BY COALESCE(updated_at, fetched_at, collected_at, published_at) DESC, id DESC
                    LIMIT 1
                    """,
                    (match_id,),
                ).fetchone()
            teams: OrderedDict[str, dict[str, Any]] = OrderedDict()
            for row in player_rows:
                side = str(row_get(row, "team_side") or "unknown")
                team_name = str(row_get(row, "team_name") or row_get(row, "team_id") or side or "未知球队")
                item = teams.setdefault(
                    side,
                    {
                        "id": row_get(row, "lineup_id"),
                        "matchId": match_id,
                        "collectedAt": row_get(lineup_meta, "fetched_at") if lineup_meta else row_get(row, "updated_at"),
                        "teamName": team_name,
                        "teamSide": side,
                        "formation": row_get(lineup_meta, "home_formation" if side == "home" else "away_formation") if lineup_meta else None,
                        "lineupConfirmed": row_get(lineup_meta, "status") in {"confirmed", "official"} if lineup_meta else True,
                        "status": row_get(lineup_meta, "status") if lineup_meta else None,
                        "publishedAt": row_get(lineup_meta, "published_at") if lineup_meta else None,
                        "source": row_get(lineup_meta, "source") or row_get(row, "source") if lineup_meta else row_get(row, "source"),
                        "externalMatchId": row_get(lineup_meta, "external_match_id") if lineup_meta else None,
                        "starters": [],
                        "substitutes": [],
                        "keyPlayersMissing": [],
                    },
                )
                player = {
                    "name": row["player_name"],
                    "playerId": row_get(row, "player_id"),
                    "shirtNumber": row_get(row, "shirt_number"),
                    "position": row_get(row, "position"),
                    "isCaptain": bool(row_get(row, "is_captain")),
                    "sortOrder": row_get(row, "sort_order"),
                }
                if bool(row_get(row, "is_starting")):
                    item["starters"].append(player)
                else:
                    item["substitutes"].append(player)
            return list(teams.values())

    if not has_table(connection, "match_lineups"):
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM match_lineups
        WHERE match_id = ?
          AND collected_at = (
              SELECT MAX(collected_at)
              FROM match_lineups
              WHERE match_id = ?
          )
        ORDER BY team_name, id
        """,
        (match_id, match_id),
    ).fetchall()
    return [lineup_row_to_dict(row) for row in rows]


def query_match_injuries(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if has_table(connection, "injuries_suspensions"):
        rows = connection.execute(
            """
            SELECT *
            FROM injuries_suspensions
            WHERE match_id = ?
            ORDER BY team_side, type, player_name
            """,
            (match_id,),
        ).fetchall()
        if rows:
            return [injury_row_to_dict(row) for row in rows]

    if not has_table(connection, "match_injuries"):
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM match_injuries
        WHERE match_id = ?
          AND collected_at = (
              SELECT MAX(collected_at)
              FROM match_injuries
              WHERE match_id = ?
          )
        ORDER BY team_name, status, player_name
        """,
        (match_id, match_id),
    ).fetchall()
    return [injury_row_to_dict(row) for row in rows]


def injury_summary(injuries: list[dict[str, Any]]) -> dict[str, Any]:
    by_team: dict[str, int] = {}
    for injury in injuries:
        team_name = str(injury.get("teamName") or "未知球队")
        by_team[team_name] = by_team.get(team_name, 0) + 1
    return {"total": len(injuries), "byTeam": by_team}


def query_group_standings(connection: sqlite3.Connection, meta: dict[str, Any]) -> list[dict[str, Any]]:
    team_names = match_team_candidates(meta)
    if not team_names:
        return []
    if has_table(connection, "group_standings"):
        placeholders = ",".join("?" for _ in team_names)
        rows = connection.execute(
            f"""
            SELECT *
            FROM group_standings AS standing
            WHERE standing.team_name IN ({placeholders})
              AND COALESCE(standing.fetched_at, standing.updated_at, standing.created_at, '') = (
                  SELECT MAX(COALESCE(latest.fetched_at, latest.updated_at, latest.created_at, ''))
                  FROM group_standings AS latest
                  WHERE latest.team_name = standing.team_name
              )
            ORDER BY standing.group_name, COALESCE(standing.rank, 99), standing.team_name
            """,
            tuple(team_names),
        ).fetchall()
        if rows:
            return [standing_row_to_dict(row, row_get(row, "rank")) for row in rows]

    if not has_table(connection, "group_standings_snapshots"):
        return []

    placeholders = ",".join("?" for _ in team_names)
    target_rows = connection.execute(
        f"""
        SELECT *
        FROM group_standings_snapshots AS standing
        WHERE standing.team_name IN ({placeholders})
          AND standing.collected_at = (
              SELECT MAX(latest.collected_at)
              FROM group_standings_snapshots AS latest
              WHERE latest.team_name = standing.team_name
          )
        ORDER BY standing.group_name, standing.team_name
        """,
        tuple(team_names),
    ).fetchall()
    if not target_rows:
        return []

    groups = sorted({row["group_name"] for row in target_rows if row["group_name"]})
    group_placeholders = ",".join("?" for _ in groups)
    rank_lookup: dict[tuple[str, str], int] = {}
    if groups:
        group_rows = connection.execute(
            f"""
            SELECT *
            FROM group_standings_snapshots AS standing
            WHERE standing.group_name IN ({group_placeholders})
              AND standing.collected_at = (
                  SELECT MAX(latest.collected_at)
                  FROM group_standings_snapshots AS latest
                  WHERE latest.group_name = standing.group_name
                    AND latest.team_name = standing.team_name
              )
            """,
            tuple(groups),
        ).fetchall()
        grouped: dict[str, list[sqlite3.Row]] = {}
        for row in group_rows:
            grouped.setdefault(row["group_name"], []).append(row)
        for group_name, rows in grouped.items():
            sorted_rows = sorted(
                rows,
                key=lambda row: (
                    int(row["points"] or 0),
                    int(row["goal_difference"] or 0),
                    int(row["goals_for"] or 0),
                ),
                reverse=True,
            )
            for index, row in enumerate(sorted_rows, start=1):
                rank_lookup[(group_name, row["team_name"])] = index

    return [
        standing_row_to_dict(row, rank_lookup.get((row["group_name"], row["team_name"])))
        for row in target_rows
    ]


def query_live_stats(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if has_table(connection, "match_stats"):
        rows = connection.execute(
            """
            SELECT *
            FROM match_stats
            WHERE match_id = ?
            ORDER BY COALESCE(stat_time, updated_at, created_at, ''), COALESCE(minute, 0), team_side, id
            """,
            (match_id,),
        ).fetchall()
        if rows:
            return [live_stat_row_to_dict(row) for row in rows]

    if not has_table(connection, "match_live_stats"):
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM match_live_stats
        WHERE match_id = ?
        ORDER BY collected_at, COALESCE(minute, 0), team_name, id
        """,
        (match_id,),
    ).fetchall()
    return [live_stat_row_to_dict(row) for row in rows]


def latest_live_stats(stats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not stats:
        return []
    latest_collected_at = max(str(row.get("collectedAt") or "") for row in stats)
    latest_rows = [row for row in stats if row.get("collectedAt") == latest_collected_at]
    latest_minute = max((int(row.get("minute") or 0) for row in latest_rows), default=0)
    return [row for row in latest_rows if int(row.get("minute") or 0) == latest_minute]


def query_match_events(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if not has_table(connection, "match_events"):
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM match_events
        WHERE match_id = ?
        ORDER BY event_time, COALESCE(minute, 0), id
        """,
        (match_id,),
    ).fetchall()
    return [event_row_to_dict(row) for row in rows]


def query_odds_event_links(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if not has_table(connection, "odds_event_links"):
        return []
    event_join = ""
    event_columns = """
        NULL AS event_type,
        NULL AS event_minute,
        NULL AS event_team_name,
        NULL AS event_description
    """
    if has_table(connection, "match_events"):
        event_join = "LEFT JOIN match_events AS event ON event.id = link.event_id"
        event_columns = """
            event.event_type AS event_type,
            event.minute AS event_minute,
            event.team_name AS event_team_name,
            event.description AS event_description
        """
    rows = connection.execute(
        f"""
        SELECT
            link.*,
            {event_columns}
        FROM odds_event_links AS link
        {event_join}
        WHERE link.match_id = ?
        ORDER BY link.collected_at DESC, link.id DESC
        """,
        (match_id,),
    ).fetchall()
    return [link_row_to_dict(row) for row in rows]


def query_latest_odds_for_insights(connection: sqlite3.Connection, meta: dict[str, Any]) -> list[dict[str, Any]]:
    if not has_snapshots_table(connection):
        return []
    rows = latest_rows(connection, meta)[:8]
    return [
        {
            "collectedAt": row["collected_at"],
            "marketType": row["market_type"],
            "optionName": localize_match_text(meta, row["option_name"]),
            "openingOdds": float(row["opening_odds"]),
            "currentOdds": float(row["current_odds"]),
            "changePercent": float(row["change_percent"]),
        }
        for row in rows
    ]


def build_lineups_response(match_id: str, lineups: list[dict[str, Any]]) -> dict[str, Any]:
    if not lineups:
        return default_lineups_response(match_id)
    confirmed_count = sum(1 for lineup in lineups if lineup.get("lineupConfirmed"))
    player_count = sum(
        len(lineup.get("starters", [])) + len(lineup.get("substitutes", []))
        for lineup in lineups
    )
    has_partial_lineup = any(str(lineup.get("status") or "").lower() == "partial" for lineup in lineups)
    missing_names = [
        str(player.get("name") if isinstance(player, dict) else player)
        for lineup in lineups
        for player in lineup.get("keyPlayersMissing", [])
        if player
    ]
    if missing_names:
        explanation = f"已发现关键球员缺席：{', '.join(missing_names)}。"
    elif has_partial_lineup or player_count < 22:
        explanation = f"阵容源已返回 {player_count} 名球员，但不是完整首发名单，暂按部分阵容参考。"
    elif confirmed_count:
        explanation = f"{confirmed_count} 支球队首发已确认，暂未发现关键球员缺席。"
    else:
        explanation = "首发名单尚未完全确认，仍需等待赛前阵容更新。"
    data = {
        "matchId": match_id,
        "lineups": lineups,
        "explanation": explanation,
        "dataSource": "sqlite",
    }
    return envelope(
        data,
        source_status={"code": "normal", "label": "正常", "reason": "已读取首发或阵容记录"},
        updated_at=max((str(lineup.get("collectedAt") or lineup.get("publishedAt") or "") for lineup in lineups), default=None),
        diagnostics={
            "matchId": match_id,
            "rowCount": len(lineups),
            "playerCount": player_count,
            "suggestedAction": "核对 starters 是否完整；TheSportsDB 免费接口可能只返回部分阵容",
        },
    )


def build_injuries_response(match_id: str, injuries: list[dict[str, Any]]) -> dict[str, Any]:
    if not injuries:
        return default_injuries_response(match_id)
    summary = injury_summary(injuries)
    data = {
        "matchId": match_id,
        "injuries": injuries,
        "summary": summary,
        "explanation": f"当前记录 {summary['total']} 条伤停信息，需要结合首发名单确认实际影响。",
        "dataSource": "sqlite",
    }
    return envelope(
        data,
        source_status={"code": "normal", "label": "正常", "reason": "已读取伤停记录"},
        updated_at=max((str(item.get("collectedAt") or "") for item in injuries), default=None),
        diagnostics={"matchId": match_id, "rowCount": len(injuries), "suggestedAction": "结合首发名单判断影响"},
    )


def build_group_standing_response(match_id: str, standings: list[dict[str, Any]]) -> dict[str, Any]:
    if not standings:
        return default_group_standing_response(match_id)
    motivated = [
        row
        for row in standings
        if str(row.get("motivationLevel") or "").lower() in {"high", "strong", "must_win"}
        or "净胜球" in str(row.get("motivationText") or "")
        or "抢分" in str(row.get("motivationText") or "")
    ]
    if motivated:
        first = motivated[0]
        explanation = f"{first['teamName']}{first.get('motivationText') or '存在较强抢分动力。'}"
    else:
        explanation = "当前小组积分暂未显示极端出线压力。"
    data = {
        "matchId": match_id,
        "teams": standings,
        "explanation": explanation,
        "dataSource": "sqlite",
    }
    return envelope(
        data,
        source_status={"code": "normal", "label": "正常", "reason": "已读取小组积分记录"},
        updated_at=max((str(item.get("collectedAt") or "") for item in standings), default=None),
        diagnostics={"matchId": match_id, "rowCount": len(standings), "suggestedAction": "确认 group/team 映射是否覆盖双方"},
    )


def build_live_stats_response(match_id: str, stats: list[dict[str, Any]]) -> dict[str, Any]:
    if not stats:
        return default_live_stats_response(match_id)
    latest = latest_live_stats(stats)
    explanation = "赛中技术统计已更新，可结合射正、xG 和危险进攻判断真实压制质量。"
    data = {
        "matchId": match_id,
        "timeline": stats,
        "latest": latest,
        "explanation": explanation,
        "dataSource": "sqlite",
    }
    return envelope(
        data,
        source_status={"code": "normal", "label": "正常", "reason": "已读取技术统计记录"},
        updated_at=max((str(item.get("collectedAt") or "") for item in stats), default=None),
        diagnostics={"matchId": match_id, "rowCount": len(stats), "suggestedAction": "赛中阶段可提高刷新频率"},
    )


def build_events_response(match_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    if not events:
        return default_events_response(match_id)
    data = {
        "matchId": match_id,
        "events": events,
        "explanation": f"已记录 {len(events)} 个比赛事件，可用于和盘口异动做时间线对照。",
        "dataSource": "sqlite",
    }
    return envelope(
        data,
        source_status={"code": "normal", "label": "正常", "reason": "已读取比赛事件记录"},
        updated_at=max((str(item.get("eventTime") or "") for item in events), default=None),
        diagnostics={"matchId": match_id, "rowCount": len(events), "suggestedAction": "对照盘口异动时间点"},
    )


def count_rows(connection: sqlite3.Connection, table_name: str, where_clause: str, params: tuple[Any, ...]) -> int:
    if not has_table(connection, table_name):
        return 0
    row = connection.execute(f"SELECT COUNT(*) AS count FROM {table_name} WHERE {where_clause}", params).fetchone()
    return int(row["count"] or 0)


def max_column_value(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    where_clause: str,
    params: tuple[Any, ...],
) -> str | None:
    if not has_table(connection, table_name):
        return None
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
    if column_name not in columns:
        return None
    row = connection.execute(
        f"SELECT MAX({column_name}) AS value FROM {table_name} WHERE {where_clause}",
        params,
    ).fetchone()
    return str(row["value"]) if row and row["value"] else None


def has_column(connection: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    if not has_table(connection, table_name):
        return False
    return any(row["name"] == column_name for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall())


LEGACY_SOURCE_PREFIX: dict[str, str] = {
    "lineups": "lineup",
    "stats": "stats",
    "events": "events",
    "injuries": "lineup",
    "standings": "standings",
}


def query_match_source_maps(connection: sqlite3.Connection, match_id: str) -> list[dict[str, Any]]:
    if not has_table(connection, "match_source_map"):
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM match_source_map
        WHERE internal_match_id = ?
        ORDER BY CASE WHEN source IS NOT NULL THEN 0 ELSE 1 END,
                 COALESCE(updated_at, created_at, '') DESC,
                 id DESC
        """,
        (match_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def query_match_source_map(connection: sqlite3.Connection, match_id: str) -> dict[str, Any] | None:
    source_maps = query_match_source_maps(connection, match_id)
    return source_maps[0] if source_maps else None


def source_map_for(source_maps: list[dict[str, Any]], source: str, data_type: str) -> dict[str, Any]:
    prefix = LEGACY_SOURCE_PREFIX.get(data_type, data_type)
    for row in source_maps:
        if row.get("source") == source:
            return row
    for row in source_maps:
        if row.get(f"{prefix}_source") == source:
            return row
    return {}


def source_map_external_id(source_map: dict[str, Any], data_type: str) -> str | None:
    prefix = LEGACY_SOURCE_PREFIX.get(data_type, data_type)
    value = source_map.get("external_match_id") or source_map.get(f"{prefix}_external_match_id")
    return str(value) if value else None


def count_source_rows(
    connection: sqlite3.Connection,
    table_name: str,
    match_id: str,
    source: str | None = None,
) -> int:
    if not has_table(connection, table_name):
        return 0
    where = "match_id = ?"
    params: list[Any] = [match_id]
    if source and has_column(connection, table_name, "source"):
        where += " AND source = ?"
        params.append(source)
    return count_rows(connection, table_name, where, tuple(params))


def max_source_column_value(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    match_id: str,
    source: str | None = None,
) -> str | None:
    if not has_table(connection, table_name) or not has_column(connection, table_name, column_name):
        return None
    where = "match_id = ?"
    params: list[Any] = [match_id]
    if source and has_column(connection, table_name, "source"):
        where += " AND source = ?"
        params.append(source)
    return max_column_value(connection, table_name, column_name, where, tuple(params))


def latest_raw_payload(connection: sqlite3.Connection, match_id: str, source: str, data_type: str) -> dict[str, Any] | None:
    if not has_table(connection, "raw_source_payloads"):
        return None
    row = connection.execute(
        """
        SELECT *
        FROM raw_source_payloads
        WHERE internal_match_id = ? AND source = ? AND data_type = ?
        ORDER BY fetched_at DESC, id DESC
        LIMIT 1
        """,
        (match_id, source, data_type),
    ).fetchone()
    return dict(row) if row else None


def query_source_health(connection: sqlite3.Connection, source: str, data_type: str) -> dict[str, Any] | None:
    if not has_table(connection, "source_health"):
        return None
    row = connection.execute(
        """
        SELECT *
        FROM source_health
        WHERE source = ? AND data_type = ?
        """,
        (source, data_type),
    ).fetchone()
    return dict(row) if row else None


def diagnostic_status(row_count: int, configured: bool, external_match_id: str | None, table_exists: bool) -> tuple[str, str, str]:
    if not table_exists:
        return "not_integrated", "未接入", "数据表尚未创建或初始化未执行"
    if row_count > 0:
        return "normal", "正常", "接口已查询到数据库记录"
    if not configured and not external_match_id:
        return "mapping_failed", "未映射", "当前 match_id 没有外部赛事 ID 映射"
    return "no_data", "无数据", "数据源已预留，但当前比赛暂无入库记录"


def raw_payload_has_records(raw_payload: dict[str, Any] | None) -> bool:
    if not raw_payload:
        return False
    try:
        payload = json.loads(str(raw_payload.get("payload_json") or "{}"))
    except json.JSONDecodeError:
        return False
    if isinstance(payload, list):
        return len(payload) > 0
    if isinstance(payload, dict):
        return any(isinstance(value, list) and len(value) > 0 for value in payload.values())
    return False


def source_diagnostic(
    *,
    source_name: str,
    match_id: str,
    row_count: int,
    table_exists: bool,
    configured: bool = False,
    external_match_id: str | None = None,
    last_fetched_at: str | None = None,
    last_ingested_at: str | None = None,
    error: str | None = None,
    source: str | None = None,
    data_type: str | None = None,
    health: dict[str, Any] | None = None,
    raw_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if error:
        code, label, reason = "ingest_failed", "入库失败", error
    elif not configured and not external_match_id:
        if source:
            code, label, reason = "mapping_missing", "缺少映射", "当前 match_id 没有外部赛事 ID 映射"
        else:
            code, label, reason = "not_configured", "未配置", "当前模块没有配置可用数据源"
    elif not table_exists:
        code, label, reason = "not_configured", "未配置", "数据表尚未创建或初始化未执行"
    elif row_count > 0:
        code, label, reason = "normal", "正常", "已读取到真实入库数据"
    elif raw_payload and raw_payload.get("error_message"):
        code, label, reason = "fetch_failed", "请求失败", str(raw_payload.get("error_message"))
    elif health and health.get("last_error_at") and not health.get("last_success_at"):
        code, label, reason = "fetch_failed", "请求失败", str(health.get("last_error_message") or "最近一次采集失败")
    elif raw_payload and raw_payload_has_records(raw_payload):
        code, label, reason = "parse_failed", "解析失败", "数据源返回了记录，但解析或入库后没有目标表记录"
    elif raw_payload or (health and health.get("last_success_at")):
        code, label, reason = "source_empty", "源返回空", "数据源已请求成功，但该模块没有可入库记录"
    else:
        code, label, reason = "no_rows", "无记录", "数据源已配置，但当前比赛暂无入库记录"

    action_by_code = {
        "normal": "继续监控数据刷新",
        "not_configured": "配置数据源并执行 init_db 初始化对应表",
        "mapping_missing": "运行 fetch_match_intelligence.py --auto-map 或补充 match_source_map",
        "fetch_failed": "查看 raw_source_payloads、source_health 和 fetch_job_logs 中的错误信息",
        "source_empty": "确认免费源是否已发布该模块；必要时接 API-Football 或人工源",
        "parse_failed": "检查 normalizer 字段映射和源返回结构",
        "ingest_failed": "查看后端日志并修复 SQL 或数据结构问题",
        "no_rows": "重新运行采集脚本或确认当前比赛是否尚未发布该模块数据",
    }
    return {
        "name": source_name,
        "source": source,
        "dataType": data_type,
        "configured": configured,
        "lastFetchedAt": last_fetched_at or (str(raw_payload.get("fetched_at")) if raw_payload else None),
        "lastIngestedAt": last_ingested_at,
        "lastQueriedAt": api_now(),
        "rowCount": row_count,
        "matchId": match_id,
        "externalMatchId": external_match_id,
        "error": error,
        "status": code,
        "statusLabel": label,
        "reason": reason,
        "suggestedAction": action_by_code.get(code, "继续排查数据链路"),
    }


def build_data_diagnostics(connection: sqlite3.Connection, meta: dict[str, Any]) -> dict[str, Any]:
    match_id = str(meta["id"])
    source_maps = query_match_source_maps(connection, match_id)
    primary_source_map = source_maps[0] if source_maps else {}

    odds_count = 0
    odds_last = None
    if has_snapshots_table(connection):
        odds_count = count_rows(
            connection,
            "odds_snapshots",
            "match_name = ? AND match_url = ?",
            (snapshot_match_name(meta), meta["url"]),
        )
        odds_last = max_column_value(
            connection,
            "odds_snapshots",
            "collected_at",
            "match_name = ? AND match_url = ?",
            (snapshot_match_name(meta), meta["url"]),
        )

    sources = [
        source_diagnostic(
            source_name="odds",
            match_id=match_id,
            row_count=odds_count,
            table_exists=has_snapshots_table(connection),
            configured=True,
            external_match_id=str(meta.get("url") or ""),
            last_fetched_at=odds_last,
            last_ingested_at=odds_last,
            source="sgodds",
            data_type="odds",
        )
    ]

    for data_type, table_name, fallback_table, ingested_column in (
        ("lineups", "lineup_players", "match_lineups", "updated_at"),
        ("stats", "match_stats", "match_live_stats", "updated_at"),
        ("events", "match_events", "", "updated_at"),
    ):
        source = "thesportsdb"
        source_map = source_map_for(source_maps, source, data_type)
        external_match_id = source_map_external_id(source_map, data_type)
        row_count = count_source_rows(connection, table_name, match_id, source)
        if row_count == 0 and fallback_table:
            row_count = count_source_rows(connection, fallback_table, match_id, source)
        raw_payload = latest_raw_payload(connection, match_id, source, data_type)
        health = query_source_health(connection, source, data_type)
        last_ingested = max_source_column_value(connection, table_name, ingested_column, match_id, source)
        if last_ingested is None and fallback_table:
            last_ingested = max_source_column_value(connection, fallback_table, ingested_column, match_id, source)
        sources.append(
            source_diagnostic(
                source_name=f"{source}:{data_type}",
                source=source,
                data_type=data_type,
                match_id=match_id,
                row_count=row_count,
                table_exists=has_table(connection, table_name) or bool(fallback_table and has_table(connection, fallback_table)),
                configured=bool(external_match_id),
                external_match_id=external_match_id,
                last_fetched_at=str(raw_payload.get("fetched_at")) if raw_payload else None,
                last_ingested_at=last_ingested,
                health=health,
                raw_payload=raw_payload,
            )
        )

    injury_count = count_source_rows(connection, "injuries_suspensions", match_id)
    if injury_count == 0:
        injury_count = count_source_rows(connection, "match_injuries", match_id)
    sources.append(
        source_diagnostic(
            source_name="injuries",
            match_id=match_id,
            row_count=injury_count,
            table_exists=has_table(connection, "injuries_suspensions") or has_table(connection, "match_injuries"),
            configured=False,
            external_match_id=None,
            last_fetched_at=max_source_column_value(connection, "injuries_suspensions", "fetched_at", match_id),
            last_ingested_at=max_source_column_value(connection, "injuries_suspensions", "updated_at", match_id),
            source=None,
            data_type="injuries",
        )
    )

    team_names = match_team_candidates(meta)
    standing_count = 0
    if team_names:
        placeholders = ",".join("?" for _ in team_names)
        standing_count = count_rows(connection, "group_standings", f"team_name IN ({placeholders})", tuple(team_names))
        if standing_count == 0:
            standing_count = count_rows(
                connection,
                "group_standings_snapshots",
                f"team_name IN ({placeholders})",
                tuple(team_names),
            )
    sources.append(
        source_diagnostic(
            source_name="standings",
            match_id=match_id,
            row_count=standing_count,
            table_exists=has_table(connection, "group_standings") or has_table(connection, "group_standings_snapshots"),
            configured=has_table(connection, "group_standings") or has_table(connection, "group_standings_snapshots"),
            external_match_id=None,
            last_fetched_at=max_column_value(connection, "group_standings", "fetched_at", "1 = 1", ()),
            last_ingested_at=max_column_value(connection, "group_standings", "updated_at", "1 = 1", ()),
            source=None,
            data_type="standings",
        )
    )

    external_match_id = source_map_external_id(primary_source_map, "events") or primary_source_map.get("odds_external_match_id") or meta.get("url")
    return {
        "matchId": match_id,
        "externalMatchId": external_match_id,
        "sourceMap": primary_source_map,
        "sourceMaps": source_maps,
        "sources": sources,
        "summary": {
            "normal": sum(1 for item in sources if item["status"] == "normal"),
            "needsAttention": sum(1 for item in sources if item["status"] != "normal"),
        },
        "updatedAt": api_now(),
    }


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
    limit: int = Query(default=300, ge=1, le=2000),
) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    market_key = normalize_market_key(market)
    try:
        with connect_readonly() as connection:
            home = str(meta.get("homeTeam") or "")
            away = str(meta.get("awayTeam") or "")
            series = build_market_data(connection, meta, market_key, limit=limit)
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


@app.get("/api/matches/{match_id}/lineups")
def match_lineups(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_lineups_response(match_id, query_match_lineups(connection, match_id))
    except (FileNotFoundError, sqlite3.Error):
        return default_lineups_response(match_id)


@app.get("/api/matches/{match_id}/injuries")
def match_injuries(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_injuries_response(match_id, query_match_injuries(connection, match_id))
    except (FileNotFoundError, sqlite3.Error):
        return default_injuries_response(match_id)


@app.get("/api/matches/{match_id}/group-standing")
def match_group_standing(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_group_standing_response(match_id, query_group_standings(connection, meta))
    except (FileNotFoundError, sqlite3.Error):
        return default_group_standing_response(match_id)


@app.get("/api/matches/{match_id}/standings")
def match_standings(match_id: str) -> dict[str, Any]:
    return match_group_standing(match_id)


@app.get("/api/matches/{match_id}/live-stats")
def match_live_stats(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_live_stats_response(match_id, query_live_stats(connection, match_id))
    except (FileNotFoundError, sqlite3.Error):
        return default_live_stats_response(match_id)


@app.get("/api/matches/{match_id}/stats")
def match_stats(match_id: str) -> dict[str, Any]:
    return match_live_stats(match_id)


@app.get("/api/matches/{match_id}/events")
def match_events(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            return build_events_response(match_id, query_match_events(connection, match_id))
    except (FileNotFoundError, sqlite3.Error):
        return default_events_response(match_id)


@app.get("/api/matches/{match_id}/insights")
def match_insights(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            lineups = query_match_lineups(connection, match_id)
            injuries = query_match_injuries(connection, match_id)
            standings = query_group_standings(connection, meta)
            live_stats = latest_live_stats(query_live_stats(connection, match_id))
            events = query_match_events(connection, match_id)
            explicit_links = query_odds_event_links(connection, match_id)
            odds_rows = query_latest_odds_for_insights(connection, meta)
    except (FileNotFoundError, sqlite3.Error):
        lineups = []
        injuries = []
        standings = []
        live_stats = []
        events = []
        explicit_links = []
        odds_rows = []

    return build_match_insights(
        match_id=match_id,
        meta=meta,
        odds_rows=odds_rows,
        lineups=lineups,
        injuries=injuries,
        standings=standings,
        latest_stats=live_stats,
        events=events,
        explicit_links=explicit_links,
    )


@app.get("/api/matches/{match_id}/data-diagnostics")
def match_data_diagnostics(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        with connect_readonly() as connection:
            diagnostics = build_data_diagnostics(connection, meta)
    except FileNotFoundError:
        diagnostics = {
            "matchId": match_id,
            "externalMatchId": None,
            "sourceMap": {},
            "sources": [
                source_diagnostic(
                    source_name=name,
                    match_id=match_id,
                    row_count=0,
                    table_exists=False,
                    error="database not found",
                )
                for name in ("odds", "lineups", "stats", "events", "injuries", "standings")
            ],
            "summary": {"normal": 0, "needsAttention": 6},
            "updatedAt": api_now(),
        }
    except sqlite3.Error as exc:
        diagnostics = {
            "matchId": match_id,
            "externalMatchId": None,
            "sourceMap": {},
            "sources": [
                source_diagnostic(
                    source_name=name,
                    match_id=match_id,
                    row_count=0,
                    table_exists=True,
                    error=str(exc),
                )
                for name in ("odds", "lineups", "stats", "events", "injuries", "standings")
            ],
            "summary": {"normal": 0, "needsAttention": 6},
            "updatedAt": api_now(),
        }
    return {
        **diagnostics,
        **envelope(
            diagnostics,
            source_status={"code": "normal", "label": "正常", "reason": "诊断接口已返回"},
            updated_at=diagnostics.get("updatedAt"),
            diagnostics={"matchId": match_id, "rowCount": len(diagnostics.get("sources", []))},
        ),
    }


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
    dashboard_hidden_matches = config.setdefault("dashboard_hidden_matches", [])
    paused_matches = config.setdefault("paused_matches", [])
    normalized_matches = [match for match in (normalize_config_match(item) for item in matches) if match is not None]
    for collection in (hidden_matches, dashboard_hidden_matches, paused_matches):
        collection[:] = [
            hidden_match
            for hidden_match in collection
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
    dashboard_hidden_matches = config.setdefault("dashboard_hidden_matches", [])

    normalized_hidden = [
        hidden_match
        for hidden_match in (normalize_hidden_match(item) for item in dashboard_hidden_matches)
        if hidden_match is not None and hidden_match["url"] != target_url
    ]
    hidden_match = {
        "name": str(meta.get("englishName") or meta.get("name") or ""),
        "nameZh": str(meta.get("name") or ""),
        "url": target_url,
        "hiddenAt": datetime.now(SG_TIMEZONE).isoformat(timespec="seconds"),
        "reason": "dashboard_hidden",
    }
    config["dashboard_hidden_matches"] = [*normalized_hidden, hidden_match]

    try:
        write_config_document(config)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc

    return {
        "status": "hidden",
        "message": "比赛已从看板隐藏，采集状态不变",
        "match": hidden_match,
    }


@app.post("/api/config/matches/{match_id}/pause")
def pause_config_match(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        config = load_config_document()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"config read failed: {exc}") from exc

    target_url = str(meta["url"])
    paused_matches = config.setdefault("paused_matches", [])
    normalized_paused = [
        paused_match
        for paused_match in (normalize_hidden_match(item) for item in paused_matches)
        if paused_match is not None and paused_match["url"] != target_url
    ]
    paused_match = {
        "name": str(meta.get("englishName") or meta.get("name") or ""),
        "nameZh": str(meta.get("name") or ""),
        "url": target_url,
        "hiddenAt": datetime.now(SG_TIMEZONE).isoformat(timespec="seconds"),
        "reason": "collection_paused",
    }
    config["paused_matches"] = [*normalized_paused, paused_match]

    try:
        write_config_document(config)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc

    return {
        "status": "paused",
        "message": "比赛采集已暂停，历史数据已保留",
        "match": paused_match,
    }


@app.delete("/api/config/matches/{match_id}/pause")
def resume_config_match(match_id: str) -> dict[str, Any]:
    meta = find_match_meta(match_id)
    if not meta:
        raise HTTPException(status_code=404, detail="match not found")

    try:
        config = load_config_document()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"config read failed: {exc}") from exc

    target_url = str(meta["url"])
    paused_matches = config.setdefault("paused_matches", [])
    config["paused_matches"] = [
        paused_match
        for paused_match in (normalize_hidden_match(item) for item in paused_matches)
        if paused_match is not None and paused_match["url"] != target_url
    ]

    try:
        write_config_document(config)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"config write failed: {exc}") from exc

    return {
        "status": "active",
        "message": "比赛采集已恢复",
        "match": {
            "name": str(meta.get("englishName") or meta.get("name") or ""),
            "nameZh": str(meta.get("name") or ""),
            "url": target_url,
            "hiddenAt": "",
            "reason": "collection_active",
        },
    }
