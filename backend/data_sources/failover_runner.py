from __future__ import annotations

from backend.data_sources.thesportsdb import TheSportsDbClient
from backend.data_sources.types import SourceFetchResult


def fetch_source_bundle(
    *,
    source: str,
    internal_match_id: str,
    external_match_id: str,
) -> dict[str, SourceFetchResult]:
    if source == "thesportsdb":
        return TheSportsDbClient().fetch_match_bundle(
            internal_match_id=internal_match_id,
            external_match_id=external_match_id,
        )
    raise ValueError(f"unsupported source: {source}")
