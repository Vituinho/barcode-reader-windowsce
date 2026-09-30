import pytest

from app.core.config import Settings, normalize_database_url


@pytest.mark.parametrize("url", [
    "postgres://u:p@host:5432/db",
    "postgresql://u:p@host:5432/db",
    "postgresql+psycopg://u:p@host:5432/db",
])
def test_railway_database_urls_use_psycopg_driver(url):
    assert normalize_database_url(url) == "postgresql+psycopg://u:p@host:5432/db"


def test_admin_web_origin_is_exact_and_trimmed():
    s = Settings(admin_web_origin="https://admin.up.railway.app/, http://localhost:3000")
    assert s.cors_origin_list == ["https://admin.up.railway.app", "http://localhost:3000"]


def test_wildcard_cors_is_refused():
    with pytest.raises(RuntimeError):
        Settings(admin_web_origin="*").cors_origin_list


def test_cors_allows_admin_origin_only(client):
    ok = client.options("/api/health", headers={"Origin": "https://admin.example.com",
                                                 "Access-Control-Request-Method": "GET"})
    bad = client.options("/api/health", headers={"Origin": "https://evil.example.com",
                                                  "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://admin.example.com"
    assert "access-control-allow-origin" not in bad.headers
