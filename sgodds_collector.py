import argparse
import csv
import json
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

from logging_config import setup_logging
from team_translations import parse_match_teams, translate_match_name, translate_team


REQUEST_INTERVAL_SECONDS = 600
CURRENT_ODDS_URL = "https://sgodds.com/football/current-odds"
AUTO_DISCOVERY_DAY_OFFSETS = (0, 1)
MATCH_FINISHED_AFTER = timedelta(hours=2)
DEFAULT_CONFIG_PATH = Path("config.json")
DEFAULT_OUTPUT_DIR = Path("data")
DEFAULT_DB_NAME = "sgodds_odds.sqlite3"
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_REQUEST_PAUSE_SECONDS = 2
SG_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Singapore")
MONTH_NUMBERS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; sgodds-odds-collector/1.0; "
    "+https://sgodds.com/)"
)
logger = setup_logging("odds_watcher.collector", "collector.log")


@dataclass(frozen=True)
class MatchConfig:
    url: str
    name: str | None = None
    source_type: str = "manual"
    match_time: str | None = None
    league: str | None = None
    match_no: str | None = None


@dataclass(frozen=True)
class AppConfig:
    matches: list[MatchConfig]
    hidden_urls: set[str]
    output_dir: Path
    database_path: Path
    request_timeout_seconds: int
    request_pause_seconds: int
    user_agent: str


@dataclass(frozen=True)
class OddsRecord:
    collected_at: str
    page_updated_at: str | None
    match_url: str
    match_name: str
    market_type: str
    option_name: str
    opening_odds: float
    current_odds: float
    change_percent: float
    raw_html_path: str


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str, default: str = "match") -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return slug[:80] or default


def parse_float(value: str) -> float | None:
    match = re.search(r"[-+]?\d+(?:\.\d+)?", value.replace(",", ""))
    if not match:
        return None
    return float(match.group(0))


def parse_percent(value: str) -> float:
    parsed = parse_float(value)
    return parsed if parsed is not None else 0.0


def has_classes(tag: Tag, *classes: str) -> bool:
    existing = tag.get("class") or []
    return all(class_name in existing for class_name in classes)


def load_config(config_path: Path) -> AppConfig:
    if not config_path.exists():
        raise FileNotFoundError(
            f"配置文件不存在：{config_path}。请先复制或编辑 config.json。"
        )

    config_dir = config_path.resolve().parent

    with config_path.open("r", encoding="utf-8") as file:
        raw_config = json.load(file)

    interval_seconds = int(raw_config.get("interval_seconds", REQUEST_INTERVAL_SECONDS))
    if interval_seconds != REQUEST_INTERVAL_SECONDS:
        raise ValueError("为避免高频访问，采集间隔固定为 600 秒，不能修改。")

    matches = []
    for index, raw_match in enumerate(raw_config.get("matches", []), start=1):
        if isinstance(raw_match, str):
            url = raw_match.strip()
            name = None
            match_time = None
            league = None
            match_no = None
        else:
            url = str(raw_match.get("url", "")).strip()
            name = clean_text(str(raw_match.get("name", ""))) or None
            match_time = clean_text(str(raw_match.get("matchTime", raw_match.get("match_time", "")))) or None
            league = clean_text(str(raw_match.get("league", ""))) or None
            match_no = clean_text(str(raw_match.get("matchNo", raw_match.get("match_no", "")))) or None
        if not url:
            raise ValueError(f"matches 第 {index} 项缺少 url。")
        matches.append(
            MatchConfig(
                url=url,
                name=name,
                source_type="manual",
                match_time=match_time,
                league=league,
                match_no=match_no,
            )
        )

    hidden_urls: set[str] = set()
    for raw_match in raw_config.get("hidden_matches", []):
        if isinstance(raw_match, str):
            url = raw_match.strip()
        elif isinstance(raw_match, dict):
            url = str(raw_match.get("url", "")).strip()
        else:
            url = ""
        if url:
            hidden_urls.add(url)

    matches = [match for match in matches if match.url not in hidden_urls]

    output_dir = Path(raw_config.get("output_dir", DEFAULT_OUTPUT_DIR))
    if not output_dir.is_absolute():
        output_dir = (config_dir / output_dir).resolve()
    database_value = raw_config.get("database")
    if database_value:
        database_path = Path(database_value)
        if not database_path.is_absolute():
            database_path = (config_dir / database_path).resolve()
    else:
        database_path = output_dir / DEFAULT_DB_NAME
    request_timeout_seconds = int(
        raw_config.get("request_timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
    )
    request_pause_seconds = int(
        raw_config.get("request_pause_seconds", DEFAULT_REQUEST_PAUSE_SECONDS)
    )
    if request_timeout_seconds <= 0:
        raise ValueError("request_timeout_seconds 必须大于 0。")
    if request_pause_seconds < 0:
        raise ValueError("request_pause_seconds 不能小于 0。")

    return AppConfig(
        matches=matches,
        hidden_urls=hidden_urls,
        output_dir=output_dir,
        database_path=database_path,
        request_timeout_seconds=request_timeout_seconds,
        request_pause_seconds=request_pause_seconds,
        user_agent=str(raw_config.get("user_agent", DEFAULT_USER_AGENT)).strip()
        or DEFAULT_USER_AGENT,
    )


def auto_matches_path(output_dir: Path) -> Path:
    return output_dir / "auto_matches.json"


def sg_today() -> date:
    return datetime.now(SG_TIMEZONE).date()


def normalize_sg_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=SG_TIMEZONE)
    return value.astimezone(SG_TIMEZONE)


def parse_match_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = clean_text(value)
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    try:
        return normalize_sg_datetime(datetime.fromisoformat(cleaned))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return normalize_sg_datetime(datetime.strptime(cleaned, fmt))
        except ValueError:
            continue
    return None


def is_finished_match_time(match_time: str | None, now: datetime | None = None) -> bool:
    scheduled_at = parse_match_datetime(match_time)
    if scheduled_at is None:
        return False
    current_time = normalize_sg_datetime(now or datetime.now(SG_TIMEZONE))
    return current_time >= scheduled_at + MATCH_FINISHED_AFTER


def match_status_for_time(match_time: str | None, now: datetime | None = None) -> str:
    scheduled_at = parse_match_datetime(match_time)
    if scheduled_at is None:
        return "未开赛"
    current_time = normalize_sg_datetime(now or datetime.now(SG_TIMEZONE))
    if current_time >= scheduled_at + MATCH_FINISHED_AFTER:
        return "已完赛"
    if current_time >= scheduled_at:
        return "进行中"
    return "未开赛"


def collectable_matches(matches: Iterable[MatchConfig], now: datetime | None = None) -> list[MatchConfig]:
    current_time = normalize_sg_datetime(now or datetime.now(SG_TIMEZONE))
    return [
        match
        for match in matches
        if not is_finished_match_time(match.match_time, current_time)
    ]


def auto_discovery_target_dates(today: date | None = None) -> list[date]:
    base_date = today or sg_today()
    return [base_date + timedelta(days=offset) for offset in AUTO_DISCOVERY_DAY_OFFSETS]


def parse_sgodds_date(value: str) -> date | None:
    match = re.search(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", value)
    if not match:
        return None
    day = int(match.group(1))
    month = MONTH_NUMBERS.get(match.group(2).lower())
    year = int(match.group(3))
    if not month:
        return None
    return date(year, month, day)


def parse_sgodds_time(value: str) -> tuple[int, int] | None:
    match = re.search(r"\b(\d{1,2}):(\d{2})\b", value)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def match_to_state(match: MatchConfig) -> dict[str, str | None]:
    home, away = parse_match_teams(match.name or "")
    return {
        "name": match.name,
        "name_zh": translate_match_name(match.name or ""),
        "url": match.url,
        "source_type": match.source_type,
        "match_time": match.match_time,
        "league": match.league,
        "match_no": match.match_no,
        "home_team": home,
        "away_team": away,
        "home_team_zh": translate_team(home) if home else "",
        "away_team_zh": translate_team(away) if away else "",
    }


def match_from_state(raw_match: dict[str, Any]) -> MatchConfig | None:
    url = str(raw_match.get("url", "")).strip()
    if not url:
        return None
    return MatchConfig(
        url=url,
        name=clean_text(str(raw_match.get("name", ""))) or None,
        source_type=str(raw_match.get("source_type") or "auto"),
        match_time=clean_text(str(raw_match.get("match_time", ""))) or None,
        league=clean_text(str(raw_match.get("league", ""))) or None,
        match_no=clean_text(str(raw_match.get("match_no", ""))) or None,
    )


def match_config_date(match: MatchConfig) -> date | None:
    parsed = parse_match_datetime(match.match_time)
    return parsed.date() if parsed else None


def filter_matches_by_target_dates(
    matches: Iterable[MatchConfig],
    target_dates: Iterable[date],
) -> list[MatchConfig]:
    target_date_list = list(target_dates)
    target_date_values = {target_date.isoformat() for target_date in target_date_list}
    filtered: list[MatchConfig] = []
    for match in matches:
        match_date = match_config_date(match)
        if match_date is None or match_date.isoformat() in target_date_values:
            filtered.append(match)
    return filtered


def state_target_dates(payload: dict[str, Any], dates_key: str, date_key: str) -> set[str]:
    target_dates = payload.get(dates_key)
    if isinstance(target_dates, list):
        return {str(target_date) for target_date in target_dates if str(target_date).strip()}

    target_date = str(payload.get(date_key, "")).strip()
    return {target_date} if target_date else set()


def payload_target_dates(payload: dict[str, Any]) -> set[str]:
    return state_target_dates(payload, "latest_target_dates", "latest_target_date")


def history_entry_target_dates(entry: dict[str, Any]) -> set[str]:
    return state_target_dates(entry, "target_dates", "target_date")


def state_matches(raw_matches: Any) -> list[MatchConfig]:
    if not isinstance(raw_matches, list):
        return []
    return [
        match
        for match in (match_from_state(raw_match) for raw_match in raw_matches if isinstance(raw_match, dict))
        if match is not None
    ]


def load_auto_matches(output_dir: Path, target_dates: Iterable[date]) -> list[MatchConfig]:
    path = auto_matches_path(output_dir)
    if not path.exists():
        return []
    target_date_list = list(target_dates)
    target_date_values = {target_date.isoformat() for target_date in target_date_list}
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("自动比赛状态读取失败 path=%s error=%s", path, exc)
        return []

    matched: dict[str, MatchConfig] = {}
    history = payload.get("history", [])
    if isinstance(history, list):
        for entry in history:
            if not isinstance(entry, dict) or not (history_entry_target_dates(entry) & target_date_values):
                continue
            for match in filter_matches_by_target_dates(state_matches(entry.get("matches", [])), target_date_list):
                matched[match.url] = match

    if payload_target_dates(payload) & target_date_values:
        for match in filter_matches_by_target_dates(state_matches(payload.get("latest_matches", [])), target_date_list):
            matched[match.url] = match

    return list(matched.values())


def write_auto_matches(output_dir: Path, target_dates: Iterable[date], matches: list[MatchConfig]) -> None:
    path = auto_matches_path(output_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    discovered_at = datetime.now(SG_TIMEZONE).isoformat(timespec="seconds")
    target_date_values = [target_date.isoformat() for target_date in list(target_dates)]
    latest_matches = [match_to_state(match) for match in matches]
    history: list[dict[str, Any]] = []
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as file:
                previous = json.load(file)
            previous_history = previous.get("history", [])
            if isinstance(previous_history, list):
                history = previous_history
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("自动比赛历史读取失败 path=%s error=%s", path, exc)

    history.append(
        {
            "target_date": target_date_values[-1] if target_date_values else None,
            "target_dates": target_date_values,
            "discovered_at": discovered_at,
            "matches": latest_matches,
        }
    )
    with path.open("w", encoding="utf-8") as file:
        json.dump(
            {
                "latest_target_date": target_date_values[-1] if target_date_values else None,
                "latest_target_dates": target_date_values,
                "latest_updated_at": discovered_at,
                "latest_matches": latest_matches,
                "history": history,
            },
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")


def parse_current_odds_matches(html: str, target_date: date) -> list[MatchConfig]:
    soup = BeautifulSoup(html, "html.parser")
    current_date: date | None = None
    matches: list[MatchConfig] = []

    for row in soup.find_all("div"):
        if not isinstance(row, Tag) or "row" not in (row.get("class") or []):
            continue

        if "table-active" in (row.get("class") or []):
            parsed_date = parse_sgodds_date(clean_text(row.get_text(" ", strip=True)))
            if parsed_date:
                current_date = parsed_date
            continue

        if current_date != target_date or "border-bottom" not in (row.get("class") or []):
            continue

        link = row.find("a", href=re.compile(r"/football/current-odds/"))
        if not isinstance(link, Tag):
            continue

        name = clean_text(link.get_text(" ", strip=True))
        href = str(link.get("href") or "").strip()
        if not name or not href:
            continue

        columns = direct_div_children(row)
        time_text = clean_text(columns[0].get_text(" ", strip=True)) if columns else ""
        league = clean_text(columns[1].get_text(" ", strip=True)) if len(columns) > 1 else None
        time_parts = parse_sgodds_time(time_text)
        match_time = None
        if time_parts:
            match_time = datetime.combine(
                target_date,
                datetime_time(hour=time_parts[0], minute=time_parts[1]),
                SG_TIMEZONE,
            ).isoformat(timespec="minutes")

        badge = row.find("span", class_="badge")
        matches.append(
            MatchConfig(
                url=urljoin(CURRENT_ODDS_URL, href),
                name=name,
                source_type="auto",
                match_time=match_time,
                league=league,
                match_no=clean_text(badge.get_text(" ", strip=True)) if isinstance(badge, Tag) else None,
            )
        )

    return matches


def discover_auto_matches(session: requests.Session, config: AppConfig) -> list[MatchConfig]:
    target_dates = auto_discovery_target_dates()
    target_dates_text = ",".join(target_date.isoformat() for target_date in target_dates)
    try:
        response = session.get(CURRENT_ODDS_URL, timeout=config.request_timeout_seconds)
        response.raise_for_status()
        discovered_matches: dict[str, MatchConfig] = {}
        current_time = datetime.now(SG_TIMEZONE)
        for target_date in target_dates:
            for match in parse_current_odds_matches(response.text, target_date):
                if match.url not in config.hidden_urls and not is_finished_match_time(match.match_time, current_time):
                    discovered_matches[match.url] = match
        matches = list(discovered_matches.values())
        write_auto_matches(config.output_dir, target_dates, matches)
        logger.info(
            "自动发现今日和明日比赛完成 target_dates=%s count=%s state=%s",
            target_dates_text,
            len(matches),
            auto_matches_path(config.output_dir),
        )
        return matches
    except Exception as exc:
        fallback_matches = [
            match
            for match in load_auto_matches(config.output_dir, target_dates)
            if match.url not in config.hidden_urls and not is_finished_match_time(match.match_time)
        ]
        logger.exception(
            "自动发现今日和明日比赛失败，使用状态文件兜底 target_dates=%s fallback_count=%s error=%s",
            target_dates_text,
            len(fallback_matches),
            exc,
        )
        return fallback_matches


def merge_match_targets(manual_matches: list[MatchConfig], auto_matches: list[MatchConfig]) -> list[MatchConfig]:
    merged: dict[str, MatchConfig] = {match.url: match for match in auto_matches}
    for manual_match in manual_matches:
        existing = merged.get(manual_match.url)
        if existing:
            merged[manual_match.url] = MatchConfig(
                url=manual_match.url,
                name=manual_match.name or existing.name,
                source_type="manual",
                match_time=manual_match.match_time or existing.match_time,
                league=manual_match.league or existing.league,
                match_no=manual_match.match_no or existing.match_no,
            )
        else:
            merged[manual_match.url] = manual_match
    return list(merged.values())


def init_db(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS odds_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collected_at TEXT NOT NULL,
                page_updated_at TEXT,
                match_url TEXT NOT NULL,
                match_name TEXT NOT NULL,
                market_type TEXT NOT NULL,
                option_name TEXT NOT NULL,
                opening_odds REAL NOT NULL,
                current_odds REAL NOT NULL,
                change_percent REAL NOT NULL,
                raw_html_path TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_odds_match_market_option_time
            ON odds_snapshots(match_name, market_type, option_name, collected_at)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS match_metadata (
                match_url TEXT PRIMARY KEY,
                match_name_en TEXT NOT NULL,
                match_name_zh TEXT NOT NULL,
                home_team_en TEXT NOT NULL,
                away_team_en TEXT NOT NULL,
                home_team_zh TEXT NOT NULL,
                away_team_zh TEXT NOT NULL,
                match_time TEXT,
                league TEXT,
                match_no TEXT,
                source_type TEXT NOT NULL,
                discovered_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_match_metadata_time
            ON match_metadata(match_time, source_type)
            """
        )


def fetch_html(session: requests.Session, match: MatchConfig, config: AppConfig) -> str:
    response = session.get(match.url, timeout=config.request_timeout_seconds)
    response.raise_for_status()
    return response.text


def raw_html_path(output_dir: Path, match_url: str, collected_at: datetime) -> Path:
    parsed = urlparse(match_url)
    fallback = parsed.netloc or "sgodds"
    match_slug = slugify(Path(parsed.path).name, fallback)
    filename = f"{collected_at.strftime('%Y%m%d_%H%M%S_%f%z')}.html"
    return output_dir / "raw_html" / match_slug / filename


def save_raw_html(output_dir: Path, match_url: str, collected_at: datetime, html: str) -> Path:
    path = raw_html_path(output_dir, match_url, collected_at)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path


def extract_match_name(soup: BeautifulSoup, fallback_name: str | None, url: str) -> str:
    heading = soup.find("h1")
    if heading:
        heading_copy = BeautifulSoup(str(heading), "html.parser").find("h1")
        if heading_copy:
            for small in heading_copy.find_all("small"):
                small.decompose()
            name = clean_text(heading_copy.get_text(" ", strip=True))
            if name:
                return name
    if fallback_name:
        return fallback_name
    return slugify(Path(urlparse(url).path).name, "unknown-match")


def extract_page_updated_at(soup: BeautifulSoup) -> str | None:
    text_node = soup.find(string=re.compile(r"Last Updated on", re.IGNORECASE))
    if not text_node:
        return None
    text = clean_text(str(text_node))
    return re.sub(r"^Last Updated on\s+", "", text, flags=re.IGNORECASE) or text


def direct_div_children(tag: Tag) -> list[Tag]:
    return [
        child
        for child in tag.find_all("div", recursive=False)
        if isinstance(child, Tag)
    ]


def parse_market_container(
    container: Tag,
    collected_at: str,
    page_updated_at: str | None,
    match_url: str,
    match_name: str,
    raw_path: Path,
) -> list[OddsRecord]:
    children = direct_div_children(container)
    header_index = None
    market_type = ""

    for index, child in enumerate(children):
        if has_classes(child, "row", "table-dark"):
            market_type = clean_text(child.get_text(" ", strip=True))
            header_index = index
            break

    if header_index is None or not market_type:
        return []

    records: list[OddsRecord] = []
    for row in children[header_index + 1 :]:
        if not has_classes(row, "row"):
            continue
        for selection in direct_div_children(row):
            if "border-bottom" not in (selection.get("class") or []):
                continue
            nested_rows = [
                child for child in direct_div_children(selection) if has_classes(child, "row")
            ]
            if not nested_rows:
                continue
            cells = direct_div_children(nested_rows[0])
            if len(cells) < 3:
                continue

            option_name = clean_text(cells[0].get_text(" ", strip=True))
            opening_odds = parse_float(cells[1].get_text(" ", strip=True))
            current_odds = parse_float(cells[2].get_text(" ", strip=True))
            change_percent = (
                parse_percent(cells[3].get_text(" ", strip=True)) if len(cells) > 3 else 0.0
            )

            if not option_name or opening_odds is None or current_odds is None:
                continue

            records.append(
                OddsRecord(
                    collected_at=collected_at,
                    page_updated_at=page_updated_at,
                    match_url=match_url,
                    match_name=match_name,
                    market_type=market_type,
                    option_name=option_name,
                    opening_odds=opening_odds,
                    current_odds=current_odds,
                    change_percent=change_percent,
                    raw_html_path=str(raw_path),
                )
            )

    return records


def parse_odds_records(
    html: str,
    match: MatchConfig,
    collected_at: datetime,
    raw_path: Path,
) -> list[OddsRecord]:
    soup = BeautifulSoup(html, "html.parser")
    collected_at_text = collected_at.isoformat(timespec="seconds")
    page_updated_at = extract_page_updated_at(soup)
    match_name = extract_match_name(soup, match.name, match.url)

    records: list[OddsRecord] = []
    for container in soup.find_all("div", class_="container"):
        records.extend(
            parse_market_container(
                container=container,
                collected_at=collected_at_text,
                page_updated_at=page_updated_at,
                match_url=match.url,
                match_name=match_name,
                raw_path=raw_path,
            )
        )
    return records


def insert_records(database_path: Path, records: Iterable[OddsRecord]) -> int:
    rows = list(records)
    if not rows:
        return 0
    with sqlite3.connect(database_path) as connection:
        connection.executemany(
            """
            INSERT INTO odds_snapshots (
                collected_at,
                page_updated_at,
                match_url,
                match_name,
                market_type,
                option_name,
                opening_odds,
                current_odds,
                change_percent,
                raw_html_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    record.collected_at,
                    record.page_updated_at,
                    record.match_url,
                    record.match_name,
                    record.market_type,
                    record.option_name,
                    record.opening_odds,
                    record.current_odds,
                    record.change_percent,
                    record.raw_html_path,
                )
                for record in rows
            ],
        )
    return len(rows)


def upsert_match_metadata(database_path: Path, match: MatchConfig, match_name: str) -> None:
    home_en, away_en = parse_match_teams(match_name)
    now_text = datetime.now(SG_TIMEZONE).isoformat(timespec="seconds")
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            INSERT INTO match_metadata (
                match_url,
                match_name_en,
                match_name_zh,
                home_team_en,
                away_team_en,
                home_team_zh,
                away_team_zh,
                match_time,
                league,
                match_no,
                source_type,
                discovered_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_url) DO UPDATE SET
                match_name_en = excluded.match_name_en,
                match_name_zh = excluded.match_name_zh,
                home_team_en = excluded.home_team_en,
                away_team_en = excluded.away_team_en,
                home_team_zh = excluded.home_team_zh,
                away_team_zh = excluded.away_team_zh,
                match_time = COALESCE(excluded.match_time, match_metadata.match_time),
                league = COALESCE(excluded.league, match_metadata.league),
                match_no = COALESCE(excluded.match_no, match_metadata.match_no),
                source_type = excluded.source_type,
                updated_at = excluded.updated_at
            """,
            (
                match.url,
                match_name,
                translate_match_name(match_name),
                home_en,
                away_en,
                translate_team(home_en) if home_en else "",
                translate_team(away_en) if away_en else "",
                match.match_time,
                match.league,
                match.match_no,
                match.source_type,
                now_text,
                now_text,
            ),
        )


def collect_once(config: AppConfig) -> int:
    init_db(config.database_path)
    total_rows = 0
    session = requests.Session()
    session.headers.update({"User-Agent": config.user_agent})
    auto_matches = discover_auto_matches(session, config)
    raw_targets = merge_match_targets(config.matches, auto_matches)
    targets = collectable_matches(raw_targets)
    skipped_finished_count = len(raw_targets) - len(targets)
    logger.info(
        "单轮采集开始 targets=%s manual=%s auto=%s skipped_finished=%s database=%s output_dir=%s",
        len(targets),
        len(config.matches),
        len(auto_matches),
        skipped_finished_count,
        config.database_path,
        config.output_dir,
    )

    if not targets:
        logger.warning("本轮没有可采集比赛，请检查 config.json 或 sgodds 当前赔率列表")
        return 0

    for index, match in enumerate(targets):
        collected_at = datetime.now().astimezone()
        raw_path: Path | None = None
        try:
            logger.info(
                "比赛采集开始 index=%s total=%s source=%s url=%s",
                index + 1,
                len(targets),
                match.source_type,
                match.url,
            )
            html = fetch_html(session, match, config)
            raw_path = save_raw_html(config.output_dir, match.url, collected_at, html)
            records = parse_odds_records(html, match, collected_at, raw_path)
            match_name = (
                records[0].match_name
                if records
                else extract_match_name(BeautifulSoup(html, "html.parser"), match.name, match.url)
            )
            upsert_match_metadata(config.database_path, match, match_name)
            inserted = insert_records(config.database_path, records)
            total_rows += inserted
            logger.info(
                "比赛采集完成 url=%s name=%s name_zh=%s raw_html=%s inserted_rows=%s database=%s",
                match.url,
                match_name,
                translate_match_name(match_name),
                raw_path,
                inserted,
                config.database_path,
            )
            if inserted == 0:
                logger.warning(
                    "未解析到赔率 url=%s raw_html=%s",
                    match.url,
                    raw_path,
                )
        except Exception as exc:
            logger.exception(
                "采集失败 url=%s raw_html=%s error=%s",
                match.url,
                raw_path or "-",
                exc,
            )

        if index < len(targets) - 1 and config.request_pause_seconds > 0:
            time.sleep(config.request_pause_seconds)

    logger.info("单轮采集完成 total_rows=%s database=%s", total_rows, config.database_path)
    return total_rows


def run_forever(config_path: Path) -> None:
    logger.info("开始循环采集，固定每 10 分钟启动一轮。按 Ctrl+C 停止。")
    next_run_at = time.monotonic()
    while True:
        started_at = datetime.now().astimezone().isoformat(timespec="seconds")
        logger.info("本轮采集开始 started_at=%s", started_at)
        try:
            config = load_config(config_path)
            collect_once(config)
        except Exception as exc:
            logger.exception("本轮采集配置读取或执行失败 config=%s error=%s", config_path, exc)
        next_run_at += REQUEST_INTERVAL_SECONDS
        sleep_seconds = max(0.0, next_run_at - time.monotonic())
        logger.info("等待 %.0f 秒后开始下一轮", sleep_seconds)
        time.sleep(sleep_seconds)


def default_csv_path(output_dir: Path, match: str | None) -> Path:
    timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    name_part = slugify(match, "all") if match else "all"
    return output_dir / "exports" / f"odds_{name_part}_{timestamp}.csv"


def export_csv(config: AppConfig, match: str | None, output: Path | None) -> Path:
    init_db(config.database_path)
    output_path = output or default_csv_path(config.output_dir, match)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    query = """
        SELECT
            collected_at,
            page_updated_at,
            match_name,
            market_type,
            option_name,
            opening_odds,
            current_odds,
            change_percent,
            match_url,
            raw_html_path
        FROM odds_snapshots
    """
    params: list[str] = []
    if match:
        query += " WHERE match_name LIKE ?"
        params.append(f"%{match}%")
    query += " ORDER BY collected_at, match_name, market_type, option_name"

    with sqlite3.connect(config.database_path) as connection:
        rows = connection.execute(query, params).fetchall()

    headers = [
        "collected_at",
        "page_updated_at",
        "match_name",
        "market_type",
        "option_name",
        "opening_odds",
        "current_odds",
        "change_percent",
        "match_url",
        "raw_html_path",
    ]
    with output_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"已导出 {len(rows)} 行到 {output_path}")
    return output_path


def query_plot_rows(
    database_path: Path,
    match: str,
    market: str | None,
    option: str | None,
) -> tuple[str, list[sqlite3.Row]]:
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        match_name = resolve_single_match_name(connection, match)
        selected_market = market
        if selected_market is None:
            preferred = connection.execute(
                """
                SELECT market_type
                FROM odds_snapshots
                WHERE match_name = ? AND market_type = '01 | 1X2'
                LIMIT 1
                """,
                (match_name,),
            ).fetchone()
            if preferred:
                selected_market = preferred["market_type"]
            else:
                first_market = connection.execute(
                    """
                    SELECT market_type
                    FROM odds_snapshots
                    WHERE match_name = ?
                    GROUP BY market_type
                    ORDER BY MIN(collected_at)
                    LIMIT 1
                    """,
                    (match_name,),
                ).fetchone()
                if not first_market:
                    raise ValueError(f"没有找到比赛数据：{match_name}")
                selected_market = first_market["market_type"]

        query = """
            SELECT collected_at, match_name, market_type, option_name, current_odds
            FROM odds_snapshots
            WHERE match_name = ? AND market_type = ?
        """
        params: list[str] = [match_name, selected_market]
        if option:
            query += " AND option_name LIKE ?"
            params.append(f"%{option}%")
        query += " ORDER BY option_name, collected_at"
        rows = connection.execute(query, params).fetchall()

    if not rows:
        filter_text = f"比赛={match}，盘口={selected_market}"
        if option:
            filter_text += f"，选项={option}"
        raise ValueError(f"没有找到可画图数据：{filter_text}")
    return selected_market, rows


def resolve_single_match_name(connection: sqlite3.Connection, match: str) -> str:
    exact = connection.execute(
        """
        SELECT DISTINCT match_name
        FROM odds_snapshots
        WHERE LOWER(match_name) = LOWER(?)
        LIMIT 1
        """,
        (match,),
    ).fetchone()
    if exact:
        return exact["match_name"]

    candidates = connection.execute(
        """
        SELECT DISTINCT match_name
        FROM odds_snapshots
        WHERE match_name LIKE ?
        ORDER BY match_name
        LIMIT 20
        """,
        (f"%{match}%",),
    ).fetchall()
    if not candidates:
        raise ValueError(f"没有找到比赛数据：{match}")
    if len(candidates) > 1:
        names = "、".join(row["match_name"] for row in candidates)
        raise ValueError(f"匹配到多个比赛：{names}。请使用更完整的 --match。")
    return candidates[0]["match_name"]


def default_plot_path(
    output_dir: Path,
    match: str,
    market: str,
    option: str | None,
) -> Path:
    option_part = slugify(option, "all-options") if option else "all-options"
    return (
        output_dir
        / "plots"
        / f"{slugify(match)}_{slugify(market)}_{option_part}.png"
    )


def generate_plot(
    config: AppConfig,
    match: str,
    market: str | None,
    option: str | None,
    output: Path | None,
) -> Path:
    init_db(config.database_path)

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    selected_market, rows = query_plot_rows(
        database_path=config.database_path,
        match=match,
        market=market,
        option=option,
    )
    output_path = output or default_plot_path(config.output_dir, match, selected_market, option)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    series: dict[str, list[tuple[datetime, float]]] = {}
    match_name = rows[0]["match_name"]
    for row in rows:
        collected_at = datetime.fromisoformat(row["collected_at"])
        series.setdefault(row["option_name"], []).append((collected_at, row["current_odds"]))

    fig, ax = plt.subplots(figsize=(10, 5.5))
    for option_name, points in series.items():
        x_values = [point[0] for point in points]
        y_values = [point[1] for point in points]
        ax.plot(x_values, y_values, marker="o", linewidth=1.8, label=option_name)

    ax.set_title(f"{match_name} - {selected_market}")
    ax.set_xlabel("Collected Time")
    ax.set_ylabel("Current Odds")
    ax.grid(True, linestyle="--", alpha=0.35)
    ax.legend()
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)

    print(f"已生成赔率折线图：{output_path}")
    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="sgodds 指定比赛盘口赔率采集工具")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help="配置文件路径，默认 config.json",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("collect-once", help="立即采集一次所有配置比赛")
    subparsers.add_parser("run", help="固定每 10 分钟循环采集")

    export_parser = subparsers.add_parser("export-csv", help="导出 SQLite 数据到 CSV")
    export_parser.add_argument("--match", help="按比赛名模糊过滤")
    export_parser.add_argument("--output", type=Path, help="CSV 输出路径")

    plot_parser = subparsers.add_parser("plot", help="生成指定比赛赔率折线图")
    plot_parser.add_argument("--match", required=True, help="比赛名，支持模糊匹配")
    plot_parser.add_argument("--market", help="盘口类型，默认优先使用 01 | 1X2")
    plot_parser.add_argument("--option", help="选项名；不指定则画该盘口全部选项")
    plot_parser.add_argument("--output", type=Path, help="PNG 输出路径")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "run":
            run_forever(args.config)
            return 0

        config = load_config(args.config)
        if args.command == "collect-once":
            collect_once(config)
        elif args.command == "export-csv":
            export_csv(config, match=args.match, output=args.output)
        elif args.command == "plot":
            generate_plot(
                config=config,
                match=args.match,
                market=args.market,
                option=args.option,
                output=args.output,
            )
        else:
            parser.error(f"未知命令：{args.command}")
    except KeyboardInterrupt:
        logger.info("已停止。")
        return 130
    except Exception as exc:
        logger.exception("执行失败：%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
