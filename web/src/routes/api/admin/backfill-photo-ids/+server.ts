import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isAdmin } from '$lib/server/admin';
import { assignEntityIds } from '$lib/server/trips';
import type { TripDoc } from '$lib/validateTrip';

/**
 * One-off backfill for stable photo placement (step 3 of 5).
 *
 * Photo rows written before migration 0013 reference a day by its DATE and a
 * stop by its INDEX, both of which move under editing. This resolves each such
 * row against its trip document and fills the new day_id/block_id columns.
 *
 * Safe by construction:
 *  - Idempotent. Only ever fills NULLs, so re-running is a no-op, and a partial
 *    run (timeout, deploy mid-flight) is simply resumed by running it again.
 *  - Non-destructive. day_date and block_index are left exactly as they were —
 *    they remain the fallback for anything this cannot resolve.
 *  - Skips what it cannot resolve rather than guessing. A photo whose day no
 *    longer exists keeps its current behaviour instead of being attached to the
 *    wrong day.
 *
 * Documents that have never been re-saved carry no ids yet, so this mints them
 * first (the same assignEntityIds every write path uses) and stores the doc
 * back before resolving photos against it.
 *
 * Admin only, and a 404 rather than a 403 to non-admins — the existence of a
 * maintenance endpoint isn't information a regular user needs.
 */
export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!isAdmin(locals.user, platform)) throw error(404, 'Not found');
	const db = getDb(platform);

	// Only trips that actually have un-backfilled photos are worth touching.
	const trips = await db
		.prepare(
			`SELECT DISTINCT trip_id FROM trip_photos
			 WHERE day_id IS NULL AND day_date IS NOT NULL AND deleted_at IS NULL`
		)
		.all<{ trip_id: string }>();

	let docsStamped = 0;
	let photosLinked = 0;
	let unresolved = 0;

	for (const { trip_id: tripId } of trips.results) {
		const row = await db
			.prepare('SELECT doc FROM trips WHERE id = ?')
			.bind(tripId)
			.first<{ doc: string }>();
		if (!row) continue;

		const doc = JSON.parse(row.doc) as TripDoc;
		const before = JSON.stringify(doc);
		assignEntityIds(doc);
		const after = JSON.stringify(doc);
		if (after !== before) {
			// updated_at is deliberately NOT bumped: this is a maintenance stamp,
			// not an edit, and bumping it would make every open editor's optimistic
			// concurrency check fail with a spurious "changed elsewhere".
			await db.prepare('UPDATE trips SET doc = ? WHERE id = ?').bind(after, tripId).run();
			docsStamped++;
		}

		// (segmentId, planId, dayDate) -> the day, so a date shared by two
		// segments can't cross-link.
		type DayLike = { id?: string; date?: string; blocks?: { id?: string }[] };
		type SegLike = { id?: string; plans?: { id?: string; days?: DayLike[] }[] };
		const byKey = new Map<string, DayLike>();
		// The generated TripDoc type only models what the schema strictly
		// requires, so read the structural fields through a local shape.
		for (const seg of (doc.segments ?? []) as unknown as SegLike[]) {
			for (const plan of seg.plans ?? []) {
				for (const day of plan.days ?? []) {
					byKey.set(`${seg.id}|${plan.id}|${day.date}`, day);
				}
			}
		}

		const photos = await db
			.prepare(
				`SELECT id, segment_id, plan_id, day_date, block_index FROM trip_photos
				 WHERE trip_id = ? AND day_id IS NULL AND day_date IS NOT NULL AND deleted_at IS NULL`
			)
			.bind(tripId)
			.all<{
				id: string;
				segment_id: string | null;
				plan_id: string | null;
				day_date: string;
				block_index: number | null;
			}>();

		const updates: D1PreparedStatement[] = [];
		for (const p of photos.results) {
			const day = byKey.get(`${p.segment_id}|${p.plan_id}|${p.day_date}`);
			if (!day?.id) {
				unresolved++;
				continue;
			}
			const blockId =
				p.block_index != null && p.block_index >= 0
					? day.blocks?.[p.block_index]?.id ?? null
					: null;
			updates.push(
				db
					.prepare('UPDATE trip_photos SET day_id = ?, block_id = ? WHERE id = ? AND day_id IS NULL')
					.bind(day.id, blockId, p.id)
			);
		}
		if (updates.length) {
			await db.batch(updates);
			photosLinked += updates.length;
		}
	}

	return json({ trips: trips.results.length, docsStamped, photosLinked, unresolved });
};
