// Client-safe roadmap constants + validator. Same split as $lib/feedback.ts vs
// $lib/server/feedback.ts: the admin form needs these at runtime in the
// browser, and SvelteKit forbids importing $lib/server modules into client
// code. $lib/server/roadmap.ts re-exports everything here so server callers
// still have one import site.
import type { RoadmapStatus } from './types';

export const ROADMAP_STATUSES: RoadmapStatus[] = ['shipped', 'building', 'planned'];

/** Titles are the public-facing line on /roadmap — long enough for a sentence,
 *  short enough that the page stays scannable. Enforced both as a `maxlength`
 *  on the admin form and server-side before a write. */
export const ROADMAP_TITLE_MAX_LEN = 120;
export const ROADMAP_NOTE_MAX_LEN = 600;

export function isRoadmapStatus(v: unknown): v is RoadmapStatus {
	return typeof v === 'string' && (ROADMAP_STATUSES as string[]).includes(v);
}
