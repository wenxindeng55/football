from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import requests

from backend.data_sources.config import source_api_key, source_settings
from backend.data_sources.types import SourceFetchResult


class TheSportsDbClient:
    source = "thesportsdb"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
        session: requests.Session | None = None,
    ) -> None:
        settings = source_settings(self.source)
        self.api_key = api_key or source_api_key(settings, "123")
        configured_base_url = str(settings.get("base_url") or "https://www.thesportsdb.com/api/v1/json")
        self.base_url = (base_url or configured_base_url).rstrip("/")
        self.timeout_seconds = int(timeout_seconds or settings.get("timeout_seconds") or 20)
        self.endpoints = settings.get("endpoints") if isinstance(settings.get("endpoints"), dict) else {}
        self.session = session or requests.Session()

    def endpoint_url(self, data_type: str, external_match_id: str) -> str:
        endpoint = str(self.endpoints.get(data_type) or "").strip()
        fallback_endpoints = {
            "event": "lookupevent.php?id={external_match_id}",
            "lineups": "lookuplineup.php?id={external_match_id}",
            "events": "lookuptimeline.php?id={external_match_id}",
            "stats": "lookupeventstats.php?id={external_match_id}",
        }
        path = (endpoint or fallback_endpoints[data_type]).format(external_match_id=external_match_id)
        return f"{self.base_url}/{self.api_key}/{path.lstrip('/')}"

    def search_event_url(self, query: str, event_date: str | None = None) -> str:
        params = {"e": query}
        if event_date:
            params["d"] = event_date
        return f"{self.base_url}/{self.api_key}/searchevents.php?{urlencode(params)}"

    def fetch_json(self, *, data_type: str, internal_match_id: str, external_match_id: str) -> SourceFetchResult:
        request_url = self.endpoint_url(data_type, external_match_id)
        fetched_at = current_timestamp()
        try:
            response = self.session.get(request_url, timeout=self.timeout_seconds)
            http_status = response.status_code
            payload: dict[str, Any] | list[Any]
            try:
                payload = response.json()
            except ValueError:
                payload = {"rawText": response.text}
            error_message = None if response.ok else f"HTTP {response.status_code}: {response.text[:240]}"
        except requests.RequestException as exc:
            return SourceFetchResult(
                source=self.source,
                data_type=data_type,
                internal_match_id=internal_match_id,
                external_match_id=external_match_id,
                request_url=request_url,
                fetched_at=fetched_at,
                error_message=str(exc),
            )

        return SourceFetchResult(
            source=self.source,
            data_type=data_type,
            internal_match_id=internal_match_id,
            external_match_id=external_match_id,
            request_url=request_url,
            fetched_at=fetched_at,
            http_status=http_status,
            payload=payload,
            error_message=error_message,
        )

    def search_events(
        self,
        *,
        internal_match_id: str,
        query: str,
        event_date: str | None = None,
    ) -> SourceFetchResult:
        request_url = self.search_event_url(query, event_date)
        fetched_at = current_timestamp()
        try:
            response = self.session.get(request_url, timeout=self.timeout_seconds)
            http_status = response.status_code
            try:
                payload: dict[str, Any] | list[Any] = response.json()
            except ValueError:
                payload = {"rawText": response.text}
            error_message = None if response.ok else f"HTTP {response.status_code}: {response.text[:240]}"
        except requests.RequestException as exc:
            return SourceFetchResult(
                source=self.source,
                data_type="event_search",
                internal_match_id=internal_match_id,
                external_match_id="",
                request_url=request_url,
                fetched_at=fetched_at,
                error_message=str(exc),
            )

        return SourceFetchResult(
            source=self.source,
            data_type="event_search",
            internal_match_id=internal_match_id,
            external_match_id="",
            request_url=request_url,
            fetched_at=fetched_at,
            http_status=http_status,
            payload=payload,
            error_message=error_message,
        )

    def fetch_match_bundle(self, *, internal_match_id: str, external_match_id: str) -> dict[str, SourceFetchResult]:
        return {
            data_type: self.fetch_json(
                data_type=data_type,
                internal_match_id=internal_match_id,
                external_match_id=external_match_id,
            )
            for data_type in ("event", "lineups", "events", "stats")
        }


def current_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
