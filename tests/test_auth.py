from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import auth as auth_module
from backend.api import app


@pytest.fixture(autouse=True)
def auth_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "correct-password")
    monkeypatch.delenv("ADMIN_PASSWORD_HASH", raising=False)
    monkeypatch.setenv("AUTH_SECRET_KEY", "test-secret-key-for-auth")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("AUTH_LOGIN_MAX_FAILURES", "2")
    monkeypatch.setenv("AUTH_LOGIN_WINDOW_SECONDS", "60")
    auth_module.reset_login_failures()


def test_public_match_api_allows_anonymous_read() -> None:
    client = TestClient(app)

    response = client.get("/api/matches")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/discovery/matches"),
        ("get", "/api/matches/example/raw"),
        ("get", "/api/matches/example/export.csv"),
        ("get", "/api/matches/example/chart.png"),
        ("post", "/api/config/matches"),
        ("delete", "/api/config/matches/example"),
        ("post", "/api/config/matches/example/pause"),
        ("delete", "/api/config/matches/example/pause"),
    ],
)
def test_protected_api_requires_login(method: str, path: str) -> None:
    client = TestClient(app)

    response = getattr(client, method)(path)

    assert response.status_code == 401


def test_login_failure_uses_generic_error() -> None:
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})

    assert response.status_code == 401
    assert response.json() == {"detail": "用户名或密码错误"}


def test_login_success_allows_protected_route_to_execute() -> None:
    client = TestClient(app)

    login_response = client.post("/api/auth/login", json={"username": "admin", "password": "correct-password"})
    protected_response = client.get("/api/matches/not-found/raw")
    session_response = client.get("/api/auth/session")

    assert login_response.status_code == 200
    assert auth_module.SESSION_COOKIE_NAME in client.cookies
    assert protected_response.status_code == 404
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["user"]["username"] == "admin"


def test_login_rate_limit_after_repeated_failures() -> None:
    client = TestClient(app)

    first_response = client.post("/api/auth/login", json={"username": "admin", "password": "bad-1"})
    second_response = client.post("/api/auth/login", json={"username": "admin", "password": "bad-2"})
    limited_response = client.post("/api/auth/login", json={"username": "admin", "password": "correct-password"})

    assert first_response.status_code == 401
    assert second_response.status_code == 401
    assert limited_response.status_code == 429


def test_session_is_invalid_when_secret_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    token = auth_module.create_session_token("admin")

    monkeypatch.delenv("AUTH_SECRET_KEY", raising=False)

    assert auth_module.read_session_token(token) is None


@pytest.mark.parametrize("token", ["非法.token", "bad-payload.bad-signature"])
def test_invalid_session_token_returns_none(token: str) -> None:
    assert auth_module.read_session_token(token) is None
