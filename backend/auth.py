from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any


SESSION_COOKIE_NAME = "odds_admin_session"
ADMIN_ROLE = "admin"

_DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12
_DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60
_DEFAULT_LOGIN_MAX_FAILURES = 5
_login_failures: dict[tuple[str, str], tuple[int, float]] = {}


@dataclass(frozen=True)
class AuthSession:
    username: str
    role: str
    expires_at: int


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        return max(minimum, int(raw_value))
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name, "").strip().lower()
    if not raw_value:
        return default
    return raw_value in {"1", "true", "yes", "on"}


def configured_admin_username() -> str:
    return os.getenv("ADMIN_USERNAME", "admin").strip() or "admin"


def session_ttl_seconds() -> int:
    return _env_int("AUTH_SESSION_TTL_SECONDS", _DEFAULT_SESSION_TTL_SECONDS)


def cookie_secure() -> bool:
    return _env_bool("AUTH_COOKIE_SECURE", False)


def cookie_samesite() -> str:
    value = os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower()
    return value if value in {"lax", "strict", "none"} else "lax"


def auth_configured() -> bool:
    username = os.getenv("ADMIN_USERNAME", "").strip()
    return bool(
        username
        and auth_secret()
        and (os.getenv("ADMIN_PASSWORD", "").strip() or os.getenv("ADMIN_PASSWORD_HASH", "").strip())
    )


def client_login_key(client_ip: str, username: str) -> tuple[str, str]:
    return (client_ip or "-", username.strip().lower() or "-")


def login_window_seconds() -> int:
    return _env_int("AUTH_LOGIN_WINDOW_SECONDS", _DEFAULT_LOGIN_WINDOW_SECONDS)


def login_max_failures() -> int:
    return _env_int("AUTH_LOGIN_MAX_FAILURES", _DEFAULT_LOGIN_MAX_FAILURES)


def login_is_limited(client_ip: str, username: str) -> bool:
    key = client_login_key(client_ip, username)
    failure_count, first_failure_at = _login_failures.get(key, (0, 0.0))
    if failure_count <= 0:
        return False
    if time.time() - first_failure_at > login_window_seconds():
        _login_failures.pop(key, None)
        return False
    return failure_count >= login_max_failures()


def record_login_failure(client_ip: str, username: str) -> None:
    key = client_login_key(client_ip, username)
    now = time.time()
    failure_count, first_failure_at = _login_failures.get(key, (0, now))
    if now - first_failure_at > login_window_seconds():
        failure_count = 0
        first_failure_at = now
    _login_failures[key] = (failure_count + 1, first_failure_at)


def clear_login_failures(client_ip: str, username: str) -> None:
    _login_failures.pop(client_login_key(client_ip, username), None)


def reset_login_failures() -> None:
    _login_failures.clear()


def create_password_hash(password: str, *, iterations: int = 260_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_urlsafe_b64encode(salt)}${_urlsafe_b64encode(digest)}"


def verify_admin_credentials(username: str, password: str) -> bool:
    expected_username = configured_admin_username()
    username_valid = hmac.compare_digest(username.strip(), expected_username)
    password_hash = os.getenv("ADMIN_PASSWORD_HASH", "").strip()
    plain_password = os.getenv("ADMIN_PASSWORD", "")
    if password_hash:
        password_valid = verify_password_hash(password, password_hash)
    else:
        password_valid = bool(plain_password) and hmac.compare_digest(password, plain_password)
    return username_valid and password_valid


def verify_password_hash(password: str, encoded_hash: str) -> bool:
    if encoded_hash.startswith("pbkdf2_sha256$"):
        parts = encoded_hash.split("$", 3)
        if len(parts) != 4:
            return False
        _, iteration_text, salt_text, digest_text = parts
        try:
            iterations = int(iteration_text)
            salt = _urlsafe_b64decode(salt_text)
            expected_digest = _urlsafe_b64decode(digest_text)
        except (TypeError, ValueError, binascii.Error):
            return False
        actual_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual_digest, expected_digest)

    if encoded_hash.startswith("sha256:"):
        expected_hex = encoded_hash.removeprefix("sha256:")
        actual_hex = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(actual_hex, expected_hex)

    if len(encoded_hash) == 64 and all(character in "0123456789abcdefABCDEF" for character in encoded_hash):
        actual_hex = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(actual_hex, encoded_hash.lower())

    return False


def create_session_token(username: str, *, role: str = ADMIN_ROLE) -> str:
    if not auth_secret():
        raise RuntimeError("AUTH_SECRET_KEY is required")
    expires_at = int(time.time()) + session_ttl_seconds()
    payload = {"sub": username, "role": role, "exp": expires_at}
    payload_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    payload_text = _urlsafe_b64encode(payload_bytes)
    signature = _sign(payload_text.encode("ascii"))
    return f"{payload_text}.{_urlsafe_b64encode(signature)}"


def read_session_token(token: str | None) -> AuthSession | None:
    if not auth_secret():
        return None
    if not token or "." not in token:
        return None
    payload_text, signature_text = token.split(".", 1)
    try:
        payload_bytes = payload_text.encode("ascii")
        expected_signature = _sign(payload_bytes)
        actual_signature = _urlsafe_b64decode(signature_text)
        payload = json.loads(_urlsafe_b64decode(payload_text))
    except (TypeError, ValueError, UnicodeEncodeError, binascii.Error, json.JSONDecodeError):
        return None
    if not hmac.compare_digest(actual_signature, expected_signature):
        return None
    if not isinstance(payload, dict):
        return None

    username = str(payload.get("sub", "")).strip()
    role = str(payload.get("role", "")).strip()
    try:
        expires_at = int(payload.get("exp", 0))
    except (TypeError, ValueError):
        return None
    if not username or expires_at < int(time.time()):
        return None
    return AuthSession(username=username, role=role, expires_at=expires_at)


def _sign(payload: bytes) -> bytes:
    return hmac.new(auth_secret().encode("utf-8"), payload, hashlib.sha256).digest()


def auth_secret() -> str:
    return os.getenv("AUTH_SECRET_KEY", "").strip()


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
