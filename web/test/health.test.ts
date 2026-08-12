// Phase 5.5 — public health endpoint. Runs against real D1 (Miniflare), same
// discipline as the other test files: no mocks.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { GET as healthGET } from '../src/routes/api/health/+server';

function platformWith(db: D1Database) {
	return { env: { DB: db } } as unknown as App.Platform;
}

function requestFrom(ip: string) {
	return new Request('https://example.com/api/health', { headers: { 'cf-connecting-ip': ip } });
}

describe('GET /api/health', () => {
	it('is unauthenticated — no locals.user needed — and returns a bare ok:true after a D1 ping', async () => {
		const ip = '198.51.100.' + Math.floor(Math.random() * 254 + 1);
		const res = await healthGET({ request: requestFrom(ip), platform: platformWith(env.DB) } as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it('returns 503 with ok:false when the D1 ping fails', async () => {
		const throwingDb = {
			prepare() {
				return {
					bind() {
						return this;
					},
					first() {
						throw new Error('boom');
					},
					run() {
						throw new Error('boom');
					}
				};
			}
		} as unknown as D1Database;
		const ip = '198.51.100.' + Math.floor(Math.random() * 254 + 1);
		const res = await healthGET({ request: requestFrom(ip), platform: platformWith(throwingDb) } as never);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body).toEqual({ ok: false });
	});

	it('rate-limits after 30 requests/min from the same IP, then 429s', async () => {
		// Fixed address in TEST-NET-1, isolating this test's bucket. D1 storage is
		// shared across tests within a file (see the note in test/users.test.ts),
		// and this is the only case here that EXHAUSTS a bucket — it drives the
		// 'health' counter to 31, one past the max. While it drew from the same
		// random 198.51.100.0/24 pool as its three siblings, a 1-in-254 collision
		// left one of them asserting 200 against an already-spent bucket and
		// getting a 429. Same isolation ratelimit.test.ts and firebase-login.test.ts
		// use for their own bucket-exhausting cases.
		const ip = '192.0.2.30';
		for (let i = 0; i < 30; i++) {
			const res = await healthGET({ request: requestFrom(ip), platform: platformWith(env.DB) } as never);
			expect(res.status).toBe(200);
		}
		const res31 = await healthGET({ request: requestFrom(ip), platform: platformWith(env.DB) } as never);
		expect(res31.status).toBe(429);
		expect(res31.headers.get('Retry-After')).toBeTruthy();
	});

	it('does not require an approved user (no auth at all)', async () => {
		// No locals/user in the event object passed to the handler at all —
		// if the handler accidentally depended on requireUser() this would throw.
		const ip = '198.51.100.' + Math.floor(Math.random() * 254 + 1);
		const res = await healthGET({ request: requestFrom(ip), platform: platformWith(env.DB) } as never);
		expect(res.status).toBe(200);
	});
});
