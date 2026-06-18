from __future__ import annotations

from backend.env_loader import load_env_file, parse_env_line


def test_parse_env_line_supports_comments_and_quotes() -> None:
    assert parse_env_line("ADMIN_USERNAME=admin # local only") == ("ADMIN_USERNAME", "admin")
    assert parse_env_line('ADMIN_PASSWORD="abc#123"') == ("ADMIN_PASSWORD", "abc#123")
    assert parse_env_line("export AUTH_COOKIE_SECURE=false") == ("AUTH_COOKIE_SECURE", "false")
    assert parse_env_line("# ADMIN_PASSWORD=ignored") is None


def test_load_env_file_does_not_override_existing_env(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "ADMIN_USERNAME=file-admin",
                "AUTH_SECRET_KEY=file-secret",
                "AUTH_SESSION_TTL_SECONDS=7200",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("ADMIN_USERNAME", "shell-admin")
    monkeypatch.delenv("AUTH_SECRET_KEY", raising=False)
    monkeypatch.delenv("AUTH_SESSION_TTL_SECONDS", raising=False)

    loaded_keys = load_env_file(env_file)

    assert "ADMIN_USERNAME" not in loaded_keys
    assert "AUTH_SECRET_KEY" in loaded_keys
    assert "AUTH_SESSION_TTL_SECONDS" in loaded_keys
    assert loaded_keys == ["AUTH_SECRET_KEY", "AUTH_SESSION_TTL_SECONDS"]
