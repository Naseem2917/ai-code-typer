export interface Env {
	GEMINI_API_KEY: string
}

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
}

// ── Model constants ────────────────────────────────────────────────────────────

const MODEL_LITE = 'gemini-3.5-flash-lite'
const MODEL_MID  = 'gemini-3.6-flash'
const MODEL_HIGH = 'gemini-3.7-flash'

/**
 * Model chains keyed by generation mode.
 * - fast   : Targeted drills, muscle memory, and general typing (prioritizes low latency)
 * - medium : Standard code practice, easy/intermediate snippets (balanced)
 * - hard   : Complex algorithms, multi-step logic, strict tab-indented code
 */
const MODEL_CHAINS: Record<string, string[]> = {
	fast:   [MODEL_LITE, MODEL_MID,  MODEL_HIGH],
	medium: [MODEL_MID,  MODEL_HIGH, MODEL_LITE],
	hard:   [MODEL_HIGH, MODEL_MID,  MODEL_LITE],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the HTTP status code signals a transient/overload error
 * that warrants trying the next model in the fallback chain.
 * Non-retryable errors (401 bad key, 403 forbidden, 400 bad request) will NOT trigger a model switch.
 */
function isRetryableStatus(status: number): boolean {
	return [429, 500, 502, 503, 504].includes(status)
}

/**
 * Clean markdown code fences if AI inadvertently surrounds the snippet in ```
 */
function cleanCodeFence(raw: string): string {
	return raw
		.replace(/^```(?:\w+\n)?/i, '')
		.replace(/\s*```\s*$/, '')
		.trim()
}

// ── Core Gemini caller (single model, with timeout) ───────────────────────────

const REQUEST_TIMEOUT_MS = 20_000 // 20s per-model timeout

async function callGemini(
	apiKey: string,
	model: string,
	userPrompt: string,
	systemPrompt?: string,
): Promise<string> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

	let response: Response
	try {
		const payload: Record<string, unknown> = {
			contents: [{ parts: [{ text: userPrompt }] }],
			generationConfig: {
				temperature: 0.2,
			},
		}

		if (systemPrompt && systemPrompt.trim().length > 0) {
			payload.systemInstruction = { parts: [{ text: systemPrompt }] }
		}

		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey, // Key in header, NOT in URL query string
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		})
	} finally {
		clearTimeout(timer)
	}

	if (!response.ok) {
		const errBody = await response.text().catch(() => response.statusText)
		const err = new Error(`Gemini ${response.status}: ${errBody}`) as Error & { status: number }
		err.status = response.status
		throw err
	}

	const data = (await response.json()) as {
		candidates?: { content?: { parts?: { text?: string }[] } }[]
		error?: { message?: string; code?: number }
	}

	if (data.error) {
		const err = new Error(data.error.message || 'Gemini error') as Error & { status: number }
		err.status = data.error.code || response.status
		throw err
	}

	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
	if (text === undefined || text === null) {
		throw new Error('Gemini returned an empty candidate response')
	}

	return text
}

// ── Multi-model caller with immediate fallback ─────────────────────────────────

interface GeminiResult {
	text: string
	modelUsed: string
	latencyMs: number
}

async function callWithModelList(
	apiKey: string,
	models: string[],
	userPrompt: string,
	systemPrompt?: string,
): Promise<GeminiResult> {
	let lastError: Error = new Error('No models available')

	for (const model of models) {
		const start = Date.now()
		try {
			const rawText = await callGemini(apiKey, model, userPrompt, systemPrompt)
			const text = cleanCodeFence(rawText)
			return { text, modelUsed: model, latencyMs: Date.now() - start }
		} catch (err: unknown) {
			const e = err as Error & { status?: number }
			lastError = e

			// Abort = timeout → try next model immediately
			if (e.name === 'AbortError') {
				console.warn(`[Gemini] ${model} timed out (${REQUEST_TIMEOUT_MS}ms). Trying next model…`)
				continue
			}

			// Retryable server/overload error (429, 500, 502, 503, 504) → try next model immediately
			if (e.status !== undefined && isRetryableStatus(e.status)) {
				console.warn(`[Gemini] ${model} returned ${e.status}. Trying next model…`)
				continue
			}

			// Non-retryable (401 bad key, 403 forbidden, 400 bad payload) → stop immediately
			console.error(`[Gemini] ${model} returned non-retryable error ${e.status ?? 'unknown'}. Aborting fallback.`)
			throw e
		}
	}

	throw lastError
}

// ── Main handler ───────────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS })
		}

		// Health check
		if (url.pathname === '/health' || url.pathname === '/api/health') {
			return Response.json(
				{ success: true, message: 'AI Code Typer Proxy is healthy' },
				{ headers: CORS_HEADERS },
			)
		}

		if (request.method !== 'POST') {
			return Response.json(
				{ error: 'Method Not Allowed' },
				{ status: 405, headers: CORS_HEADERS },
			)
		}

		try {
			const body = (await request.json().catch(() => ({}))) as {
				prompt?: string
				systemInstruction?: string
				mode?: string
			}

			const prompt = body.prompt?.trim()
			if (!prompt) {
				return Response.json(
					{ error: 'Prompt is required' },
					{ status: 400, headers: CORS_HEADERS },
				)
			}

			// Check all common variable names in case it was saved as API_KEY or GOOGLE_API_KEY
			const envAny = env as unknown as Record<string, string | undefined>
			const apiKey = env.GEMINI_API_KEY || envAny.API_KEY || envAny.GOOGLE_API_KEY || envAny.GEMINI_KEY

			if (!apiKey) {
				return Response.json(
					{ error: 'Configuration Error: Missing GEMINI_API_KEY in worker environment. Please add GEMINI_API_KEY in Cloudflare Worker Settings > Variables.' },
					{ status: 500, headers: CORS_HEADERS },
				)
			}

			// Select model chain based on requested mode (defaults to medium)
			const requestedMode = (body.mode ?? 'medium').toLowerCase()
			const modelChain = MODEL_CHAINS[requestedMode] ?? MODEL_CHAINS.medium

			const { text, modelUsed, latencyMs } = await callWithModelList(
				apiKey,
				modelChain,
				prompt,
				body.systemInstruction,
			)

			console.log(`[generate] mode=${requestedMode} model=${modelUsed} latency=${latencyMs}ms`)

			// Returns both modern clean format and backward-compatible candidates structure
			return Response.json(
				{
					success: true,
					text,
					modelUsed,
					latencyMs,
					// Backward compatibility with previous client code
					candidates: [
						{
							content: {
								parts: [{ text }],
							},
						},
					],
				},
				{ headers: CORS_HEADERS },
			)
		} catch (err: unknown) {
			const msg = (err as Error).message ?? String(err)
			const status = (err as Error & { status?: number }).status ?? 500
			console.error('Worker generation error:', msg)

			return Response.json(
				{ error: `Could not generate snippet. (${msg})` },
				{ status: status >= 400 && status < 600 ? status : 500, headers: CORS_HEADERS },
			)
		}
	},
}
