// D1 access for the admin-triaged roadmap overlay (`roadmap_items`, migration
// 0014) and for the feedback→roadmap triage step itself.
//
// Division of labour: $lib/roadmap/merge.ts decides how base + overlay combine
// (pure, no D1); this module owns reads, writes and — importantly — the
// write-time validation that keeps the public snapshot trustworthy. Every
// invariant test/roadmap.test.ts asserts over roadmap.json is re-asserted here
// before a row can be written, because overlay rows reach the same page
// without a code review standing in between.
import { roadmap as baseRoadmap } from '$lib/roadmap/roadmap';
import { adminRoadmapItems } from '$lib/roadmap/merge';
import {
	isRoadmapStatus,
	ROADMAP_NOTE_MAX_LEN,
	ROADMAP_TITLE_MAX_LEN
} from '$lib/roadmap/limits';
import type { AdminRoadmapItem, RoadmapOverlayRow, RoadmapStatus } from '$lib/roadmap/types';
import type { FeedbackStatus } from '$lib/feedback';

// Re-exported so server callers keep a single import site, mirroring how
// $lib/server/feedback.ts re-exports $lib/feedback.
export * from '$lib/roadmap/limits';

/** What the admin form supplies for a new or edited entry. */
export interface RoadmapItemInput {
	id?: string;
	titleEn: string;
	titlePt: string;
	status: RoadmapStatus;
	noteEn?: string | null;
	notePt?: string | null;
	hidden?: boolean;
	feedbackId?: string | null;
}

export type RoadmapWriteResult =
	| { ok: true; id: string }
	| {
			ok: false;
			reason:
				| 'bad_status'
				| 'missing_title'
				| 'title_too_long'
				| 'half_note'
				| 'note_too_long'
				| 'not_found';
	  };

const SELECT_COLUMNS = `id, title_en AS titleEn, title_pt AS titlePt, status,
	        note_en AS noteEn, note_pt AS notePt, hidden,
	        feedback_id AS feedbackId,
	        created_at AS createdAt, updated_at AS updatedAt`;

/** Every overlay row, oldest first. */
export async function listRoadmapOverlay(db: D1Database): Promise<RoadmapOverlayRow[]> {
	const rows = await db
		.prepare(`SELECT ${SELECT_COLUMNS} FROM roadmap_items ORDER BY created_at ASC`)
		.all<RoadmapOverlayRow>();
	return rows.results;
}

export async function getRoadmapOverlayRow(
	db: D1Database,
	id: string
): Promise<RoadmapOverlayRow | null> {
	return await db
		.prepare(`SELECT ${SELECT_COLUMNS} FROM roadmap_items WHERE id = ?`)
		.bind(id)
		.first<RoadmapOverlayRow>();
}

/** The admin view of base ∪ overlay, retired items included. */
export async function listAdminRoadmap(db: D1Database): Promise<AdminRoadmapItem[]> {
	return adminRoadmapItems(baseRoadmap, await listRoadmapOverlay(db));
}

/** Normalize + validate an input into the exact column values to write.
 *  Returns the failure reason instead of throwing so form actions can map it
 *  onto a message. */
function validate(
	input: RoadmapItemInput
): { ok: true; value: Required<Omit<RoadmapItemInput, 'id'>> } | Extract<RoadmapWriteResult, { ok: false }> {
	if (!isRoadmapStatus(input.status)) return { ok: false, reason: 'bad_status' };

	const titleEn = (input.titleEn ?? '').trim();
	const titlePt = (input.titlePt ?? '').trim();
	// Both languages or nothing: a title present in only one language would
	// render as an empty line for half the family.
	if (!titleEn || !titlePt) return { ok: false, reason: 'missing_title' };
	if (titleEn.length > ROADMAP_TITLE_MAX_LEN || titlePt.length > ROADMAP_TITLE_MAX_LEN) {
		return { ok: false, reason: 'title_too_long' };
	}

	const noteEn = (input.noteEn ?? '').trim();
	const notePt = (input.notePt ?? '').trim();
	// Notes are optional, but one-sided notes are not — same reasoning.
	if (Boolean(noteEn) !== Boolean(notePt)) return { ok: false, reason: 'half_note' };
	if (noteEn.length > ROADMAP_NOTE_MAX_LEN || notePt.length > ROADMAP_NOTE_MAX_LEN) {
		return { ok: false, reason: 'note_too_long' };
	}

	return {
		ok: true,
		value: {
			titleEn,
			titlePt,
			status: input.status,
			noteEn: noteEn || null,
			notePt: notePt || null,
			hidden: input.hidden ?? false,
			feedbackId: input.feedbackId ?? null
		}
	};
}

/** URL-ish slug from the English title, used as the entry id when the admin
 *  doesn't supply one. Ids are public-ish (they key the list) and stable. */
export function slugify(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '') // strip accents: "Previsão" → "Previsao"
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
}

/** A slug that collides with neither the base snapshot nor an existing overlay
 *  row, by appending -2, -3, … Falls back to a random id for a title with no
 *  latin characters at all (e.g. all emoji). */
export async function uniqueRoadmapId(db: D1Database, titleEn: string): Promise<string> {
	const base = slugify(titleEn) || `item-${crypto.randomUUID().slice(0, 8)}`;
	const taken = new Set(baseRoadmap.items.map((item) => item.id));
	for (const row of await listRoadmapOverlay(db)) taken.add(row.id);
	if (!taken.has(base)) return base;
	for (let n = 2; n < 100; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Insert or replace an overlay row. Used for new entries, for editing an
 *  existing overlay row, and for promoting a base item into the overlay the
 *  first time it is edited. */
export async function upsertRoadmapItem(
	db: D1Database,
	id: string,
	input: RoadmapItemInput
): Promise<RoadmapWriteResult> {
	const checked = validate(input);
	if (!checked.ok) return checked;
	const v = checked.value;
	const now = Date.now();

	await db
		.prepare(
			`INSERT INTO roadmap_items
			   (id, title_en, title_pt, status, note_en, note_pt, hidden, feedback_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   title_en = excluded.title_en,
			   title_pt = excluded.title_pt,
			   status = excluded.status,
			   note_en = excluded.note_en,
			   note_pt = excluded.note_pt,
			   hidden = excluded.hidden,
			   -- Keep the original provenance when an entry is edited later; only
			   -- fill it in if it was previously unset.
			   feedback_id = COALESCE(roadmap_items.feedback_id, excluded.feedback_id),
			   updated_at = excluded.updated_at`
		)
		.bind(
			id,
			v.titleEn,
			v.titlePt,
			v.status,
			v.noteEn,
			v.notePt,
			v.hidden ? 1 : 0,
			v.feedbackId,
			now,
			now
		)
		.run();

	return { ok: true, id };
}

/**
 * Apply a small change (status and/or retired) to whichever layer the item
 * currently lives in. A base item has no row yet, so it is promoted into the
 * overlay with its snapshot text carried over — that is what lets the admin
 * flip `planned → shipped` on a roadmap.json item without editing the JSON.
 */
export async function patchRoadmapItem(
	db: D1Database,
	id: string,
	patch: { status?: RoadmapStatus; hidden?: boolean }
): Promise<RoadmapWriteResult> {
	if (patch.status !== undefined && !isRoadmapStatus(patch.status)) {
		return { ok: false, reason: 'bad_status' };
	}

	const row = await getRoadmapOverlayRow(db, id);
	if (row) {
		return await upsertRoadmapItem(db, id, {
			titleEn: row.titleEn,
			titlePt: row.titlePt,
			status: patch.status ?? row.status,
			noteEn: row.noteEn,
			notePt: row.notePt,
			hidden: patch.hidden ?? row.hidden === 1,
			feedbackId: row.feedbackId
		});
	}

	const item = baseRoadmap.items.find((it) => it.id === id);
	if (!item) return { ok: false, reason: 'not_found' };
	return await upsertRoadmapItem(db, id, {
		titleEn: item.title.en,
		titlePt: item.title.pt,
		status: patch.status ?? item.status,
		noteEn: item.note?.en ?? null,
		notePt: item.note?.pt ?? null,
		hidden: patch.hidden ?? false,
		feedbackId: null
	});
}

/** Drop an overlay row. A base item reverts to its roadmap.json definition; an
 *  overlay-only entry disappears from the roadmap entirely. */
export async function deleteRoadmapItem(db: D1Database, id: string): Promise<boolean> {
	const res = await db.prepare('DELETE FROM roadmap_items WHERE id = ?').bind(id).run();
	return (res.meta.changes ?? 0) > 0;
}

/** The feedback status implied by publishing an entry at `status`: something
 *  already shipped closes the submission, anything else marks it planned. */
export function feedbackStatusFor(status: RoadmapStatus): FeedbackStatus {
	return status === 'shipped' ? 'done' : 'planned';
}

/**
 * The triage step: publish a roadmap entry and close out the submission it came
 * from, as one D1 batch so the queue and the public page can never disagree.
 */
export async function acceptFeedbackIntoRoadmap(
	db: D1Database,
	feedbackId: string,
	input: RoadmapItemInput
): Promise<RoadmapWriteResult> {
	const checked = validate(input);
	if (!checked.ok) return checked;
	const v = checked.value;

	const exists = await db
		.prepare('SELECT id FROM feedback WHERE id = ?')
		.bind(feedbackId)
		.first<{ id: string }>();
	if (!exists) return { ok: false, reason: 'not_found' };

	const id = input.id?.trim() || (await uniqueRoadmapId(db, v.titleEn));
	const now = Date.now();

	await db.batch([
		db
			.prepare(
				`INSERT INTO roadmap_items
				   (id, title_en, title_pt, status, note_en, note_pt, hidden, feedback_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   title_en = excluded.title_en,
				   title_pt = excluded.title_pt,
				   status = excluded.status,
				   note_en = excluded.note_en,
				   note_pt = excluded.note_pt,
				   hidden = 0,
				   feedback_id = excluded.feedback_id,
				   updated_at = excluded.updated_at`
			)
			.bind(id, v.titleEn, v.titlePt, v.status, v.noteEn, v.notePt, feedbackId, now, now),
		db
			.prepare('UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?')
			.bind(feedbackStatusFor(v.status), now, feedbackId)
	]);

	return { ok: true, id };
}
