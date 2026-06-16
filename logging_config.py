from __future__ import annotations

import logging
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_LOG_DIR = PROJECT_ROOT / "data" / "logs"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(
    logger_name: str,
    log_filename: str,
    *,
    level: int = logging.INFO,
) -> logging.Logger:
    log_dir = DEFAULT_LOG_DIR
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / log_filename

    logger = logging.getLogger(logger_name)
    logger.setLevel(level)
    logger.propagate = False

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)
    resolved_log_path = str(log_path.resolve())

    has_file_handler = any(
        getattr(handler, "_odds_log_path", None) == resolved_log_path
        for handler in logger.handlers
    )
    if not has_file_handler:
        file_handler = logging.FileHandler(log_path, mode="a", encoding="utf-8")
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler._odds_log_path = resolved_log_path  # type: ignore[attr-defined]
        logger.addHandler(file_handler)

    if not any(getattr(handler, "_odds_console", False) for handler in logger.handlers):
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        console_handler._odds_console = True  # type: ignore[attr-defined]
        logger.addHandler(console_handler)

    return logger
