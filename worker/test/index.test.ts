import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const env: Env = {
	GEOVELA_ALLOWED_ORIGINS: 'https://elvira-tang.github.io',
	GEOVELA_RATE_LIMIT_PER_MINUTE: '20',
};

const ORIGIN = { Origin: 'https://elvira-tang.github.io' };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /health', () => {
	it('returns ok', async () => {
		const response = await worker.fetch(new Request('https://worker.dev/health'), env);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});

describe('CORS', () => {
	it('allows the GeoVela origin on preflight', async () => {
		const response = await worker.fetch(
			new Request('https://worker.dev/v1/intent', {
				method: 'OPTIONS',
				headers: { ...ORIGIN, 'Access-Control-Request-Method': 'POST' },
			}),
			env,
		);
		expect(response.headers.get('access-control-allow-origin')).toBe('https://elvira-tang.github.io');
	});

	it('omits CORS headers for unknown origins', async () => {
		const response = await worker.fetch(
			new Request('https://worker.dev/health', { headers: { Origin: 'https://evil.example' } }),
			env,
		);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('POST /v1/intent', () => {
	it('rejects insecure provider endpoints with 422', async () => {
		const response = await worker.fetch(
			new Request('https://worker.dev/v1/intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ORIGIN },
				body: JSON.stringify({ endpoint: 'http://example.com/v1', model: 'test', message: 'hello' }),
			}),
			env,
		);
		expect(response.status).toBe(422);
	});

	it('rejects private provider destinations with 400', async () => {
		for (const endpoint of ['https://127.0.0.1/v1', 'https://192.168.1.1/v1', 'https://localhost/v1', 'https://[::1]/v1']) {
			const response = await worker.fetch(
				new Request('https://worker.dev/v1/intent', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...ORIGIN },
					body: JSON.stringify({ endpoint, model: 'test', message: '定位无锡' }),
				}),
				env,
			);
			expect(response.status).toBe(400);
			expect(((await response.json()) as { detail: string }).detail).toContain('Private');
		}
	});

	it('forwards credentials upstream and returns the parsed intent', async () => {
		const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://provider.example/v1/chat/completions');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret');
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: '{"scope":"city","city":"无锡","action":"locate","metric":"temperature"}' } }],
				}),
			);
		});
		vi.stubGlobal('fetch', upstream);

		const response = await worker.fetch(
			new Request('https://worker.dev/v1/intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ORIGIN },
				body: JSON.stringify({
					endpoint: 'https://provider.example/v1',
					model: 'test-model',
					api_key: 'secret',
					message: '定位到无锡市',
				}),
			}),
			env,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ scope: 'city', city: '无锡', action: 'locate', metric: 'temperature' });
		expect(upstream).toHaveBeenCalledOnce();
	});

	it('masks upstream errors as 502', async () => {
		vi.stubGlobal('fetch', async () => new Response('rate limited', { status: 429 }));
		const response = await worker.fetch(
			new Request('https://worker.dev/v1/intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ORIGIN },
				body: JSON.stringify({ endpoint: 'https://provider.example/v1', model: 'test', message: 'hello' }),
			}),
			env,
		);
		expect(response.status).toBe(502);
		expect(((await response.json()) as { detail: string }).detail).toBe('Provider returned HTTP 429');
	});

	it('rate-limits repeated requests from the same IP', async () => {
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { content: '{"scope":"nationwide","action":"weather","metric":"temperature"}' } }],
					}),
				),
		);
		const limitedEnv: Env = { ...env, GEOVELA_RATE_LIMIT_PER_MINUTE: '2' };
		const makeRequest = () =>
			worker.fetch(
				new Request('https://worker.dev/v1/intent', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'CF-Connecting-IP': '203.0.113.10',
						...ORIGIN,
					},
					body: JSON.stringify({ endpoint: 'https://provider.example/v1', model: 'test', message: '全国天气' }),
				}),
				limitedEnv,
			);
		expect((await makeRequest()).status).toBe(200);
		expect((await makeRequest()).status).toBe(200);
		const third = await makeRequest();
		expect(third.status).toBe(429);
		expect(((await third.json()) as { detail: string }).detail).toBe('Too many requests');
	});
});

describe('POST /v1/run', () => {
	it('returns a validated SSE tool plan for a city chart request', async () => {
		vi.stubGlobal(
			'fetch',
			async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"scope":"city","city":"无锡","action":"chart","metric":"temperature"}' } }] })),
		);
		const response = await worker.fetch(
			new Request('https://worker.dev/v1/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.44', ...ORIGIN },
				body: JSON.stringify({ endpoint: 'https://provider.example/v1', model: 'test', message: '绘制无锡温度趋势图' }),
			}),
			env,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		const body = await response.text();
		expect(body).toMatch(/"run_id":"[^"]+"/);
		expect(body).toContain('"sequence":1');
		expect(body).toContain('"duration_ms":');
		expect(body).toContain('event: tool_result');
		expect(body).toContain('"tool":"map.fly_to"');
		expect(body).toContain('"city":"无锡"');
		expect(body).toContain('"tool":"chart.render"');
		expect(body).toContain('event: assistant_message');
	});
});
