// Debounced whole-document autosave for in-place trip editing.
//
// The API has exactly one mutation: PUT the whole trip doc, guarded by
// `x-base-updated-at` for optimistic concurrency. So every inline edit
// coalesces into one PUT ~800ms after the user stops typing, and the returned
// `updatedAt` rebases the guard for the next one.
//
// Known limitation (see the Phase 2 notes): whole-doc writes at autosave
// cadence make cross-editor conflicts likelier than the old explicit-save flow
// did. A 409 is therefore terminal here — we stop writing and surface a reload
// prompt rather than clobbering the other editor. Per-block patches are the
// real fix.
import { pruneEmpty } from '$lib/editor/factories';
import { validateTripDoc, type TripDoc } from '$lib/validateTrip';
import type { Trip } from '$lib/trip-engine';

export type SaveStatus =
	/** No edits since the last successful save (or since load). */
	| 'clean'
	/** Edited; a save is scheduled but hasn't fired. */
	| 'pending'
	| 'saving'
	| 'saved'
	/** The draft doesn't satisfy the trip schema — nothing was sent. */
	| 'invalid'
	/** Network/server failure; retryable. */
	| 'error'
	/** Someone else wrote to this trip; writing is halted until reload. */
	| 'conflict';

const DEBOUNCE_MS = 800;

export function createAutosave(
	tripId: string,
	getTrip: () => Trip,
	initialUpdatedAt: string | undefined
) {
	let status = $state<SaveStatus>('clean');
	let errors = $state<string[]>([]);
	let base = initialUpdatedAt;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight = false;
	// Body of the last successful PUT, so an edit that leaves the document
	// unchanged doesn't cost a round trip. Container-level `input` listeners (the
	// block inspector, the settings drawer) fire for things like the place-search
	// box, which types into the UI without touching the trip.
	let lastSentBody: string | null = null;
	// An edit landed while a PUT was in flight — save again once it settles, so
	// the last keystroke is never the one that gets dropped.
	let rerun = false;

	async function put(): Promise<void> {
		if (inFlight) {
			rerun = true;
			return;
		}
		const clean = pruneEmpty($state.snapshot(getTrip())) as TripDoc | undefined;
		if (!clean) {
			status = 'invalid';
			errors = ['The trip is empty.'];
			return;
		}
		const check = validateTripDoc(clean);
		if (!check.valid) {
			// Keep the edits in the draft — the user is mid-thought (an emptied
			// required title, say). The next valid keystroke saves everything.
			status = 'invalid';
			errors = check.errors;
			return;
		}
		const body = JSON.stringify(clean);
		if (body === lastSentBody) {
			status = 'saved';
			return;
		}
		inFlight = true;
		status = 'saving';
		errors = [];
		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (base) headers['x-base-updated-at'] = base;
			const res = await fetch(`/api/trips/${tripId}`, {
				method: 'PUT',
				headers,
				body
			});
			if (res.ok) {
				const data = (await res.json()) as { updatedAt?: string };
				if (data.updatedAt) base = data.updatedAt;
				lastSentBody = body;
				status = 'saved';
			} else if (res.status === 409) {
				status = 'conflict';
				rerun = false;
			} else {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
					details?: string[];
				};
				status = 'error';
				errors = body.details ?? [body.error ?? `Save failed (${res.status}).`];
			}
		} catch {
			status = 'error';
			errors = ['Could not reach the server. Your edits are still here — retrying will save them.'];
		} finally {
			inFlight = false;
			if (rerun && status !== 'conflict') {
				rerun = false;
				schedule(0);
			}
		}
	}

	/** Note an edit; (re)start the debounce window. */
	function schedule(delay: number = DEBOUNCE_MS): void {
		if (status === 'conflict') return; // halted until the user reloads
		status = 'pending';
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void put();
		}, delay);
	}

	/** Save now if anything is waiting — on leaving edit mode or navigating. */
	function flush(): void {
		if (timer) {
			clearTimeout(timer);
			timer = null;
			void put();
		}
	}

	function retry(): void {
		if (status === 'conflict') return;
		schedule(0);
	}

	function cancel(): void {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	return {
		get status() {
			return status;
		},
		get errors() {
			return errors;
		},
		/** Work is outstanding — used to guard navigation away from the page. */
		get busy() {
			return status === 'pending' || status === 'saving';
		},
		schedule,
		flush,
		retry,
		cancel
	};
}

export type Autosave = ReturnType<typeof createAutosave>;
