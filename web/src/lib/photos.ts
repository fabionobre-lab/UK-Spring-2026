/** Client-safe shapes for trip photos (the server module re-uses these). */

export interface TripPhoto {
	id: string;
	/** Capture time, ISO 8601 UTC (from Google Photos). */
	creationTime: string;
	width: number | null;
	height: number | null;
	segmentId: string | null;
	planId: string | null;
	/** Matched itinerary day (YYYY-MM-DD), or null = unmatched. */
	dayDate: string | null;
	/** Index into that day's blocks, or null = day-level. May dangle after an
	 *  itinerary edit — treat out-of-range as day-level. Superseded by blockId
	 *  where present; kept as the fallback for rows written before ids. */
	blockIndex: number | null;
	/** Stable id of the placed day/block. Preferred over dayDate/blockIndex on
	 *  read: a day's date and a stop's index both move under editing, an id
	 *  does not. Null on rows that predate the backfill. */
	dayId?: string | null;
	blockId?: string | null;
	manualOverride: boolean;
}

export type PhotoRendition = 'thumb' | 'disp';

/** `token` is a public-link token (public-share-route-spec.md) — pass it only
 *  when rendering a trip loaded via /s/[token], where there is no session to
 *  authorize the request instead. */
export function photoUrl(tripId: string, photoId: string, size: PhotoRendition, token?: string): string {
	const base = `/api/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(photoId)}/${size}`;
	return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
