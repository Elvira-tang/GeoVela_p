# GeoVela Agent Worker

Cloudflare Worker 版 BYOK 网关，替代原 FastAPI 服务（`agent-server/`）。接口行为保持一致：`POST /v1/intent` 转发 OpenAI 兼容端点并返回受控 GIS 意图，`GET /health` 健康检查。具备 CORS 白名单、每 IP 限流、SSRF 防护，API Key 仅转发不保存。

## 本地开发

```bash
npm install
npm test            # vitest，8 项测试
npm run typecheck   # tsc --noEmit
npm run dev         # wrangler dev，本地 8787 端口
```

## 部署

推送到 `main` 且 `worker/**` 有变更时，GitHub Actions（`.github/workflows/deploy-worker.yml`）自动执行测试并部署。需在仓库 Secrets 配置：

- `CLOUDFLARE_API_TOKEN`：Cloudflare Dashboard → My Profile → API Tokens → 使用 "Edit Cloudflare Workers" 模板创建
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Dashboard 右侧栏

也可手动部署：

```bash
npx wrangler deploy
```

部署后把 GeoVela Agent 设置里的 **GeoVela Agent Server** 改为 `https://geovela-agent.<你的子域>.workers.dev`。

## 与原 FastAPI 版的差异

- 限流：优先使用 Cloudflare 原生 Rate Limiting 绑定（`wrangler.toml` 中 `[[ratelimits]]`），绑定不可用时回退到单实例内存限流（近似，随 isolate 回收重置）。
- SSRF 防护：Worker 无法做 DNS 解析检查，改为严格主机名规则（拒绝私网/回环 IP 字面量、`localhost`、`.local`、`.internal`、IPv6 字面量）。
