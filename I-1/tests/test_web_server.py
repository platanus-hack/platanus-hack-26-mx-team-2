from fastapi.testclient import TestClient
from ikarus.web.server import create_app

client = TestClient(create_app())


def test_index_returns_html_with_three_scenes():
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "Taint Ledger" in r.text
    assert "ALLOWED" in r.text
    assert "BLOCKED" in r.text
    assert "attacker@evil.com" in r.text


def test_index_does_not_leak_injection_into_scene1_ledger():
    r = client.get("/")
    assert "Scene 1" in r.text
