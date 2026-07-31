// Stable day/block identity. Photo placement referenced a day by its DATE and
// a stop by its INDEX, both of which change under ordinary editing — re-dating
// a day orphaned its photos and reordering stops scrambled theirs. Identity
// fixes that at the root, so the two properties worth guarding are:
//   1. every day and block ends up with an id, and
//   2. an id, once minted, never changes — re-minting is exactly the bug.
import { describe, expect, it } from 'vitest';
import { assignEntityIds } from '../src/lib/server/trips';
import { validateTripDoc, type TripDoc } from '../src/lib/validateTrip';

function trip(): TripDoc {
	return {
		id: 'test-trip',
		title: { en: 'Test Trip' },
		languages: ['en'],
		defaultLanguage: 'en',
		segments: [
			{
				id: 'seg',
				title: { en: 'Segment' },
				plans: [
					{
						id: 'main',
						days: [
							{
								date: '2026-04-10',
								title: { en: 'Day one' },
								blocks: [
									{ time: '09:00', title: { en: 'First' } },
									{ time: '10:00', title: { en: 'Second' } }
								]
							},
							{ date: '2026-04-11', title: { en: 'Day two' }, blocks: [{ time: '09:00', title: { en: 'Only' } }] }
						]
					}
				]
			}
		]
	} as unknown as TripDoc;
}

type WithId = { id?: string; blocks?: { id?: string }[] };
function days(doc: TripDoc): WithId[] {
	return (doc.segments ?? []).flatMap((s) => (s.plans ?? []).flatMap((p) => (p.days ?? []) as WithId[]));
}

describe('assignEntityIds', () => {
	it('gives every day and block an id', () => {
		const doc = assignEntityIds(trip());
		const all = days(doc);
		expect(all).toHaveLength(2);
		expect(all.flatMap((d) => d.blocks ?? [])).toHaveLength(3);
		for (const day of all) {
			expect(day.id).toMatch(/^[a-z0-9]{8,32}$/);
			for (const block of day.blocks ?? []) expect(block.id).toMatch(/^[a-z0-9]{8,32}$/);
		}
	});

	it('keeps ids stable when called again — re-minting is the bug it prevents', () => {
		const doc = assignEntityIds(trip());
		const first = JSON.stringify(days(doc));
		assignEntityIds(doc);
		expect(JSON.stringify(days(doc))).toBe(first);
	});

	it('fills only the gaps, leaving ids already present untouched', () => {
		const doc = trip();
		days(doc)[0].id = 'preexisting01';
		assignEntityIds(doc);
		expect(days(doc)[0].id).toBe('preexisting01');
		expect(days(doc)[1].id).toMatch(/^[a-z0-9]{8,32}$/);
	});

	it('mints ids unique within the document', () => {
		const doc = assignEntityIds(trip());
		const all = days(doc).flatMap((d) => [d.id, ...(d.blocks ?? []).map((b) => b.id)]);
		expect(new Set(all).size).toBe(all.length);
	});

	it('leaves the document schema-valid, since ids are minted before validation', () => {
		expect(validateTripDoc(assignEntityIds(trip())).valid).toBe(true);
	});

	it('accepts a document that predates ids — they are optional, so nothing breaks', () => {
		expect(validateTripDoc(trip()).valid).toBe(true);
	});
});
