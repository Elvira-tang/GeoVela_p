# GeoVela Agent Server

Small BYOK gateway for the GeoVela browser app. It validates weather-agent intents, restricts CORS, rate-limits callers, blocks private provider destinations, and never persists API keys.

## Local development

Use Python 3.11–3.13:

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/pytest -q
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Set `GEOVELA_ALLOWED_ORIGINS` to a comma-separated origin list. The default allows the production GitHub Pages origin and local Vite ports 5173/5174.

## Deploy

The repository-level `render.yaml` defines a Docker deployment using Python 3.12. In Render, create a Blueprint from this repository. After deployment:

1. Open GeoVela Agent settings.
2. Choose **安全代理**.
3. Enter the deployed service URL as **GeoVela Agent Server**.
4. Enter the provider endpoint, model, and API key.
5. Test and connect.

The current gateway is stateless. It does not yet provide user accounts or encrypted long-term credential storage.
