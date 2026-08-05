import type { PageServerLoad } from './$types';
import { roadmap as baseRoadmap } from '$lib/roadmap/roadmap';
import { mergeRoadmap } from '$lib/roadmap/merge';
import { listRoadmapOverlay } from '$lib/server/roadmap';

/**
 * The public roadmap = the committed roadmap.json snapshot merged with the
 * admin-triaged D1 overlay (migration 0014). Public, no auth: the merge only
 * ever surfaces entries an admin wrote, which is the same guarantee the
 * hand-edited snapshot gave.
 *
 * The overlay read is best-effort on purpose. A roadmap page is not worth a
 * 500 — if D1 is unavailable (or the migration hasn't landed yet on this
 * environment) the page still renders the base snapshot, which is exactly what
 * it showed before this feature existed.
 */
export const load: PageServerLoad = async ({ platform }) => {
	const db = platform?.env?.DB;
	if (!db) return { roadmap: baseRoadmap };
	try {
		return { roadmap: mergeRoadmap(baseRoadmap, await listRoadmapOverlay(db)) };
	} catch {
		return { roadmap: baseRoadmap };
	}
};
