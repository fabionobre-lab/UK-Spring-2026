// Sidebar ↔ trip bridge (desktop ≥960px only).
//
// TripView owns day-switch + plan-selection state as the single source of
// truth. While a trip is on screen it publishes a *view-model* snapshot of its
// day rail here (segment headers, variant pills, day rows) plus the callbacks
// that drive its own state; the desktop Sidebar subscribes and renders the trip
// zone. This avoids duplicating computeFlatDays() — TripView already computes
// `railSegments` against the live plan selection and simply reshapes it.
//
// Rune-based module store (matches the i18n/theme store convention: read via a
// function call inside a reactive context, write via a setter). The value is a
// plain snapshot re-published by TripView whenever the selection changes, so the
// callbacks always close over fresh state.

export interface RailPillVM {
	id: string;
	label: string;
	/** The currently-selected plan for this segment. */
	on: boolean;
}

export interface RailDayVM {
	/** Global flat-day index — the exact `dayIdx` TripView switches to. */
	gi: number;
	/** "Mon 20" — weekday + day number, localized. */
	dateLabel: string;
	title: string;
	today: boolean;
	active: boolean;
}

export interface RailSegVM {
	id: string;
	title: string;
	subtitle: string;
	/** Empty when the segment has a single plan (no variant switcher). */
	pills: RailPillVM[];
	days: RailDayVM[];
}

export interface TripNavVM {
	/** aria-label for the trip-days nav landmark. */
	label: string;
	segments: RailSegVM[];
	selectDay: (gi: number) => void;
	selectPlan: (segId: string, planId: string) => void;
}

let tripState = $state<TripNavVM | null>(null);

/** TripView publishes its rail snapshot here (or null to clear on destroy). */
export function setTripNav(vm: TripNavVM | null): void {
	tripState = vm;
}

/** Sidebar reads this in a reactive context; null when no trip is mounted. */
export function tripNav(): TripNavVM | null {
	return tripState;
}

// ── Trip actions published to the app's mobile chrome ──
// Print and "Add to calendar" are per-trip actions that used to sit in the
// hero. On a phone that put two buttons above the trip title — chrome ahead of
// content — when the bottom bar's More sheet is where every other per-trip
// action already lives (Photos, Settings). The ICS download is built from
// TripView's own plan selection, so the page can't construct it: TripView
// publishes the pair here and the page renders them as More rows.
//
// Same shape as the rail above: a snapshot re-published whenever it changes,
// cleared on destroy.
export interface TripActionsVM {
	/** Link to the printable document, when the route has one. */
	printHref?: string;
	/** Downloads the .ics for the trip as currently displayed (language + the
	 *  plan variant selected in each segment). */
	downloadIcs: () => void;
}

let actionsState = $state<TripActionsVM | null>(null);

export function setTripActions(vm: TripActionsVM | null): void {
	actionsState = vm;
}

export function tripActions(): TripActionsVM | null {
	return actionsState;
}

// ── Page-provided "About" action (signed-out demo variant) ──
// The Sidebar lives in the root layout and can't see a page's local dialog
// state, so a page (the demo) registers an opener here and clears it on destroy.
export interface SidebarAboutVM {
	label: string;
	open: () => void;
}

let aboutState = $state<SidebarAboutVM | null>(null);

export function setSidebarAbout(vm: SidebarAboutVM | null): void {
	aboutState = vm;
}

export function sidebarAbout(): SidebarAboutVM | null {
	return aboutState;
}
