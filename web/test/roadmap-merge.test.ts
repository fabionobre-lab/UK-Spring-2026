// P4 — the base ∪ overlay merge rule ($lib/roadmap/merge.ts). Pure functions,
// no D1: these assert the shape of the result, which is what the public page
// and the admin screen both derive from. The D1 side (writes, validation,
// triage) is covered in roadmap-triage.test.ts.
import { describe, expect, it } from 'vitest';
import { adminRoadmapItems, mergeRoadmap } from '../src/lib/roadmap/merge';
import type { RoadmapOverlayRow, RoadmapSnapshot } from '../src/lib/roadmap/types';

const BASE: RoadmapSnapshot = {
	updated: '2026-07-21',
	items: [
		{ id: 'alpha', title: { en: 'Alpha', pt: 'Alfa' }, status: 'shipped' },
		{
			id: 'beta',
			title: { en: 'Beta', pt: 'Beta' },
			status: 'planned',
			note: { en: 'Not yet', pt: 'Ainda não' }
		}
	]
};

function row(over: Partial<RoadmapOverlayRow> = {}): RoadmapOverlayRow {
	return {
		id: 'gamma',
		titleEn: 'Gamma',
		titlePt: 'Gama',
		status: 'planned',
		noteEn: null,
		notePt: null,
		hidden: 0,
		feedbackId: null,
		createdAt: Date.parse('2026-08-01T00:00:00Z'),
		updatedAt: Date.parse('2026-08-01T00:00:00Z'),
		...over
	};
}

describe('mergeRoadmap', () => {
	it('returns the base snapshot untouched when the overlay is empty', () => {
		expect(mergeRoadmap(BASE, [])).toEqual(BASE);
	});

	it('appends an overlay-only entry after the base items', () => {
		const merged = mergeRoadmap(BASE, [row()]);
		expect(merged.items.map((it) => it.id)).toEqual(['alpha', 'beta', 'gamma']);
		expect(merged.items[2].title).toEqual({ en: 'Gamma', pt: 'Gama' });
	});

	it('overrides a base item in place, keeping the snapshot ordering', () => {
		// The whole point of "flip planned → shipped without editing the JSON":
		// the item must not jump to the end of the list when it is overridden.
		const merged = mergeRoadmap(BASE, [row({ id: 'alpha', titleEn: 'Alpha v2', titlePt: 'Alfa v2', status: 'building' })]);
		expect(merged.items.map((it) => it.id)).toEqual(['alpha', 'beta']);
		expect(merged.items[0].status).toBe('building');
		expect(merged.items[0].title.en).toBe('Alpha v2');
	});

	it('drops a retired item from the public snapshot', () => {
		const merged = mergeRoadmap(BASE, [row({ id: 'beta', titleEn: 'Beta', titlePt: 'Beta', hidden: 1 })]);
		expect(merged.items.map((it) => it.id)).toEqual(['alpha']);
	});

	it('keeps a retired item visible to the admin, flagged', () => {
		const items = adminRoadmapItems(BASE, [
			row({ id: 'beta', titleEn: 'Beta', titlePt: 'Beta', hidden: 1 })
		]);
		expect(items.map((it) => it.id)).toEqual(['alpha', 'beta']);
		expect(items[1].hidden).toBe(true);
		expect(items[1].source).toBe('overlay');
		expect(items[0].source).toBe('base');
	});

	it('carries a bilingual note through, and drops a one-sided one', () => {
		const both = mergeRoadmap(BASE, [row({ noteEn: 'Soon', notePt: 'Em breve' })]);
		expect(both.items[2].note).toEqual({ en: 'Soon', pt: 'Em breve' });

		// A half-note is rejected at write time; if one ever reaches the table
		// (hand-edited row, restored backup) the page must not render a blank
		// line for the other language.
		const half = mergeRoadmap(BASE, [row({ noteEn: 'Soon', notePt: null })]);
		expect(half.items[2].note).toBeUndefined();
	});

	it('moves "updated" forward to the latest overlay write', () => {
		const merged = mergeRoadmap(BASE, [row({ updatedAt: Date.parse('2026-08-06T12:00:00Z') })]);
		expect(merged.updated).toBe('2026-08-06');
	});

	it('keeps the base date when the overlay is older than the snapshot', () => {
		const merged = mergeRoadmap(BASE, [row({ updatedAt: Date.parse('2026-01-02T00:00:00Z') })]);
		expect(merged.updated).toBe('2026-07-21');
	});

	it('orders multiple additions oldest-first', () => {
		const merged = mergeRoadmap(BASE, [
			row({ id: 'later', createdAt: 3000 }),
			row({ id: 'earlier', createdAt: 1000 })
		]);
		expect(merged.items.map((it) => it.id)).toEqual(['alpha', 'beta', 'earlier', 'later']);
	});

	it('never leaks admin-only fields onto the public snapshot', () => {
		const merged = mergeRoadmap(BASE, [row({ feedbackId: 'fb-1' })]);
		for (const item of merged.items) {
			expect(item).not.toHaveProperty('feedbackId');
			expect(item).not.toHaveProperty('hidden');
			expect(item).not.toHaveProperty('source');
		}
	});
});
