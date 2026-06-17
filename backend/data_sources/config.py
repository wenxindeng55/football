from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_REGISTRY_PATH = PROJECT_ROOT / "config" / "source_registry.yml"
FALLBACK_CHAINS_PATH = PROJECT_ROOT / "config" / "fallback_chains.yml"


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file) or {}
    return data if isinstance(data, dict) else {}


def load_source_registry() -> dict[str, Any]:
    return load_yaml(SOURCE_REGISTRY_PATH)


def load_fallback_chains() -> dict[str, Any]:
    return load_yaml(FALLBACK_CHAINS_PATH)


def source_settings(source: str) -> dict[str, Any]:
    registry = load_source_registry()
    sources = registry.get("sources") if isinstance(registry.get("sources"), dict) else {}
    settings = sources.get(source) if isinstance(sources.get(source), dict) else {}
    return dict(settings or {})


def source_api_key(settings: dict[str, Any], fallback: str = "") -> str:
    env_name = str(settings.get("api_key_env") or "").strip()
    if env_name:
        value = os.getenv(env_name)
        if value:
            return value.strip()
    default_key = settings.get("default_api_key")
    return str(default_key if default_key is not None else fallback).strip()
