from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from dataclasses import asdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.api import database_path, find_match_meta
from backend.data_sources.failover_runner import fetch_source_bundle
from backend.data_sources.ingest import ingest_match_intelligence
from backend.data_sources.normalizers import normalize_thesportsdb_bundle
from backend.data_sources.thesportsdb import TheSportsDbClient
from sgodds_collector import init_db


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and ingest match intelligence data.")
    parser.add_argument("--match-id", required=True, help="Internal match id used by Odds Watcher.")
    parser.add_argument("--external-match-id", default=None, help="External match id from the selected source.")
    parser.add_argument("--auto-map", action="store_true", help="Search TheSportsDB by teams and match date before fetching.")
    parser.add_argument("--dry-run", action="store_true", help="Resolve mapping and show planned fetches without writing SQLite.")
    parser.add_argument("--source", default="thesportsdb", choices=["thesportsdb"], help="Data source adapter.")
    parser.add_argument("--db-path", default=None, help="Override SQLite database path.")
    return parser.parse_args()


def normalize_text(value: Any) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def event_rows(payload: dict[str, Any] | list[Any] | None) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("event", "events"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    for value in payload.values():
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    return []


def match_date(meta: dict[str, Any]) -> str | None:
    raw_value = str(meta.get("matchTime") or "")
    if not raw_value:
        return None
    try:
        parsed = datetime.fromisoformat(raw_value)
    except ValueError:
        return raw_value[:10] if len(raw_value) >= 10 else None
    return parsed.date().isoformat()


def event_candidate_score(meta: dict[str, Any], row: dict[str, Any], expected_date: str | None) -> float:
    home = str(meta.get("homeTeamEnglish") or meta.get("homeTeam") or "")
    away = str(meta.get("awayTeamEnglish") or meta.get("awayTeam") or "")
    expected_name = f"{home} vs {away}"
    event_name = str(row.get("strEvent") or row.get("strFilename") or "")
    home_row = str(row.get("strHomeTeam") or "")
    away_row = str(row.get("strAwayTeam") or "")
    score = SequenceMatcher(None, normalize_text(expected_name), normalize_text(event_name)).ratio() * 0.45
    if normalize_text(home) and normalize_text(home) in normalize_text(home_row):
        score += 0.2
    if normalize_text(away) and normalize_text(away) in normalize_text(away_row):
        score += 0.2
    if expected_date and str(row.get("dateEvent") or "") == expected_date:
        score += 0.15
    return min(score, 1.0)


def resolve_external_match_id(meta: dict[str, Any], internal_match_id: str) -> dict[str, Any]:
    client = TheSportsDbClient()
    home = str(meta.get("homeTeamEnglish") or meta.get("homeTeam") or "")
    away = str(meta.get("awayTeamEnglish") or meta.get("awayTeam") or "")
    expected_date = match_date(meta)
    queries = [f"{home} vs {away}", f"{away} vs {home}"]
    searched: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for query in queries:
        if not query.strip(" vs"):
            continue
        result = client.search_events(internal_match_id=internal_match_id, query=query, event_date=expected_date)
        searched.append(
            {
                "query": query,
                "date": expected_date,
                "httpStatus": result.http_status,
                "error": result.error_message,
                "requestUrl": result.request_url,
            }
        )
        if result.error_message:
            continue
        for row in event_rows(result.payload):
            event_id = str(row.get("idEvent") or "").strip()
            if not event_id or event_id in seen_ids:
                continue
            seen_ids.add(event_id)
            score = event_candidate_score(meta, row, expected_date)
            candidates.append(
                {
                    "idEvent": event_id,
                    "score": round(score, 3),
                    "event": row.get("strEvent"),
                    "dateEvent": row.get("dateEvent"),
                    "homeTeam": row.get("strHomeTeam"),
                    "awayTeam": row.get("strAwayTeam"),
                }
            )

    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    best = candidates[0] if candidates else None
    if not best or float(best["score"]) < 0.75:
        return {
            "status": "mapping_missing",
            "reason": "TheSportsDB 未找到高置信度赛事映射",
            "searched": searched,
            "candidates": candidates[:5],
        }
    if len(candidates) > 1 and float(best["score"]) - float(candidates[1]["score"]) < 0.08:
        return {
            "status": "mapping_ambiguous",
            "reason": "TheSportsDB 存在多个接近候选赛事",
            "searched": searched,
            "candidates": candidates[:5],
        }
    return {
        "status": "mapped",
        "externalMatchId": best["idEvent"],
        "confidence": best["score"],
        "searched": searched,
        "candidates": candidates[:5],
    }


def main() -> int:
    args = parse_args()
    target_db = Path(args.db_path).expanduser().resolve() if args.db_path else database_path()
    os.environ["ODDS_DB_PATH"] = str(target_db)
    if not args.dry_run:
        init_db(target_db)

    meta = find_match_meta(args.match_id)
    if not meta:
        print(
            json.dumps(
                {
                    "status": "error",
                    "reason": "match_id not found",
                    "matchId": args.match_id,
                    "databasePath": str(target_db),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 2

    external_match_id = args.external_match_id
    mapping = None
    if args.auto_map or not external_match_id:
        mapping = resolve_external_match_id(meta, args.match_id)
        if mapping.get("status") != "mapped":
            print(json.dumps({"status": mapping["status"], "matchId": args.match_id, "mapping": mapping}, ensure_ascii=False, indent=2))
            return 3
        external_match_id = str(mapping["externalMatchId"])

    if not external_match_id:
        print(json.dumps({"status": "error", "reason": "--external-match-id or --auto-map is required"}, ensure_ascii=False, indent=2))
        return 2

    results = fetch_source_bundle(
        source=args.source,
        internal_match_id=args.match_id,
        external_match_id=external_match_id,
    )
    if args.source == "thesportsdb":
        bundle = normalize_thesportsdb_bundle(
            results,
            internal_match_id=args.match_id,
            external_match_id=external_match_id,
        )
    else:
        raise ValueError(f"unsupported source: {args.source}")

    if args.dry_run:
        summary = None
    else:
        with sqlite3.connect(target_db) as connection:
            summary = ingest_match_intelligence(connection, results=results.values(), bundle=bundle)
            connection.commit()

    output = {
        "status": "ok" if not summary.errors else "partial",
        "databasePath": str(target_db),
        "match": {
            "id": meta.get("id"),
            "name": meta.get("name"),
            "homeTeamEnglish": meta.get("homeTeamEnglish"),
            "awayTeamEnglish": meta.get("awayTeamEnglish"),
        },
        "mapping": mapping,
        "summary": asdict(summary) if summary else None,
        "fetches": {
            data_type: {
                "httpStatus": result.http_status,
                "error": result.error_message,
                "requestUrl": result.request_url,
                "fetchedAt": result.fetched_at,
            }
            for data_type, result in results.items()
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if summary is None or not summary.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
