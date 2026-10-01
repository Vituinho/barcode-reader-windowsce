SHA = "a" * 64


def release(platform="WINDOWS_DESKTOP", version="1.0.0", active=True, **extra):
    body = {"platform": platform, "version": version, "fileName": f"GivovaCollector-Simulator-v{version}.zip",
            "downloadUrl": f"https://github.com/org/repo/releases/download/v{version}/file.zip",
            "sha256": SHA.upper(), "fileSize": 123456, "releaseNotes": "Primeira versão\x07", "active": active}
    body.update(extra)
    return body


def test_admin_creates_release_and_users_read_latest(client, admin_headers, op_headers):
    r = client.post("/api/admin/releases", json=release(), headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sha256"] == SHA and body["releaseNotes"] == "Primeira versão" and body["active"] is True

    latest = client.get("/api/releases/latest/WINDOWS_DESKTOP?currentVersion=0.9.9", headers=op_headers).json()
    assert latest["version"] == "1.0.0" and latest["updateAvailable"] is True
    same = client.get("/api/releases/latest/WINDOWS_DESKTOP?currentVersion=1.0.0", headers=op_headers).json()
    assert same["updateAvailable"] is False
    assert [x["platform"] for x in client.get("/api/releases", headers=op_headers).json()] == ["WINDOWS_DESKTOP"]


def test_no_ce_release_yet_is_404(client, op_headers):
    r = client.get("/api/releases/latest/WINDOWS_CE", headers=op_headers)
    assert r.status_code == 404 and r.json()["error"] == "NO_RELEASE"
    assert client.get("/api/releases/latest/LINUX", headers=op_headers).status_code == 422


def test_releases_require_authentication(client, seed):
    assert client.get("/api/releases").status_code == 401


def test_only_admin_can_modify(client, op_headers):
    assert client.post("/api/admin/releases", json=release(), headers=op_headers).status_code == 403
    assert client.get("/api/admin/releases", headers=op_headers).status_code == 403


def test_one_active_release_per_platform(client, admin_headers):
    first = client.post("/api/admin/releases", json=release(version="1.0.0"), headers=admin_headers).json()
    second = client.post("/api/admin/releases", json=release(version="1.0.1"), headers=admin_headers).json()
    rows = {r["version"]: r["active"] for r in client.get("/api/admin/releases", headers=admin_headers).json()}
    assert rows == {"1.0.0": False, "1.0.1": True}
    client.post(f"/api/admin/releases/{first['id']}/activate", headers=admin_headers)
    rows = {r["version"]: r["active"] for r in client.get("/api/admin/releases", headers=admin_headers).json()}
    assert rows == {"1.0.0": True, "1.0.1": False}
    client.post(f"/api/admin/releases/{first['id']}/deactivate", headers=admin_headers)
    assert all(not r["active"] for r in client.get("/api/admin/releases", headers=admin_headers).json())
    dup = client.post("/api/admin/releases", json=release(version="1.0.1"), headers=admin_headers)
    assert dup.status_code == 409 and second["id"]


def test_release_metadata_is_validated(client, admin_headers):
    bad = [
        {"downloadUrl": "http://insecure.example.com/f.zip"},
        {"downloadUrl": "https://user:pass@example.com/f.zip"},
        {"downloadUrl": "file:///C:/build/f.zip"},
        {"fileName": "..\..\secret.env"},
        {"fileName": "C:/build/desktop/GivovaCollector.exe"},
        {"version": "1.0"},
        {"sha256": "xyz"},
        {"platform": "ANDROID"},
        {"fileSize": -1},
    ]
    for override in bad:
        r = client.post("/api/admin/releases", json=release(**override), headers=admin_headers)
        assert r.status_code == 422, override


def test_update_release_fields(client, admin_headers):
    created = client.post("/api/admin/releases", json=release(active=False), headers=admin_headers).json()
    r = client.patch(f"/api/admin/releases/{created['id']}",
                     json={"releaseNotes": "Correções", "downloadUrl": None, "fileSize": 999}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["releaseNotes"] == "Correções" and r.json()["fileSize"] == 999
    assert r.json()["downloadUrl"] == created["downloadUrl"]
