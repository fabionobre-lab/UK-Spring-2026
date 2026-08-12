// Paste-import pipeline (src/lib/server/import.ts). The network call is
// injected, so these run with no ANTHROPIC_API_KEY and cost nothing — the
// point is the parse → validate → retry contract and the id rules the system
// prompt promises the model, which are the two things most likely to drift.
import { describe, expect, it } from 'vitest';
import {
	buildSystemPrompt,
	extractToolInput,
	getAnthropicKey,
	importItinerary,
	runImportPipeline,
	MAX_TEXT_CHARS
} from '../src/lib/server/import';
import { validateTripDoc } from '../src/lib/validateTrip';

/** Minimal doc the schema accepts: day/block ids omitted (they're minted on
 *  save by assignEntityIds), everything else slugged. */
function validDoc() {
	return {
		id: 'lisbon-in-three-days',
		title: { en: 'Lisbon in Three Days' },
		languages: ['en'],
		defaultLanguage: 'en',
		segments: [
			{
				id: 'lisbon',
				title: { en: 'Lisbon' },
				theme: 'tartan',
				plans: [
					{
						id: 'main',
						days: [
							{
								date: '2027-05-04',
								title: { en: 'Lisbon - Day 1' },
								blocks: [{ time: 'Morning', title: { en: 'Belém' } }]
							}
						]
					}
				]
			}
		]
	};
}

function respond(doc: unknown): Response {
	return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'save_trip', input: doc }] }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

const OPTS = { apiKey: 'sk-test', text: 'Three days in Lisbon', today: '2026-08-11' };

describe('getAnthropicKey', () => {
	it('returns null when the secret is missing or blank', () => {
		expect(getAnthropicKey(undefined)).toBe(null);
		expect(getAnthropicKey({ env: {} } as unknown as App.Platform)).toBe(null);
		expect(getAnthropicKey({ env: { ANTHROPIC_API_KEY: '   ' } } as unknown as App.Platform)).toBe(null);
	});

	it('returns the trimmed key when set', () => {
		expect(getAnthropicKey({ env: { ANTHROPIC_API_KEY: ' sk-live ' } } as unknown as App.Platform)).toBe(
			'sk-live'
		);
	});
});

describe('importItinerary', () => {
	it('accepts a schema-valid document', async () => {
		const out = await importItinerary({ ...OPTS, fetchImpl: (async () => respond(validDoc())) as typeof fetch });
		expect(out.ok).toBe(true);
	});

	it('sends the request shape the Anthropic API expects', async () => {
		let body: Record<string, unknown> = {};
		await importItinerary({
			...OPTS,
			fetchImpl: (async (_url: string, init: RequestInit) => {
				body = JSON.parse(String(init.body));
				return respond(validDoc());
			}) as unknown as typeof fetch
		});
		// Sonnet 5 rejects non-default sampling params with a 400, so none may
		// be sent; tool use is forced so the reply is always machine-parseable.
		expect(body.model).toBe('claude-sonnet-5');
		expect(body).not.toHaveProperty('temperature');
		expect(body).not.toHaveProperty('top_p');
		expect(body.tool_choice).toEqual({ type: 'tool', name: 'save_trip' });
	});

	it('retries once with the validation errors, then succeeds', async () => {
		const bodies: string[] = [];
		const out = await importItinerary({
			...OPTS,
			fetchImpl: (async (_url: string, init: RequestInit) => {
				bodies.push(String(init.body));
				return respond(bodies.length === 1 ? { id: 'broken' } : validDoc());
			}) as unknown as typeof fetch
		});
		expect(out.ok).toBe(true);
		expect(bodies).toHaveLength(2);
		expect(bodies[1]).toContain('failed schema validation');
	});

	it('gives up with a 422 when both attempts are invalid', async () => {
		const out = await importItinerary({
			...OPTS,
			fetchImpl: (async () => respond({ id: 'broken' })) as typeof fetch
		});
		expect(out).toMatchObject({ ok: false, status: 422 });
	});

	it('maps an upstream failure to a 502 without leaking the body', async () => {
		const out = await importItinerary({
			...OPTS,
			fetchImpl: (async () => new Response('rate limited: key sk-live', { status: 429 })) as typeof fetch
		});
		expect(out).toMatchObject({ ok: false, status: 502 });
		if (!out.ok) expect(out.error).not.toContain('sk-live');
	});
});

describe('system prompt id rules', () => {
	// Regression: the prompt used to tell the model to slug *every* id. Day and
	// block ids are ^[a-z0-9]{8,32}$ (minted on save), so a slugged one fails
	// validation and the import 422s — see the assertion below for why it must
	// keep telling the model to leave them out.
	it('tells the model not to set day or block ids', () => {
		const prompt = buildSystemPrompt('2026-08-11');
		expect(prompt).toMatch(/Do NOT set an "id" on a day or a block/);
	});

	it('rejects a slugged day id, which is what that rule prevents', () => {
		const doc = validDoc() as Record<string, never>;
		const day = (doc.segments as unknown as { plans: { days: { id?: string }[] }[] }[])[0].plans[0].days[0];
		day.id = 'lisbon-day-1';
		expect(validateTripDoc(doc).valid).toBe(false);
	});

	it("anchors relative dates on the caller's date", () => {
		expect(buildSystemPrompt('2026-08-11')).toContain("Today's date is 2026-08-11");
	});
});

describe('extractToolInput', () => {
	it('returns null when the reply carries no save_trip call', () => {
		expect(extractToolInput({ content: [{ type: 'text', text: 'hello' }] })).toBe(null);
		expect(extractToolInput({ content: [{ type: 'tool_use', name: 'other', input: {} }] })).toBe(null);
		expect(extractToolInput({})).toBe(null);
	});
});

describe('runImportPipeline', () => {
	it('does not call the model a third time', async () => {
		let calls = 0;
		await runImportPipeline(async () => {
			calls++;
			return { id: 'broken' };
		});
		expect(calls).toBe(2);
	});
});

it('caps pasted text at the length the endpoint enforces', () => {
	expect(MAX_TEXT_CHARS).toBe(20000);
});
