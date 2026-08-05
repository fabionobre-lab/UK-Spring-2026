// Merging the committed base snapshot (roadmap.json) with the admin-triaged
// D1 overlay (`roadmap_items`, migration 0014). Pure functions, no D1 and no
// SvelteKit — the whole point is that the merge rule is unit-testable on its
// own (test/roadmap-merge.test.ts) and that the public page and the admin
// screen derive from ONE implementation rather than two.
//
// The base snapshot is still the source of truth for everything it lists; the
// overlay only ever overrides an id, adds an id, or retires an id. That keeps
// the original invariant intact: nothing reaches /roadmap that an admin did
// not put there.
import type {
	AdminRoadmapItem,
	RoadmapItem,
	RoadmapOverlayRow,
	RoadmapSnapshot,
	RoadmapText
} from './types';

/** Epoch ms → 'YYYY-MM-DD', the plain-date form RoadmapSnapshot.updated uses. */
function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** A note pair, or undefined when the row carries no note. Both halves must be
 *  present and non-empty — a one-sided note would render as a blank line in
 *  the other language, which is exactly what the RoadmapText shape exists to
 *  prevent. Writes are validated in $lib/server/roadmap.ts; this is the
 *  belt-and-braces read side. */
function noteOf(row: RoadmapOverlayRow): RoadmapText | undefined {
	const en = (row.noteEn ?? '').trim();
	const pt = (row.notePt ?? '').trim();
	if (!en || !pt) return undefined;
	return { en, pt };
}

function itemOf(row: RoadmapOverlayRow): RoadmapItem {
	const note = noteOf(row);
	return {
		id: row.id,
		title: { en: row.titleEn, pt: row.titlePt },
		status: row.status,
		...(note ? { note } : {})
	};
}

/**
 * The admin view: every item that exists in either layer, retired ones
 * included, in a stable order — base items first (snapshot order preserved,
 * so a status change never reshuffles the page), then overlay-only additions
 * oldest-first.
 */
export function adminRoadmapItems(
	base: RoadmapSnapshot,
	overlay: RoadmapOverlayRow[]
): AdminRoadmapItem[] {
	const byId = new Map(overlay.map((row) => [row.id, row]));

	const merged: AdminRoadmapItem[] = base.items.map((item) => {
		const row = byId.get(item.id);
		if (!row) return { ...item, source: 'base', hidden: false, feedbackId: null };
		return { ...itemOf(row), source: 'overlay', hidden: row.hidden === 1, feedbackId: row.feedbackId };
	});

	const baseIds = new Set(base.items.map((item) => item.id));
	const additions = overlay
		.filter((row) => !baseIds.has(row.id))
		.slice()
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
		.map<AdminRoadmapItem>((row) => ({
			...itemOf(row),
			source: 'overlay',
			hidden: row.hidden === 1,
			feedbackId: row.feedbackId
		}));

	return [...merged, ...additions];
}

/**
 * The public snapshot: the admin view minus retired items, minus the admin-only
 * bookkeeping fields. `updated` moves to the most recent overlay write when
 * that is later than the base snapshot's own date, so the "last updated" line
 * on /roadmap reflects triage rather than the last time the JSON was committed.
 */
export function mergeRoadmap(
	base: RoadmapSnapshot,
	overlay: RoadmapOverlayRow[]
): RoadmapSnapshot {
	const items = adminRoadmapItems(base, overlay)
		.filter((item) => !item.hidden)
		.map<RoadmapItem>((item) => ({
			id: item.id,
			title: item.title,
			status: item.status,
			...(item.note ? { note: item.note } : {})
		}));

	const latest = overlay.reduce((max, row) => Math.max(max, row.updatedAt), 0);
	const overlayDate = latest > 0 ? isoDate(latest) : '';
	// String compare is safe: both sides are zero-padded YYYY-MM-DD.
	const updated = overlayDate > base.updated ? overlayDate : base.updated;

	return { updated, items };
}
