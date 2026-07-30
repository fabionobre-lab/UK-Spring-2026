// Document-level undo/redo for in-place trip editing.
//
// Phase 2 relied on the browser's native per-field undo, which is the right
// behaviour while you're typing inside one contenteditable. Phase 4 adds
// operations no text box can undo for you — deleting, duplicating, inserting
// and reordering stops — so the draft needs a real history.
//
// The two coexist by focus: Ctrl/⌘Z inside an editable field is left to the
// browser, and only handled here when focus is outside one (see the trip page's
// key handler). Snapshots are whole-document JSON, which is cheap enough at
// trip scale and immune to the aliasing bugs a patch-based history invites.
import type { Trip } from '$lib/trip-engine';

/** Consecutive edits inside this window collapse into one undo step, so
 *  undoing after typing a sentence doesn't walk back one keystroke at a time. */
const COALESCE_MS = 600;
/** Snapshots kept. Deep history isn't worth unbounded memory on a big trip. */
const MAX_STEPS = 40;

export function createHistory(getTrip: () => Trip, setTrip: (t: Trip) => void) {
	let past = $state<string[]>([]);
	let future = $state<string[]>([]);
	// The document as of the last capture — i.e. the PRE-mutation state at the
	// moment capture() runs, since callers invoke it after mutating.
	let current = snapshot();
	let lastPushAt = 0;

	function snapshot(): string {
		return JSON.stringify($state.snapshot(getTrip()));
	}

	/**
	 * Record that the document changed. Call AFTER the mutation.
	 * @param structural Force a new undo step even inside the coalesce window —
	 *   used for insert/delete/duplicate/reorder, which should never be merged
	 *   into an adjacent typing burst.
	 */
	function capture(structural = false): void {
		const next = snapshot();
		if (next === current) return;
		// Any fresh edit abandons the redo branch.
		future = [];
		const now = Date.now();
		if (structural || now - lastPushAt > COALESCE_MS) {
			past.push(current);
			if (past.length > MAX_STEPS) past.shift();
			lastPushAt = now;
		}
		current = next;
	}

	function undo(): boolean {
		const prev = past.pop();
		if (prev === undefined) return false;
		future.push(current);
		current = prev;
		setTrip(JSON.parse(prev) as Trip);
		// The next edit starts its own step rather than merging into whatever
		// burst was in progress before the undo.
		lastPushAt = 0;
		return true;
	}

	function redo(): boolean {
		const next = future.pop();
		if (next === undefined) return false;
		past.push(current);
		current = next;
		setTrip(JSON.parse(next) as Trip);
		lastPushAt = 0;
		return true;
	}

	return {
		get canUndo() {
			return past.length > 0;
		},
		get canRedo() {
			return future.length > 0;
		},
		capture,
		undo,
		redo
	};
}

export type History = ReturnType<typeof createHistory>;
