/**
 * GeoVela Agent Gateway — Cloudflare Worker 版
 * 与原 FastAPI 网关（agent-server/app/main.py）行为保持一致：
 * - POST /v1/intent：把用户消息转发给 OpenAI 兼容端点，返回受控 GIS 意图 JSON
 * - POST /v1/run：以 SSE 返回意图工具结果、受控工具调用计划和最终消息
 * - GET  /health：健康检查
 * - CORS 来源白名单、每 IP 限流、阻止内网/回环/非 HTTPS 模型端点
 * - API Key 仅转发，不保存
 */

const SYSTEM_PROMPT = `You route Chinese user requests for a weather GIS web app.
Return exactly one JSON object and no markdown:
{"scope":"nationwide|city","city":"Chinese city name without 市 suffix","action":"weather|locate|predict|chart","metric":"temperature|rain|wind"}
Rules: locate means moving the map; predict means a future forecast/model request; chart means a chart/trend request; otherwise weather. Use nationwide when the request mentions China/nationwide/all cities.`;

const DEFAULT_ORIGINS = 'https://elvira-tang.github.io,http://127.0.0.1:5173,http://127.0.0.1:5174';
const DEFAULT_RATE_LIMIT = 20;
const UPSTREAM_TIMEOUT_MS = 20_000;

interface RateLimitResult {
	success: boolean;
}

interface RateLimitBinding {
	limit(options: { key: string }): Promise<RateLimitResult>;
}

export interface Env {
	GEOVELA_ALLOWED_ORIGINS?: string;
	GEOVELA_RATE_LIMIT_PER_MINUTE?: string;
	INTENT_LIMITER?: RateLimitBinding;
}

interface IntentRequest {
	endpoint: string;
	model: string;
	api_key?: string | null;
	message: string;
}

interface WeatherIntent {
	scope: 'nationwide' | 'city';
	city?: string | null;
	action: 'weather' | 'locate' | 'predict' | 'chart';
	metric: 'temperature' | 'rain' | 'wind';
}

interface ToolCallEvent {
	type: 'tool_call';
	tool: string;
	arguments: Record<string, unknown>;
}

interface AgentMessage {
	role: 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_call_id?: string;
	tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

interface AgentTurnRequest extends IntentRequest {
	messages?: AgentMessage[];
	run_id?: string;
	sequence?: number;
}

const AGENT_SYSTEM_PROMPT = `You are GeoVela, a general data-driven Web GIS agent. The user message contains a real workspace:// file URI and a schema/sample already resolved by the browser.
Inspect the dataset with dataset.describe/query. Select tools from the user's request: add the dataset to the map, apply categorized or graduated POI styling, build a six-panel analytical dashboard, show a table, and/or generate a substantial report containing data quality, descriptive statistics, charts and evidence-based interpretation.
Never invent rows, statistics, map state or completed artifacts. The browser computes visualizations from the full local dataset; do not send fabricated chart rows or GeoJSON. Call tools until the requested deliverables actually succeed, then answer concisely in Chinese and cite returned workspace URIs.`;

const AGENT_TOOLS = [
	{ type: 'function', function: { name: 'dataset.describe', description: 'Describe the active dataset schema, extent, geometry and size.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
	{ type: 'function', function: { name: 'dataset.query', description: 'Read a bounded sample of rows from the active dataset for analysis.', parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
	{ type: 'function', function: { name: 'map.add_dataset_layer', description: 'Convert the active local CSV coordinates to a map layer and zoom to it.', parameters: { type: 'object', properties: { style: { type: 'string', enum: ['circle', 'categorized', 'graduated'] }, field: { type: 'string' } }, additionalProperties: false } } },
	{ type: 'function', function: { name: 'map.set_poi_style', description: 'Apply categorized or graduated thematic styling to the active POI dataset.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['categorized', 'graduated'] }, field: { type: 'string', description: 'Existing categorical or numeric field.' } }, required: ['mode', 'field'], additionalProperties: false } } },
	{ type: 'function', function: { name: 'chart.render_dashboard', description: 'Render a six-panel analytical dashboard computed from the full active dataset.', parameters: { type: 'object', properties: { title: { type: 'string' }, category_field: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } }, required: ['title'], additionalProperties: false } } },
	{ type: 'function', function: { name: 'report.generate', description: 'Generate and save a detailed report with data quality, statistics, the dashboard, interpretations and conclusions.', parameters: { type: 'object', properties: { title: { type: 'string' }, category_field: { type: 'string' }, methodology: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } }, required: ['title', 'methodology', 'findings'], additionalProperties: false } } },
	{ type: 'function', function: { name: 'table.show', description: 'Open the active local dataset in a table tab.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
] as const;

class HttpError extends Error {
	constructor(
		public status: number,
		detail: string,
	) {
		super(detail);
	}
}

function allowedOrigins(env: Env): string[] {
	return (env.GEOVELA_ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get('Origin');
	if (origin && allowedOrigins(env).includes(origin)) {
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Methods': 'GET, POST',
			'Access-Control-Allow-Headers': 'Content-Type',
			Vary: 'Origin',
		};
	}
	return {};
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...cors },
	});
}

function errorResponse(error: HttpError, cors: Record<string, string>): Response {
	return jsonResponse({ detail: error.message }, error.status, cors);
}

function sseEvent(event: string, payload: unknown, runId: string, sequence: number, durationMs?: number): string {
	const data = {
		run_id: runId,
		sequence,
		emitted_at: new Date().toISOString(),
		...(durationMs === undefined ? {} : { duration_ms: durationMs }),
		payload,
	};
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toolEventsForIntent(intent: WeatherIntent): ToolCallEvent[] {
	if (intent.scope === 'nationwide') {
		const metric = intent.metric === 'rain' ? 'precipitationMm' : intent.metric === 'wind' ? 'maxWindSpeedKmh' : 'maxTemperatureC';
		return [
			{ type: 'tool_call', tool: 'weather.set_metric', arguments: { metric } },
			{ type: 'tool_call', tool: 'map.fit_bounds', arguments: { bounds: [[73, 18], [135, 54]], padding: 38, duration: 800 } },
		];
	}
	const city = (intent.city ?? '').replace(/市$/, '');
	const events: ToolCallEvent[] = [
		{ type: 'tool_call', tool: 'weather.select_city', arguments: { city } },
		{ type: 'tool_call', tool: 'map.fly_to', arguments: { city, zoom: intent.action === 'locate' ? 8.5 : 6.5, duration: 900 } },
	];
	if (intent.action === 'chart') {
		events.push({ type: 'tool_call', tool: 'chart.render', arguments: { city, chart: 'temperature' } });
	} else if (intent.action === 'predict') {
		events.push({ type: 'tool_call', tool: 'chart.render', arguments: { city, chart: 'model-comparison' } });
	}
	return events;
}

function runResponse(intent: WeatherIntent, cors: Record<string, string>, intentDurationMs: number): Response {
	const runId = crypto.randomUUID();
	const routeCall = { type: 'tool_call', tool: 'ai.route_intent', arguments: {} };
	let sequence = 0;
	const chunks = [
		sseEvent('tool_call', routeCall, runId, ++sequence),
		sseEvent('tool_result', { type: 'tool_result', tool: 'ai.route_intent', result: intent }, runId, ++sequence, intentDurationMs),
		...toolEventsForIntent(intent).map((event) => sseEvent('tool_call', event, runId, ++sequence)),
		sseEvent('assistant_message', { type: 'assistant_message', status: 'success', text: '工具计划已生成' }, runId, ++sequence),
	];
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no',
			...cors,
		},
	});
}

// ---- 限流：优先使用 Cloudflare 原生 Rate Limiting 绑定，缺失时回退到单实例内存限流 ----
const requestsByIp = new Map<string, number[]>();

async function enforceRateLimit(ip: string, env: Env): Promise<void> {
	if (env.INTENT_LIMITER) {
		const { success } = await env.INTENT_LIMITER.limit({ key: ip });
		if (!success) throw new HttpError(429, 'Too many requests');
		return;
	}
	const limit = Number.parseInt(env.GEOVELA_RATE_LIMIT_PER_MINUTE ?? '', 10) || DEFAULT_RATE_LIMIT;
	const now = Date.now();
	const window = requestsByIp.get(ip) ?? [];
	while (window.length > 0 && now - window[0] > 60_000) window.shift();
	if (window.length >= limit) throw new HttpError(429, 'Too many requests');
	window.push(now);
	requestsByIp.set(ip, window);
}

// ---- SSRF 防护：Worker 无法做 DNS 解析，退化为严格的主机名检查 ----
function isPrivateIpv4(hostname: string): boolean {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (!match) return false;
	const [a, b] = [Number(match[1]), Number(match[2])];
	if (a === 0 || a === 10 || a === 127) return true; // 本网络 / 私网 / 回环
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	if (a === 169 && b === 254) return true; // 链路本地
	if (a === 172 && b >= 16 && b <= 31) return true; // 私网
	if (a === 192 && b === 0) return true; // 协议分配段
	if (a === 192 && b === 168) return true; // 私网
	if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试段
	if (a >= 224) return true; // 组播 / 保留
	return false;
}

function rejectPrivateDestination(endpoint: string): void {
	const hostname = new URL(endpoint).hostname.toLowerCase();
	if (
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal') ||
		hostname.startsWith('[') || // IPv6 字面量（含回环/链路本地/ULA），一律拒绝
		isPrivateIpv4(hostname)
	) {
		throw new HttpError(400, 'Private provider destinations are not allowed');
	}
}

// ---- 请求体校验（与原 pydantic 模型一致）----
function parseIntentRequest(body: unknown): IntentRequest {
	if (typeof body !== 'object' || body === null) {
		throw new HttpError(422, 'Request body must be a JSON object');
	}
	const { endpoint, model, api_key, message } = body as Record<string, unknown>;
	if (typeof endpoint !== 'string' || endpoint.length > 500) {
		throw new HttpError(422, 'Invalid endpoint');
	}
	let url: URL;
	try {
		url = new URL(endpoint.trim());
	} catch {
		throw new HttpError(422, 'Provider endpoint must use HTTPS');
	}
	if (url.protocol !== 'https:' || !url.hostname) {
		throw new HttpError(422, 'Provider endpoint must use HTTPS');
	}
	if (typeof model !== 'string' || model.length < 1 || model.length > 200) {
		throw new HttpError(422, 'Invalid model');
	}
	if (typeof message !== 'string' || message.length < 1 || message.length > 1000) {
		throw new HttpError(422, 'Invalid message');
	}
	if (api_key !== undefined && api_key !== null && typeof api_key !== 'string') {
		throw new HttpError(422, 'Invalid api_key');
	}
	return {
		endpoint: endpoint.trim().replace(/\/$/, ''),
		model,
		api_key: (api_key as string | null | undefined) ?? null,
		message,
	};
}

function parseAgentTurnRequest(body: unknown): AgentTurnRequest {
	const base = parseIntentRequest(body);
	const value = body as Record<string, unknown>;
	const runId = value.run_id;
	const sequence = value.sequence;
	if (runId !== undefined && (typeof runId !== 'string' || runId.length > 100)) throw new HttpError(422, 'Invalid run_id');
	if (sequence !== undefined && (!Number.isInteger(sequence) || (sequence as number) < 0 || (sequence as number) > 100)) throw new HttpError(422, 'Invalid sequence');
	if (value.messages !== undefined && !Array.isArray(value.messages)) throw new HttpError(422, 'Invalid messages');
	const messages = (value.messages ?? []) as unknown[];
	if (messages.length > 40) throw new HttpError(422, 'Too many messages');
	for (const item of messages) {
		if (typeof item !== 'object' || item === null) throw new HttpError(422, 'Invalid message');
		const message = item as Record<string, unknown>;
		if (!['user', 'assistant', 'tool'].includes(String(message.role))) throw new HttpError(422, 'Invalid message role');
		if (message.content !== null && typeof message.content !== 'string') throw new HttpError(422, 'Invalid message content');
		if (typeof message.content === 'string' && message.content.length > 40_000) throw new HttpError(422, 'Message too large');
	}
	return { ...base, messages: messages as AgentMessage[], run_id: runId as string | undefined, sequence: sequence as number | undefined };
}

const VALID_SCOPES = new Set(['nationwide', 'city']);
const VALID_ACTIONS = new Set(['weather', 'locate', 'predict', 'chart']);
const VALID_METRICS = new Set(['temperature', 'rain', 'wind']);

function parseWeatherIntent(content: string): WeatherIntent {
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start < 0 || end < start) throw new Error('Missing JSON object');
	let value: unknown;
	try {
		value = JSON.parse(content.slice(start, end + 1));
	} catch {
		throw new Error('Invalid JSON object');
	}
	const intent = value as Record<string, unknown>;
	if (typeof intent.scope !== 'string' || !VALID_SCOPES.has(intent.scope)) throw new Error('Invalid scope');
	if (typeof intent.action !== 'string' || !VALID_ACTIONS.has(intent.action)) throw new Error('Invalid action');
	if (typeof intent.metric !== 'string' || !VALID_METRICS.has(intent.metric)) throw new Error('Invalid metric');
	const city = typeof intent.city === 'string' ? intent.city : null;
	return intent as unknown as WeatherIntent & { city: string | null };
}

function completionUrl(endpoint: string): string {
	return endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
}

async function routeIntent(payload: IntentRequest): Promise<WeatherIntent> {
	rejectPrivateDestination(payload.endpoint);
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (payload.api_key) headers.Authorization = `Bearer ${payload.api_key}`;
	let response: Response;
	try {
		response = await fetch(completionUrl(payload.endpoint), {
			method: 'POST',
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			body: JSON.stringify({
				model: payload.model,
				temperature: 0,
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: payload.message },
				],
			}),
		});
	} catch (error) {
		throw new HttpError(502, 'Provider response could not be processed');
	}
	if (response.status >= 400) {
		throw new HttpError(502, `Provider returned HTTP ${response.status}`);
	}
	try {
		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content;
		if (!content) throw new Error('Missing content');
		return parseWeatherIntent(content);
	} catch {
		throw new HttpError(502, 'Provider response could not be processed');
	}
}

async function runAgentTurn(payload: AgentTurnRequest, cors: Record<string, string>): Promise<Response> {
	rejectPrivateDestination(payload.endpoint);
	const runId = payload.run_id ?? crypto.randomUUID();
	let sequence = payload.sequence ?? 0;
	const history: AgentMessage[] = payload.messages?.length ? payload.messages : [{ role: 'user', content: payload.message }];
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (payload.api_key) headers.Authorization = `Bearer ${payload.api_key}`;
	let response: Response;
	const startedAt = Date.now();
	try {
		response = await fetch(completionUrl(payload.endpoint), {
			method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			body: JSON.stringify({ model: payload.model, temperature: 0, messages: [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...history], tools: AGENT_TOOLS, tool_choice: 'auto' }),
		});
	} catch {
		throw new HttpError(502, 'Provider response could not be processed');
	}
	if (response.status >= 400) throw new HttpError(502, `Provider returned HTTP ${response.status}`);
	let message: AgentMessage;
	try {
		const data = await response.json() as { choices?: Array<{ message?: AgentMessage }> };
		if (!data.choices?.[0]?.message) throw new Error('Missing message');
		message = data.choices[0].message;
	} catch {
		throw new HttpError(502, 'Provider response could not be processed');
	}
	const chunks: string[] = [];
	for (const call of message.tool_calls ?? []) {
		let args: unknown;
		try { args = JSON.parse(call.function.arguments); } catch { throw new HttpError(502, 'Provider returned invalid tool arguments'); }
		chunks.push(sseEvent('tool_call', { type: 'tool_call', id: call.id, tool: call.function.name, arguments: args }, runId, ++sequence, Date.now() - startedAt));
	}
	if (!(message.tool_calls?.length)) {
		chunks.push(sseEvent('assistant_message', { type: 'assistant_message', status: 'success', text: message.content ?? '' }, runId, ++sequence, Date.now() - startedAt));
	}
	chunks.push(sseEvent('turn_state', { message }, runId, ++sequence));
	return new Response(chunks.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', ...cors } });
}

async function searchMilkTeaPois(url: URL, cors: Record<string, string>): Promise<Response> {
	const parts = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
	if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) throw new HttpError(422, 'Invalid bbox');
	const [south, west, north, east] = parts;
	if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east || (north - south) * (east - west) > 30) throw new HttpError(422, 'bbox is too large');
	const query = `[out:json][timeout:20];(nwr["shop"="tea"](${south},${west},${north},${east});nwr["cuisine"~"bubble_tea|tea"](${south},${west},${north},${east});nwr["name"~"奶茶|茶百道|蜜雪冰城|喜茶|奈雪|CoCo|一点点",i](${south},${west},${north},${east}););out center tags 300;`;
	let upstream: Response;
	try { upstream = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(25_000) }); }
	catch { throw new HttpError(502, 'POI provider could not be reached'); }
	if (!upstream.ok) throw new HttpError(502, `POI provider returned HTTP ${upstream.status}`);
	const data = await upstream.json() as { elements?: Array<{ id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
	const features = (data.elements ?? []).flatMap((item) => {
		const latitude = item.lat ?? item.center?.lat; const longitude = item.lon ?? item.center?.lon;
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
		return [{ type: 'Feature', id: item.id, geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: { name: item.tags?.name ?? '奶茶店', brand: item.tags?.brand ?? '', address: item.tags?.['addr:full'] ?? '', osm_id: item.id } }];
	});
	return jsonResponse({ type: 'FeatureCollection', features }, 200, cors);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const cors = corsHeaders(request, env);
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: cors });
		}

		try {
			if (request.method === 'GET' && url.pathname === '/health') {
				return jsonResponse({ status: 'ok' }, 200, cors);
			}
			if (request.method === 'GET' && url.pathname === '/v1/poi/milk-tea') {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
				await enforceRateLimit(ip, env);
				return searchMilkTeaPois(url, cors);
			}
			if (request.method === 'POST' && (url.pathname === '/v1/intent' || url.pathname === '/v1/run')) {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
				await enforceRateLimit(ip, env);
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					throw new HttpError(422, 'Request body must be valid JSON');
				}
				const payload = parseIntentRequest(body);
				const startedAt = Date.now();
				const intent = await routeIntent(payload);
				return url.pathname === '/v1/run' ? runResponse(intent, cors, Date.now() - startedAt) : jsonResponse(intent, 200, cors);
			}
			if (request.method === 'POST' && url.pathname === '/v1/agent/turn') {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
				await enforceRateLimit(ip, env);
				let body: unknown;
				try { body = await request.json(); } catch { throw new HttpError(422, 'Request body must be valid JSON'); }
				return runAgentTurn(parseAgentTurnRequest(body), cors);
			}
			return errorResponse(new HttpError(404, 'Not found'), cors);
		} catch (error) {
			if (error instanceof HttpError) return errorResponse(error, cors);
			return errorResponse(new HttpError(500, 'Internal server error'), cors);
		}
	},
};
