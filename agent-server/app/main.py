import ipaddress
import os
import socket
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, SecretStr, field_validator

SYSTEM_PROMPT = """You route Chinese user requests for a weather GIS web app.
Return exactly one JSON object and no markdown:
{"scope":"nationwide|city","city":"Chinese city name without 市 suffix","action":"weather|locate|predict|chart","metric":"temperature|rain|wind"}
Rules: locate means moving the map; predict means a future forecast/model request; chart means a chart/trend request; otherwise weather. Use nationwide when the request mentions China/nationwide/all cities."""


class IntentRequest(BaseModel):
    endpoint: str = Field(max_length=500)
    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr | None = None
    message: str = Field(min_length=1, max_length=1000)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Provider endpoint must use HTTPS")
        return value.rstrip("/")


class WeatherIntent(BaseModel):
    scope: str
    city: str | None = None
    action: str
    metric: str

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, value: str) -> str:
        if value not in {"nationwide", "city"}:
            raise ValueError("Invalid scope")
        return value

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        if value not in {"weather", "locate", "predict", "chart"}:
            raise ValueError("Invalid action")
        return value

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, value: str) -> str:
        if value not in {"temperature", "rain", "wind"}:
            raise ValueError("Invalid metric")
        return value


origins = [item.strip() for item in os.getenv("GEOVELA_ALLOWED_ORIGINS", "https://elvira-tang.github.io,http://127.0.0.1:5173,http://127.0.0.1:5174").split(",") if item.strip()]
app = FastAPI(title="GeoVela Agent Gateway", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

requests_by_ip: dict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT = int(os.getenv("GEOVELA_RATE_LIMIT_PER_MINUTE", "20"))


def enforce_rate_limit(ip: str) -> None:
    now = time.monotonic()
    window = requests_by_ip[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many requests")
    window.append(now)


def reject_private_destination(endpoint: str) -> None:
    hostname = urlparse(endpoint).hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid provider endpoint")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="Provider hostname cannot be resolved") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Private provider destinations are not allowed")


def completion_url(endpoint: str) -> str:
    return endpoint if endpoint.endswith("/chat/completions") else f"{endpoint}/chat/completions"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/intent", response_model=WeatherIntent)
async def route_intent(payload: IntentRequest, request: Request) -> WeatherIntent:
    enforce_rate_limit(request.client.host if request.client else "unknown")
    reject_private_destination(payload.endpoint)
    headers = {"Content-Type": "application/json"}
    if payload.api_key:
        headers["Authorization"] = f"Bearer {payload.api_key.get_secret_value()}"
    body = {
        "model": payload.model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": payload.message},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(completion_url(payload.endpoint), headers=headers, json=body)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Provider returned HTTP {response.status_code}")
        content = response.json()["choices"][0]["message"]["content"]
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < start:
            raise ValueError("Missing JSON object")
        return WeatherIntent.model_validate_json(content[start : end + 1])
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Provider response could not be processed") from exc
