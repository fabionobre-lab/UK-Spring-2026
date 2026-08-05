// Shared shape for the public roadmap snapshot (Phase 4, LAUNCH_PLAN.md).
// The snapshot (roadmap.json) is a committed, hand-edited/regenerated-at-
// triage-time file — nothing here ever reads the live feedback DB, which is
// the whole point: only admin-triaged items can ever go public.
export type RoadmapStatus = 'shipped' | 'building' | 'planned';

/** Bilingual text pair. Deliberately 'en'/'pt' (not the app's 'en-GB'/'pt-BR'
 *  Locale codes) — this is a plain data snapshot, not part of the UI i18n
 *  catalog; lib/roadmap/roadmap.ts maps the app Locale onto these keys. */
export interface RoadmapText {
	en: string;
	pt: string;
}

export interface RoadmapItem {
	/** Stable identifier — asserted unique in tests. */
	id: string;
	title: RoadmapText;
	status: RoadmapStatus;
	note?: RoadmapText;
}

export interface RoadmapSnapshot {
	/** ISO date the snapshot was last regenerated/hand-edited. */
	updated: string;
	items: RoadmapItem[];
}

/** One row of the admin-triaged overlay (D1 `roadmap_items`, migration 0014).
 *  The overlay is how triage reaches the public page without an edit-and-
 *  deploy of roadmap.json: a row either overrides a base item (same id), adds
 *  a new item, or retires a base item (`hidden`). Camel-cased here because the
 *  server lib aliases the snake_case columns in SELECT. */
export interface RoadmapOverlayRow {
	id: string;
	titleEn: string;
	titlePt: string;
	status: RoadmapStatus;
	noteEn: string | null;
	notePt: string | null;
	/** SQLite has no boolean — 0 or 1. */
	hidden: number;
	/** The feedback submission this entry was triaged from, when it came from
	 *  the queue rather than being added by hand. */
	feedbackId: string | null;
	createdAt: number;
	updatedAt: number;
}

/** A merged item as the ADMIN sees it: everything the public page gets, plus
 *  the bookkeeping the triage screen needs (where it came from, whether it is
 *  retired). Hidden items appear here — they are filtered out of the public
 *  snapshot — so the admin can un-retire one. */
export interface AdminRoadmapItem extends RoadmapItem {
	/** 'base' = straight from roadmap.json (no overlay row yet); 'overlay' =
	 *  has a `roadmap_items` row, so it can be reverted back to base. */
	source: 'base' | 'overlay';
	hidden: boolean;
	feedbackId: string | null;
}
