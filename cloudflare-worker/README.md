# GeoVela Cloudflare Worker

Free-tier Agent API gateway for the GeoVela GitHub Pages app.

```bash
npx wrangler deploy --config cloudflare-worker/wrangler.jsonc
```

The Worker accepts `POST /v1/intent` and `GET /health`. API keys are forwarded in memory and are never stored. CORS is restricted to GeoVela and local development origins. Rate limiting is best-effort per Worker isolate; production abuse protection should additionally use a Cloudflare WAF rate-limiting rule or a Rate Limiting binding.

After deployment, enter the resulting `https://geovela-agent.<subdomain>.workers.dev` URL in GeoVela under **Agent API 设置 → 安全代理**.
