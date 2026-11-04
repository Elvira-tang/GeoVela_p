from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_rejects_insecure_provider():
    response = client.post("/v1/intent", json={"endpoint": "http://example.com/v1", "model": "test", "message": "hello"})
    assert response.status_code == 422


def test_cors_allows_geovela_origin():
    response = client.options("/v1/intent", headers={"Origin": "https://elvira-tang.github.io", "Access-Control-Request-Method": "POST"})
    assert response.headers["access-control-allow-origin"] == "https://elvira-tang.github.io"
